import type { Device, DeviceLive } from '../../../types.ts';

export type BatteryFlow = 'charging' | 'discharging' | 'idle';

// Below this many watts the battery is treated as idle rather than asserting a
// direction from sensor noise.
const IDLE_THRESHOLD_W = 20;

/**
 * Derive the charge/discharge direction and magnitude from the AC power reading.
 *
 * Verified against the live device: while the SOC was rising (charging) the AC
 * power register read a negative value, so **negative AC power = charging** and
 * positive = discharging. The DC battery-power register is unreliable on this
 * unit (reads 0 while charging), so direction is taken from AC power.
 * @param acPowerW - AC power in watts, or null when unavailable.
 * @returns The flow direction and absolute power in watts.
 */
export function batteryFlow(acPowerW: number | null): {
  flow: BatteryFlow;
  watts: number;
} {
  if (acPowerW === null) return { flow: 'idle', watts: 0 };
  const watts = Math.abs(Math.round(acPowerW));
  if (watts < IDLE_THRESHOLD_W) return { flow: 'idle', watts: 0 };
  return { flow: acPowerW < 0 ? 'charging' : 'discharging', watts };
}

/**
 * Format a power magnitude in watts, switching to kW above 1000 W.
 * @param watts - Absolute power in watts.
 * @returns e.g. "797 W" or "1.20 kW".
 */
export function formatPower(watts: number): string {
  return watts >= 1000
    ? `${(watts / 1000).toFixed(2)} kW`
    : `${Math.round(watts)} W`;
}

/** Normalised data for rendering one Marstek device as a battery cell. */
export interface BatteryCellData {
  soc: number | null;
  flow: BatteryFlow;
  watts: number;
  offline: boolean;
  statusLabel: string;
  subtitle: string;
  capacityKwh: number | null;
}

/**
 * Derive battery-cell props from a device and its latest live snapshot.
 * @param device - The configured device.
 * @param live - The latest live snapshot, or null when never polled.
 * @returns The normalised cell data.
 */
export function deviceCellData(
  device: Device,
  live: DeviceLive | null,
): BatteryCellData {
  const values = live?.values ?? null;
  const { flow, watts } = batteryFlow(values?.ac_power_w ?? null);
  const offline =
    !device.enabled || live?.error != null || Boolean(live?.is_stale);
  const statusLabel = !device.enabled
    ? 'disabled'
    : live?.error != null
      ? 'error'
      : live?.is_stale
        ? 'stale'
        : 'online';
  return {
    soc: values?.soc_pct ?? null,
    flow,
    watts,
    offline,
    statusLabel,
    subtitle: `${device.host}:${device.port}`,
    capacityKwh: values?.energy_kwh ?? null,
  };
}
