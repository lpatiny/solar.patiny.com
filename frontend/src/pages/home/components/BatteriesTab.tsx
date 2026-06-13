import { useEffect, useState } from 'react';

import type { Device } from '../../../types.ts';

import BatteryDeviceCard from './BatteryDeviceCard.tsx';
import BatteryDeviceDetail from './BatteryDeviceDetail.tsx';

/**
 * Batteries tab: a card per battery device plus a detail/control view for the
 * selected one. History defaults to the last 24 hours.
 * @returns The batteries tab content.
 */
export default function BatteriesTab() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/devices')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Device[]) => {
        if (cancelled) return;
        setDevices(rows);
        setSelectedId((current) => current ?? rows[0]?.id ?? null);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = devices.find((device) => device.id === selectedId) ?? null;
  const now = Math.floor(Date.now() / 1000);
  const from = now - 86_400;

  if (loaded && devices.length === 0) {
    return (
      <div style={{ paddingTop: 20 }}>
        <div className="card">
          <span className="card-title">Batteries</span>
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            No battery devices configured. Add one in the Configuration tab.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        paddingTop: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {devices.map((device) => (
          <BatteryDeviceCard
            key={device.id}
            device={device}
            selected={device.id === selectedId}
            onSelect={() => setSelectedId(device.id)}
          />
        ))}
      </div>

      {selected && (
        <BatteryDeviceDetail device={selected} from={from} to={now} />
      )}
    </div>
  );
}
