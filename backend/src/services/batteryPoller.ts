/* eslint-disable camelcase, @typescript-eslint/naming-convention -- DB and reading fields use snake_case */
import { db } from '../db/Database.ts';
import type { DeviceRow } from '../db/rows.ts';

import { healDeviceHosts } from './marstekHostHeal.ts';
import type { ControlParam, MarstekValues } from './marstekRegisters.ts';
import { readMarstekUdp } from './marstekUdpClient.ts';

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

/**
 * Cap on the per-device poll backoff (ms). A device that keeps failing is polled
 * no faster than this — so an unresponsive/crashed Marstek (or a struggling
 * ESP32 that our polling rate itself knocks over) is left alone instead of being
 * hammered every {@link LIVE_REFRESH_MS} with reads plus failure-triggered
 * discovery. The first successful poll resets the cadence back to LIVE_REFRESH_MS.
 */
export const MAX_POLL_BACKOFF_MS = 5 * 60_000;

const latest = new Map<number, LiveEntry>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();
// Consecutive failed polls per device, used to back off the poll cadence. Reset
// to 0 (entry removed) on the first successful poll.
const consecutiveFailures = new Map<number, number>();
// Wall-clock (ms) of the last poll that was written to the history table, per
// device. Used to throttle DB writes to `poll_interval_ms` while the live cache
// keeps refreshing every LIVE_REFRESH_MS.
const lastPersistedAt = new Map<number, number>();

let log: Logger = {
  info: (msg) => process.stdout.write(`${msg}\n`),
  error: (obj, msg) => process.stderr.write(`${msg ?? String(obj)}\n`),
};

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
        const healed = await healDeviceHosts(device, log);
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

/**
 * Delay before a device's next poll: {@link LIVE_REFRESH_MS} when healthy, then
 * doubling per consecutive failure (40s, 80s, …) capped at
 * {@link MAX_POLL_BACKOFF_MS}. Exported for the debug view.
 * @param deviceId - device id
 * @returns the delay in ms until the next poll
 */
export function nextPollDelay(deviceId: number): number {
  return pollDelayForFailures(consecutiveFailures.get(deviceId) ?? 0);
}

/**
 * The poll delay (ms) for a given consecutive-failure count: base cadence when
 * healthy, doubling per failure, capped. Pure, so it is unit-tested directly.
 * @param failures - consecutive failed polls (0 = healthy)
 * @returns the delay in ms until the next poll
 */
export function pollDelayForFailures(failures: number): number {
  if (failures <= 0) return LIVE_REFRESH_MS;
  return Math.min(LIVE_REFRESH_MS * 2 ** failures, MAX_POLL_BACKOFF_MS);
}

/**
 * How many consecutive polls have failed for a device (0 = healthy / last poll
 * succeeded). Exported so the debug view can show a backed-off device.
 * @param deviceId - device id
 * @returns the consecutive-failure count
 */
export function getPollFailures(deviceId: number): number {
  return consecutiveFailures.get(deviceId) ?? 0;
}

function scheduleDevice(device: DeviceRow): void {
  const tick = async (): Promise<void> => {
    const current = db.getDevice(device.id);
    if (current?.enabled) {
      const last = lastPersistedAt.get(current.id) ?? 0;
      const persist = Date.now() - last >= current.poll_interval_ms;
      const entry = await pollDevice(current, persist);
      if (entry.error) {
        consecutiveFailures.set(
          current.id,
          (consecutiveFailures.get(current.id) ?? 0) + 1,
        );
      } else {
        consecutiveFailures.delete(current.id);
      }
    }
    // Reschedule against the device id even while disabled (at the base cadence),
    // so a later re-enable resumes polling — matching the prior setInterval.
    timers.set(
      device.id,
      setTimeout(() => void tick(), nextPollDelay(device.id)),
    );
  };
  void tick();
}

/** Stop all per-device timers and reload the enabled device list from the DB. */
export function reloadDevices(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  lastPersistedAt.clear();
  consecutiveFailures.clear();
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
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  consecutiveFailures.clear();
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
