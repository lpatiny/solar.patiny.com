/* eslint-disable @typescript-eslint/naming-convention -- API response types use snake_case */
import { useEffect, useState } from 'react';

import type { DirigeraDevice } from './DirigeraDeviceTile.tsx';
import DirigeraDeviceTile from './DirigeraDeviceTile.tsx';

interface DevicesData {
  timestamp: number;
  is_stale: boolean;
  configured: boolean;
  devices: DirigeraDevice[];
}

const POLL_MS = 15_000;

// Section heading + ordering by device type; unknown types fall to the end.
const TYPE_LABELS: Record<string, string> = {
  light: 'Lights',
  controller: 'Remotes',
  sensor: 'Sensors',
  outlet: 'Outlets',
  blinds: 'Blinds',
  gateway: 'Hub',
};
const TYPE_ORDER = [
  'light',
  'controller',
  'sensor',
  'outlet',
  'blinds',
  'gateway',
];

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}

export default function DirigeraTab() {
  const [data, setData] = useState<DevicesData | null>(null);

  useEffect(() => {
    let cancelled = false;

    function load() {
      fetch('/api/dirigera/devices')
        .then((r) => r.json() as Promise<DevicesData>)
        .then((d) => {
          if (!cancelled) setData(d);
        })
        .catch(() => undefined);
    }

    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (data && !data.configured) {
    return (
      <div style={{ paddingTop: 20 }}>
        <div className="card">
          <div className="card-title">Dirigera</div>
          <div style={{ color: 'var(--text-secondary)' }}>
            The DIRIGERA hub is not configured (set DIRIGERA_HOST and
            DIRIGERA_TOKEN).
          </div>
        </div>
      </div>
    );
  }

  const devices = data?.devices ?? [];
  const types = TYPE_ORDER.filter((t) => devices.some((d) => d.type === t));
  for (const device of devices) {
    if (!types.includes(device.type)) types.push(device.type);
  }

  return (
    <div style={{ paddingTop: 20 }}>
      <div className="card">
        <div
          style={{
            alignItems: 'center',
            display: 'flex',
            gap: 8,
            justifyContent: 'space-between',
            marginBottom: 4,
          }}
        >
          <span className="card-title" style={{ marginBottom: 0 }}>
            Dirigera — {devices.length} devices
          </span>
          {data?.is_stale && <span className="stale-badge">stale</span>}
        </div>

        {types.map((type) => (
          <div key={type} style={{ marginTop: 16 }}>
            <div
              style={{
                color: 'var(--text-secondary)',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.06em',
                marginBottom: 8,
                textTransform: 'uppercase',
              }}
            >
              {typeLabel(type)}
            </div>
            <div
              style={{
                display: 'grid',
                gap: 10,
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              }}
            >
              {devices
                .filter((d) => d.type === type)
                .map((device) => (
                  <DirigeraDeviceTile key={device.id} device={device} />
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
