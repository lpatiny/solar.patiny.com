import { Icon } from '@blueprintjs/core';
import { useEffect, useState } from 'react';

import type { Device, DeviceLive } from '../../../types.ts';

import BatteryCell from './BatteryCell.tsx';
import { batteryFlow, deviceCellData, formatPower } from './batteryStatus.ts';

interface BatteriesSummaryProps {
  homeSoc: number;
  homePowerW: number;
  homeHost: string | null;
  homeCapacityKwh: number;
  homeOffline: boolean;
  onOpen: () => void;
}

const POLL_MS = 5_000;

const TOTAL_FLOW_VISUAL = {
  charging: { icon: 'arrow-up', color: '#34d399' },
  discharging: { icon: 'arrow-down', color: '#f87171' },
  idle: { icon: 'arrows-horizontal', color: '#fbbf24' },
} as const;

/**
 * Single home-page tile grouping every battery: the BYD home battery plus each
 * configured Marstek device, with a combined stored-energy total and net-flow
 * arrow on top. Clicking a Marstek cell opens the Batteries tab.
 * @param root0 - Component props.
 * @param root0.homeSoc - Home battery state of charge in percent.
 * @param root0.homePowerW - Home battery power in watts (negative = charging).
 * @param root0.homeHost - Home battery IP/host, or null.
 * @param root0.homeCapacityKwh - Home battery capacity in kWh.
 * @param root0.homeOffline - Whether the home battery reading is stale.
 * @param root0.onOpen - Called when a Marstek cell is clicked.
 * @returns The grouped batteries tile.
 */
export default function BatteriesSummary({
  homeSoc,
  homePowerW,
  homeHost,
  homeCapacityKwh,
  homeOffline,
  onOpen,
}: BatteriesSummaryProps) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [liveById, setLiveById] = useState<Record<number, DeviceLive>>({});

  useEffect(() => {
    let cancelled = false;
    fetch('/api/devices')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Device[]) => {
        if (!cancelled) setDevices(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (devices.length === 0) return undefined;
    let cancelled = false;
    function loadDevice(device: Device) {
      fetch(`/api/devices/${device.id}/live`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: DeviceLive | null) => {
          if (!cancelled && data) {
            setLiveById((prev) => ({ ...prev, [device.id]: data }));
          }
        })
        .catch(() => undefined);
    }
    function load() {
      for (const device of devices) loadDevice(device);
    }
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [devices]);

  let totalStored = (homeSoc / 100) * homeCapacityKwh;
  let totalCapacity = homeCapacityKwh;
  let netPowerW = homePowerW;
  for (const device of devices) {
    const values = liveById[device.id]?.values;
    if (!values) continue;
    if (values.energy_kwh !== null && values.soc_pct !== null) {
      totalStored += (values.soc_pct / 100) * values.energy_kwh;
      totalCapacity += values.energy_kwh;
    }
    if (values.ac_power_w !== null) netPowerW += values.ac_power_w;
  }

  const { flow: netFlow, watts: netWatts } = batteryFlow(netPowerW);
  const totalVisual = TOTAL_FLOW_VISUAL[netFlow];
  const homeFlow = batteryFlow(homePowerW);

  return (
    <div className="card">
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <span className="card-title" style={{ margin: 0 }}>
          Batteries
        </span>
        <div style={{ alignItems: 'center', display: 'flex', gap: 12 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
              Total stored {netFlow !== 'idle' && `· ${formatPower(netWatts)}`}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              {totalStored.toFixed(1)} / {totalCapacity.toFixed(1)} kWh
            </div>
          </div>
          <Icon icon={totalVisual.icon} size={32} color={totalVisual.color} />
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <BatteryCell
          name="BYD"
          statusLabel={homeOffline ? 'offline' : 'online'}
          offline={homeOffline}
          soc={homeSoc}
          flow={homeFlow.flow}
          watts={homeFlow.watts}
          subtitle={homeHost}
          capacityKwh={homeCapacityKwh}
        />
        {devices.map((device) => {
          const data = deviceCellData(device, liveById[device.id] ?? null);
          return (
            <BatteryCell
              key={device.id}
              name={device.name}
              statusLabel={data.statusLabel}
              offline={data.offline}
              soc={data.soc}
              flow={data.flow}
              watts={data.watts}
              subtitle={data.subtitle}
              capacityKwh={data.capacityKwh}
              onClick={onOpen}
            />
          );
        })}
      </div>
    </div>
  );
}
