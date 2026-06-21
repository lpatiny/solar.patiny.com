/* eslint-disable camelcase -- API fields use snake_case */
import { Button, Intent, Tag } from '@blueprintjs/core';
import { useState } from 'react';

import type { Device, DiscoveredDevice } from '../../../types.ts';

const rowStyle = {
  display: 'flex',
  flexWrap: 'wrap' as const,
  alignItems: 'center',
  gap: 8,
  padding: '6px 0',
  borderBottom: '1px solid var(--border)',
  fontSize: 13,
};

const monoStyle = { fontFamily: 'monospace', color: 'var(--text-secondary)' };

async function patchHost(
  id: number,
  name: string,
  host: string,
  bleMac: string,
) {
  await fetch(`/api/devices/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, host, ble_mac: bleMac }),
  });
}

async function addDevice(found: DiscoveredDevice) {
  await fetch('/api/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `${found.device} ${found.ble_mac.slice(-4)}`,
      type: 'marstek',
      host: found.ip,
      ble_mac: found.ble_mac,
    }),
  });
}

/**
 * Network scanner: broadcast-discovers Marstek devices and lets the user apply a
 * moved IP to a registered device (matched by ble_mac) or add a new one.
 * @param props - registered devices and a change callback
 * @param props.devices - the currently registered devices
 * @param props.onChanged - called after a device is added or updated
 * @returns the scanner panel
 */
export default function DeviceScanner({
  devices,
  onChanged,
}: {
  devices: Device[];
  onChanged: () => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<DiscoveredDevice[] | null>(null);
  const [busyMac, setBusyMac] = useState<string | null>(null);

  async function scan() {
    setScanning(true);
    try {
      const res = await fetch('/api/devices/scan');
      setFound(res.ok ? ((await res.json()) as DiscoveredDevice[]) : []);
    } catch {
      setFound([]);
    } finally {
      setScanning(false);
    }
  }

  async function act(item: DiscoveredDevice, existing: Device | undefined) {
    setBusyMac(item.ble_mac);
    try {
      if (existing) {
        await patchHost(existing.id, existing.name, item.ip, item.ble_mac);
      } else {
        await addDevice(item);
      }
      onChanged();
    } finally {
      setBusyMac(null);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <Button
        small
        icon="search"
        loading={scanning}
        onClick={() => void scan()}
      >
        Scan network
      </Button>
      {found?.length === 0 && (
        <span
          style={{
            marginLeft: 10,
            color: 'var(--text-secondary)',
            fontSize: 12,
          }}
        >
          no devices found
        </span>
      )}
      {found?.map((item) => {
        const existing = devices.find((d) => d.ble_mac === item.ble_mac);
        const inSync = existing?.host === item.ip;
        return (
          <div key={item.ble_mac} style={rowStyle}>
            <span style={{ minWidth: 90 }}>{item.device}</span>
            <span style={{ ...monoStyle, minWidth: 110 }}>{item.ble_mac}</span>
            <span style={{ ...monoStyle, minWidth: 110 }}>{item.ip}</span>
            {item.mac_conflict && (
              <Tag
                minimal
                intent={Intent.DANGER}
                title={
                  item.arp_mac
                    ? `Two units resolve to the same MAC ${item.arp_mac} (real L2 collision)`
                    : `Duplicate reported Wi-Fi MAC ${item.wifi_mac} (ARP unavailable — unconfirmed)`
                }
              >
                MAC conflict{item.arp_mac ? ` · ${item.arp_mac}` : ''}
              </Tag>
            )}
            {existing ? (
              <span style={{ color: 'var(--text-secondary)' }}>
                → {existing.name}
              </span>
            ) : (
              <Tag minimal intent={Intent.WARNING}>
                unregistered
              </Tag>
            )}
            {inSync ? (
              <Tag minimal intent={Intent.SUCCESS}>
                in sync
              </Tag>
            ) : (
              <Button
                small
                intent={existing ? Intent.PRIMARY : Intent.SUCCESS}
                loading={busyMac === item.ble_mac}
                onClick={() => void act(item, existing)}
              >
                {existing ? `Apply ${item.ip}` : 'Add'}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
