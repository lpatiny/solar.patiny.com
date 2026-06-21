/* eslint-disable camelcase, @typescript-eslint/naming-convention -- DB and reading fields use snake_case */
import type { DeviceInput } from '../db/Database.ts';
import { db } from '../db/Database.ts';
import type { DeviceRow } from '../db/rows.ts';

import type { ControlParam, MarstekValues } from './marstekRegisters.ts';
import { readMarstekUdp } from './marstekUdpClient.ts';
import { discoverMarstekDevices } from './marstekUdpTransport.ts';

interface Logger {
  info: (msg: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

/** Latest in-memory snapshot for one device. */
export interface LiveEntry {
  device_id: number;
  timestamp: number;
  values: MarstekValues | null;
  control: ControlParam[];
  error: string | null;
  /**
   * Wall-clock (ms) when `values` were last read SUCCESSFULLY. A failed poll
   * carries the previous values forward but does NOT advance this, so callers can
   * tell fresh telemetry from a stale carried-over snapshot. 0 = never read.
   */
  valuesAt: number;
}

/**
 * How often the live in-memory snapshot is refreshed, independent of how often a
 * row is persisted to history. The Marstek Open API floor is ≤1 query/10s per
 * device, and that whole budget is shared with the strategy loop's command
 * writes (both go through the same per-device UDP queue). Polling at exactly the
 * 10s floor consumed 100% of it, so every command write queued behind a growing
 * read backlog and was delivered minutes late — the battery then held a stale
 * discharge setpoint. Refreshing at 20s leaves a free admission slot every 20s
 * for command writes while keeping reads well under the hardware floor; SOC
 * changes slowly enough that a 20s display cadence is imperceptible.
 */
export const LIVE_REFRESH_MS = 20_000;

/**
 * A live snapshot older than this (ms) is treated as stale: the control strategy
 * must not act on it (it would drive a battery blind, e.g. discharging past its
 * floor). Four missed polls — long enough to ride out a transient, short enough
 * that an arbitrarily old SOC never keeps a device eligible.
 */
export const LIVE_STALE_MS = 4 * LIVE_REFRESH_MS;

const latest = new Map<number, LiveEntry>();
const timers = new Map<number, ReturnType<typeof setInterval>>();
// Wall-clock (ms) of the last poll that was written to the history table, per
// device. Used to throttle DB writes to `poll_interval_ms` while the live cache
// keeps refreshing every LIVE_REFRESH_MS.
const lastPersistedAt = new Map<number, number>();

// Don't broadcast-discover more often than this, even if several devices fail.
const DISCOVERY_MIN_INTERVAL_MS = 15_000;
let lastDiscoveryAt = 0;

let log: Logger = {
  info: (msg) => process.stdout.write(`${msg}\n`),
  error: (obj, msg) => process.stderr.write(`${msg ?? String(obj)}\n`),
};

function toDeviceInput(device: DeviceRow): DeviceInput {
  return {
    name: device.name,
    type: device.type,
    host: device.host,
    port: device.port,
    ble_mac: device.ble_mac,
    enabled: device.enabled === 1,
    poll_interval_ms: device.poll_interval_ms,
  };
}

function subnetBroadcast(host: string): string | undefined {
  const parts = host.split('.');
  if (parts.length !== 4) return undefined;
  return `${parts[0]}.${parts[1]}.${parts[2]}.255`;
}

/**
 * Self-heal device hosts by ble_mac: broadcast-discover and update the stored
 * host of every device whose ble_mac now answers at a different IP (DHCP moved
 * it). One discovery heals all moved devices. Throttled globally.
 * @param trigger - the device whose failed poll triggered the heal
 * @returns the trigger device's new host if it moved, else null
 */
async function healDeviceHosts(trigger: DeviceRow): Promise<string | null> {
  const now = Date.now();
  if (now - lastDiscoveryAt < DISCOVERY_MIN_INTERVAL_MS) return null;
  lastDiscoveryAt = now;

  const found = await discoverMarstekDevices({
    port: trigger.port,
    broadcastAddress: subnetBroadcast(trigger.host),
  });
  const ipByMac = new Map(found.map((info) => [info.ble_mac, info.ip]));

  let triggerNewHost: string | null = null;
  for (const device of db.listDevices()) {
    if (!device.ble_mac) continue;
    const ip = ipByMac.get(device.ble_mac);
    if (!ip || ip === device.host) continue;
    db.updateDevice(device.id, { ...toDeviceInput(device), host: ip });
    log.info(
      `device ${device.id} (${device.ble_mac}) host healed ${device.host} -> ${ip}`,
    );
    if (device.id === trigger.id) triggerNewHost = ip;
  }
  return triggerNewHost;
}

async function pollDevice(
  device: DeviceRow,
  persist: boolean,
): Promise<LiveEntry> {
  const timestamp = Math.floor(Date.now() / 1000);
  try {
    const result = await readMarstekUdp({
      host: device.host,
      port: device.port,
    });
    if (persist) {
      db.insertBatteryReading({
        device_id: device.id,
        timestamp,
        ...result.values,
      });
      lastPersistedAt.set(device.id, Date.now());
    }
    const entry: LiveEntry = {
      device_id: device.id,
      timestamp,
      values: result.values,
      control: [],
      error: null,
      valuesAt: Date.now(),
    };
    latest.set(device.id, entry);
    return entry;
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    // A failed poll on a ble_mac-identified device is usually just a DHCP move:
    // rediscover and heal the host so the next poll lands. (Next tick re-reads
    // the device from the DB, so no immediate retry is needed.)
    if (device.ble_mac) {
      try {
        const healed = await healDeviceHosts(device);
        if (healed) message += ` — host self-healed to ${healed}`;
      } catch {
        // ignore discovery errors; keep the original poll error
      }
    }
    log.error(error, `battery poll failed for device ${device.id}`);
    const previous = latest.get(device.id);
    const entry: LiveEntry = {
      device_id: device.id,
      timestamp,
      values: previous?.values ?? null,
      control: previous?.control ?? [],
      error: message,
      // Keep the previous freshness stamp — a failed poll does not refresh it, so
      // the carried-over values correctly age out as stale.
      valuesAt: previous?.valuesAt ?? 0,
    };
    latest.set(device.id, entry);
    return entry;
  }
}

function scheduleDevice(device: DeviceRow): void {
  void pollDevice(device, true);
  const timer = setInterval(() => {
    const current = db.getDevice(device.id);
    if (!current?.enabled) return;
    const last = lastPersistedAt.get(current.id) ?? 0;
    const persist = Date.now() - last >= current.poll_interval_ms;
    void pollDevice(current, persist);
  }, LIVE_REFRESH_MS);
  timers.set(device.id, timer);
}

/** Stop all per-device timers and reload the enabled device list from the DB. */
export function reloadDevices(): void {
  for (const timer of timers.values()) clearInterval(timer);
  timers.clear();
  lastPersistedAt.clear();
  const devices = db
    .listDevices()
    .filter((d) => d.enabled && d.type === 'marstek');
  for (const device of devices) scheduleDevice(device);
  log.info(`battery poller tracking ${devices.length} device(s)`);
}

/**
 * Start polling every enabled Marstek device on its configured interval.
 * @param logger - logger for poll errors
 */
export function startBatteryPolling(logger: Logger): void {
  log = logger;
  reloadDevices();
}

/** Stop all battery polling timers. */
export function stopBatteryPolling(): void {
  for (const timer of timers.values()) clearInterval(timer);
  timers.clear();
}

/**
 * Latest cached snapshot for a device, or null if never polled.
 * @param deviceId - device id
 */
export function getLatest(deviceId: number): LiveEntry | null {
  return latest.get(deviceId) ?? null;
}

/**
 * Read a device on demand (through its serialized queue) and store the result.
 * @param deviceId - device id
 */
export async function readLive(deviceId: number): Promise<LiveEntry | null> {
  const device = db.getDevice(deviceId);
  if (!device) return null;
  return pollDevice(device, true);
}
