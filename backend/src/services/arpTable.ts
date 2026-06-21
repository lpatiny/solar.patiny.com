/* eslint-disable camelcase, @typescript-eslint/naming-convention -- device API fields are snake_case */
import { readFileSync } from 'node:fs';

/** A discovered device carrying the fields needed to detect a MAC collision. */
export interface MacDiscoveredDevice {
  wifi_mac: string;
  ip: string;
}

/** A discovered device annotated with its real on-wire MAC and clash status. */
export type WithMacConflict<Device> = Device & {
  /** The MAC the host's ARP table resolved for this device's IP, or null. */
  arp_mac: string | null;
  /** True when this device shares its effective MAC with another in the set. */
  mac_conflict: boolean;
};

/**
 * Annotate each discovered device with the real MAC the host resolved for its IP
 * (from the ARP table) plus a `mac_conflict` flag. The flag is true when two
 * devices share the same effective MAC — the real `arp_mac` when known, otherwise
 * the device-reported `wifi_mac`. A clash seen on `arp_mac` is a genuine layer-2
 * MAC collision; a clash seen only on `wifi_mac` while `arp_mac` differ means the
 * firmware merely reports a non-unique value (an artifact, not a real collision).
 * @param devices - the discovered devices (each needs `wifi_mac` and `ip`)
 * @param arpByIp - map of IP address to the MAC the host resolved for it
 * @returns the devices with `arp_mac` and `mac_conflict` added
 */
export function annotateMacConflicts<Device extends MacDiscoveredDevice>(
  devices: Device[],
  arpByIp: Map<string, string>,
): Array<WithMacConflict<Device>> {
  const annotated = devices.map((device) => {
    const arp_mac = arpByIp.get(device.ip) ?? null;
    return { device, arp_mac, key: normalizeMac(arp_mac ?? device.wifi_mac) };
  });
  const counts = new Map<string, number>();
  for (const { key } of annotated) {
    if (key !== '') counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return annotated.map(({ device, arp_mac, key }) => ({
    ...device,
    arp_mac,
    mac_conflict: key !== '' && (counts.get(key) ?? 0) > 1,
  }));
}

/**
 * Read the host's ARP table, mapping each IP to the MAC it resolved to. Reads
 * Linux `/proc/net/arp`; on a platform without it (e.g. local dev on macOS) or
 * any read error it returns an empty map, so callers degrade gracefully to the
 * device-reported `wifi_mac`.
 * @returns map of IP address to resolved MAC
 */
export function readArpTable(): Map<string, string> {
  try {
    return parseArpTable(readFileSync('/proc/net/arp', 'utf8'));
  } catch {
    return new Map();
  }
}

/**
 * Parse the contents of Linux `/proc/net/arp` into an IP-to-MAC map. Skips the
 * header row and any incomplete entry (an all-zero MAC).
 * @param content - the raw `/proc/net/arp` text
 * @returns map of IP address to MAC address
 */
export function parseArpTable(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = content.split('\n');
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index];
    if (!line) continue;
    const columns = line.trim().split(/\s+/);
    const ip = columns[0];
    const mac = columns[3];
    if (!ip || !mac || mac === '00:00:00:00:00:00') continue;
    map.set(ip, mac);
  }
  return map;
}

function normalizeMac(mac: string): string {
  return mac.replaceAll(/[^0-9a-f]/gi, '').toLowerCase();
}
