import { useEffect, useState } from 'react';

import type { Device } from '../../../types.ts';
import type { ConfigData } from '../HomePage.tsx';

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
  const [reservePct, setReservePct] = useState(5);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: ConfigData | null) => {
        if (!cancelled && cfg) setReservePct(cfg.marstek_reserve_pct);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

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
  // 24 h window, fixed at mount; impure Date.now() must stay out of render.
  const [now] = useState(() => Math.floor(Date.now() / 1000));
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
            reservePct={reservePct}
            onSelect={() => setSelectedId(device.id)}
          />
        ))}
      </div>

      {selected && (
        <BatteryDeviceDetail
          device={selected}
          reservePct={reservePct}
          from={from}
          to={now}
        />
      )}
    </div>
  );
}
