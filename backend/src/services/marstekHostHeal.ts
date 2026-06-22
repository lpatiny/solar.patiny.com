/* eslint-disable camelcase -- DB fields use snake_case */
import type { DeviceInput } from '../db/Database.ts';
import { db } from '../db/Database.ts';
import type { DeviceRow } from '../db/rows.ts';

import { discoverMarstekDevices } from './marstekUdpTransport.ts';

/** Minimal logger the heal step needs. */
interface HealLogger {
  info: (msg: string) => void;
}

// Don't broadcast-discover more often than this, even if several devices fail.
const DISCOVERY_MIN_INTERVAL_MS = 15_000;
let lastDiscoveryAt = 0;

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
 * it). One discovery heals all moved devices. Throttled globally so a string of
 * failed polls cannot trigger a discovery storm.
 * @param trigger - the device whose failed poll triggered the heal
 * @param log - logger for healed-host notices
 * @returns the trigger device's new host if it moved, else null
 */
export async function healDeviceHosts(
  trigger: DeviceRow,
  log: HealLogger,
): Promise<string | null> {
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
