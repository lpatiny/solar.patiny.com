import { Icon } from '@blueprintjs/core';

import type { Device, DeviceLive } from '../../../types.ts';

import BatteryCell from './BatteryCell.tsx';
import {
  batteryFlow,
  deviceCellData,
  formatPower,
  usableBattery,
} from './batteryStatus.ts';

interface BatteriesSummaryProps {
  homeSoc: number;
  homePowerW: number;
  homeHost: string | null;
  homeCapacityKwh: number;
  homeReservePct: number;
  marstekReservePct: number;
  homeOffline: boolean;
  devices: Device[];
  liveById: Record<number, DeviceLive>;
  onOpen: () => void;
}

const TOTAL_FLOW_VISUAL = {
  charging: { icon: 'arrow-up', color: '#34d399', label: 'Charging' },
  discharging: { icon: 'arrow-down', color: '#f87171', label: 'Discharging' },
  idle: { icon: 'arrows-horizontal', color: '#fbbf24', label: 'Idle' },
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
 * @param root0.homeReservePct - BYD reserve floor in percent, hidden from display.
 * @param root0.marstekReservePct - Marstek reserve floor in percent, hidden from display.
 * @param root0.homeOffline - Whether the home battery reading is stale.
 * @param root0.devices - The configured Marstek devices.
 * @param root0.liveById - Latest live snapshot per device id.
 * @param root0.onOpen - Called when a Marstek cell is clicked.
 * @returns The grouped batteries tile.
 */
export default function BatteriesSummary({
  homeSoc,
  homePowerW,
  homeHost,
  homeCapacityKwh,
  homeReservePct,
  marstekReservePct,
  homeOffline,
  devices,
  liveById,
  onOpen,
}: BatteriesSummaryProps) {
  const home = usableBattery(homeSoc, homeCapacityKwh, homeReservePct);
  let totalStored = ((home.soc ?? 0) / 100) * (home.capacityKwh ?? 0);
  let totalCapacity = home.capacityKwh ?? 0;
  let netPowerW = homePowerW;
  for (const device of devices) {
    const values = liveById[device.id]?.values;
    if (!values) continue;
    if (values.energy_kwh !== null && values.soc_pct !== null) {
      const usable = usableBattery(
        values.soc_pct,
        values.energy_kwh,
        marstekReservePct,
      );
      totalStored += ((usable.soc ?? 0) / 100) * (usable.capacityKwh ?? 0);
      totalCapacity += usable.capacityKwh ?? 0;
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
              {totalVisual.label}
              {netFlow !== 'idle' && ` · ${formatPower(netWatts)}`}
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
          soc={home.soc}
          flow={homeFlow.flow}
          watts={homeFlow.watts}
          subtitle={homeHost}
          capacityKwh={home.capacityKwh}
        />
        {devices.map((device) => {
          const data = deviceCellData(device, liveById[device.id] ?? null);
          const usable = usableBattery(
            data.soc,
            data.capacityKwh,
            marstekReservePct,
          );
          return (
            <BatteryCell
              key={device.id}
              name={device.name}
              statusLabel={data.statusLabel}
              offline={data.offline}
              soc={usable.soc}
              flow={data.flow}
              watts={data.watts}
              subtitle={data.subtitle}
              capacityKwh={usable.capacityKwh}
              onClick={onOpen}
            />
          );
        })}
      </div>
    </div>
  );
}
