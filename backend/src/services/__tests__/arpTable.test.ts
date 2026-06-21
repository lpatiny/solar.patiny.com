/* eslint-disable camelcase -- device API fields are snake_case */
import { expect, test } from 'vitest';

import { annotateMacConflicts, parseArpTable } from '../arpTable.ts';

const ARP = `IP address       HW type     Flags       HW address            Mask     Device
192.168.1.52     0x1         0x2         f8:0d:a9:c9:1d:ed     *        eth0
192.168.1.101    0x1         0x2         f8:0d:a9:c9:1d:ed     *        eth0
192.168.1.30     0x1         0x0         00:00:00:00:00:00     *        eth0`;

test('parseArpTable maps IPs to MACs, skipping the header and incomplete entries', () => {
  const map = parseArpTable(ARP);
  expect(map.size).toBe(2);
  expect(map.get('192.168.1.52')).toBe('f8:0d:a9:c9:1d:ed');
  expect(map.get('192.168.1.101')).toBe('f8:0d:a9:c9:1d:ed');
  expect(map.has('192.168.1.30')).toBe(false); // all-zero MAC dropped
});

test('flags a real L2 collision when two IPs resolve to the same ARP MAC', () => {
  const devices = [
    { ip: '192.168.1.52', wifi_mac: 'f80da9c91ded' },
    { ip: '192.168.1.101', wifi_mac: 'f80da9c91ded' },
  ];
  const result = annotateMacConflicts(devices, parseArpTable(ARP));
  expect(result[0]?.arp_mac).toBe('f8:0d:a9:c9:1d:ed');
  expect(result[0]?.mac_conflict).toBe(true);
  expect(result[1]?.mac_conflict).toBe(true);
});

test('no conflict when the ARP table resolves distinct real MACs (API artifact)', () => {
  const arp = new Map([
    ['192.168.1.52', 'f8:0d:a9:c9:1d:ed'],
    ['192.168.1.101', 'aa:bb:cc:dd:ee:ff'],
  ]);
  const devices = [
    { ip: '192.168.1.52', wifi_mac: 'f80da9c91ded' },
    { ip: '192.168.1.101', wifi_mac: 'f80da9c91ded' }, // duplicate reported value...
  ];
  const result = annotateMacConflicts(devices, arp);
  // ...but the real on-wire MACs differ, so the duplicate wifi_mac was an artifact.
  expect(result[0]?.arp_mac).toBe('f8:0d:a9:c9:1d:ed');
  expect(result[1]?.arp_mac).toBe('aa:bb:cc:dd:ee:ff');
  expect(result[0]?.mac_conflict).toBe(false);
  expect(result[1]?.mac_conflict).toBe(false);
});

test('falls back to wifi_mac when the ARP table has no entry for the IP', () => {
  const devices = [
    { ip: '192.168.1.52', wifi_mac: 'f80da9c91ded' },
    { ip: '192.168.1.101', wifi_mac: 'f80da9c91ded' },
  ];
  const result = annotateMacConflicts(devices, new Map());
  expect(result[0]?.arp_mac).toBeNull();
  expect(result[0]?.mac_conflict).toBe(true); // shared reported wifi_mac
  expect(result[1]?.mac_conflict).toBe(true);
});
