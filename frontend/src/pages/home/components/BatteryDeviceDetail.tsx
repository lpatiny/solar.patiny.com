import { Callout, Tag } from '@blueprintjs/core';
import { useEffect, useState } from 'react';

import type { Device, DeviceLive } from '../../../types.ts';

import BatteryHistoryChart from './BatteryHistoryChart.tsx';
import {
  batteryEtaHours,
  batteryFlow,
  formatDuration,
  usableBattery,
} from './batteryStatus.ts';

interface BatteryDeviceDetailProps {
  device: Device;
  reservePct: number;
  from: number;
  to: number;
}

const POLL_MS = 5_000;

function fmt(value: number | null, unit: string, digits = 1): string {
  if (value === null) return '—';
  return `${value.toFixed(digits)} ${unit}`.trim();
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

/**
 * Full detail view for one battery device: all measurements and history.
 * Control and scheduling live in the Battery Control configuration tab.
 * @param root0 - Component props.
 * @param root0.device - The device to display.
 * @param root0.reservePct - Reserve floor in percent, hidden from the display.
 * @param root0.from - History range start (unix seconds).
 * @param root0.to - History range end (unix seconds).
 * @returns The device detail view.
 */
export default function BatteryDeviceDetail({
  device,
  reservePct,
  from,
  to,
}: BatteryDeviceDetailProps) {
  const [live, setLive] = useState<DeviceLive | null>(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      fetch(`/api/devices/${device.id}/live`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: DeviceLive | null) => {
          if (!cancelled) setLive(data);
        })
        .catch(() => undefined);
    }
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [device.id]);

  const values = live?.values ?? null;
  const usable = usableBattery(
    values?.soc_pct ?? null,
    values?.energy_kwh ?? null,
    reservePct,
  );
  const state = values?.inverter_state ?? null;
  const { flow, watts } = batteryFlow(values?.ac_power_w ?? null);
  const etaHours = batteryEtaHours(flow, watts, usable.soc, usable.capacityKwh);
  const flowIntent =
    flow === 'charging'
      ? 'success'
      : flow === 'discharging'
        ? 'primary'
        : 'none';
  const flowLabel =
    flow === 'charging'
      ? 'Charging'
      : flow === 'discharging'
        ? 'Discharging'
        : 'Idle';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div
          style={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 4,
          }}
        >
          <span className="card-title" style={{ margin: 0 }}>
            {device.name} — {device.host}:{device.port}
          </span>
          <Tag minimal intent={flowIntent}>
            {flowLabel}
            {state !== null && ` · state ${state}`}
          </Tag>
        </div>
        {live?.error && (
          <Callout intent="danger" style={{ marginTop: 8 }}>
            {live.error}
          </Callout>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '0 24px',
            marginTop: 12,
          }}
        >
          <Metric label="State of charge" value={fmt(usable.soc, '%', 0)} />
          <Metric
            label="Battery voltage"
            value={fmt(values?.voltage_v ?? null, 'V', 2)}
          />
          <Metric
            label="Battery current"
            value={fmt(values?.current_a ?? null, 'A', 2)}
          />
          <Metric
            label="Battery power"
            value={
              values?.power_w == null ? '—' : `${Math.round(values.power_w)} W`
            }
          />
          <Metric
            label="AC power"
            value={
              values?.ac_power_w == null
                ? '—'
                : `${Math.round(values.ac_power_w)} W`
            }
          />
          <Metric
            label="Energy stored"
            value={
              usable.capacityKwh == null
                ? '—'
                : usable.soc == null
                  ? `${usable.capacityKwh.toFixed(2)} kWh`
                  : `${((usable.soc / 100) * usable.capacityKwh).toFixed(2)} / ${usable.capacityKwh.toFixed(2)} kWh`
            }
          />
          <Metric
            label={flow === 'charging' ? 'Time to full' : 'Time to empty'}
            value={etaHours === null ? '—' : formatDuration(etaHours)}
          />
          <Metric
            label="Internal temp"
            value={fmt(values?.internal_temp_c ?? null, '°C')}
          />
          <Metric
            label="MOS temp"
            value={fmt(values?.mos_temp_c ?? null, '°C')}
          />
          <Metric
            label="Total charged"
            value={fmt(values?.total_charge_kwh ?? null, 'kWh', 2)}
          />
          <Metric
            label="Total discharged"
            value={fmt(values?.total_discharge_kwh ?? null, 'kWh', 2)}
          />
          <Metric
            label="Daily charged"
            value={fmt(values?.daily_charge_kwh ?? null, 'kWh', 2)}
          />
          <Metric
            label="Daily discharged"
            value={fmt(values?.daily_discharge_kwh ?? null, 'kWh', 2)}
          />
        </div>
      </div>

      <BatteryHistoryChart deviceId={device.id} from={from} to={to} />
    </div>
  );
}
