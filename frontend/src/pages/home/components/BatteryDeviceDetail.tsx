import { Button, ButtonGroup, Callout, Slider, Tag } from '@blueprintjs/core';
import { useEffect, useState } from 'react';

import type { ControlParam, Device, DeviceLive } from '../../../types.ts';

import BatteryHistoryChart from './BatteryHistoryChart.tsx';
import LoginPanel from './LoginPanel.tsx';
import ManualControl from './ManualControl.tsx';
import SchedulePanel from './SchedulePanel.tsx';
import { batteryFlow } from './batteryStatus.ts';

interface BatteryDeviceDetailProps {
  device: Device;
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

function ControlRow({ param }: { param: ControlParam }) {
  return (
    <div style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 13 }}>{param.label}</span>
        <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
          current:{' '}
          {param.value === null ? '—' : `${param.value}${param.unit ?? ''}`}
        </span>
      </div>
      {param.kind === 'enum' && param.options ? (
        <ButtonGroup>
          {param.options.map((option) => (
            <Button key={option.value} disabled>
              {option.label}
            </Button>
          ))}
        </ButtonGroup>
      ) : (
        <Slider
          min={param.min ?? 0}
          max={param.max ?? 100}
          stepSize={1}
          labelRenderer={false}
          value={param.value ?? param.min ?? 0}
          disabled
          onChange={() => undefined}
        />
      )}
    </div>
  );
}

/**
 * Full detail view for one battery device: all measurements, control preview
 * and history.
 * @param root0 - Component props.
 * @param root0.device - The device to display.
 * @param root0.from - History range start (unix seconds).
 * @param root0.to - History range end (unix seconds).
 * @returns The device detail view.
 */
export default function BatteryDeviceDetail({
  device,
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
  const state = values?.inverter_state ?? null;
  const { flow } = batteryFlow(values?.ac_power_w ?? null);
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
          <Metric
            label="State of charge"
            value={fmt(values?.soc_pct ?? null, '%', 0)}
          />
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
              values?.energy_kwh == null
                ? '—'
                : values.soc_pct == null
                  ? `${values.energy_kwh.toFixed(2)} kWh`
                  : `${((values.soc_pct / 100) * values.energy_kwh).toFixed(2)} / ${values.energy_kwh.toFixed(2)} kWh`
            }
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

      <div className="card">
        <span className="card-title">Control</span>
        <LoginPanel>
          <ManualControl deviceId={device.id} />
        </LoginPanel>
        <Callout intent="warning" style={{ margin: '12px 0' }}>
          The remaining widgets below are read-only previews of what can be
          controlled and show the current values.
        </Callout>
        {live && live.control.length > 0 ? (
          live.control.map((param) => (
            <ControlRow key={param.key} param={param} />
          ))
        ) : (
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            No control data yet (waiting for the first successful poll).
          </div>
        )}
      </div>

      <div className="card">
        <span className="card-title">Schedule (per day / hour)</span>
        <Callout intent="primary" style={{ margin: '8px 0' }}>
          Slots are pushed to the battery and run on the device itself. Charge
          slots draw from the grid; discharge slots feed it. The device cannot
          report its current schedule, so this editor is write-only.
        </Callout>
        <LoginPanel>
          <SchedulePanel deviceId={device.id} />
        </LoginPanel>
      </div>

      <BatteryHistoryChart deviceId={device.id} from={from} to={to} />
    </div>
  );
}
