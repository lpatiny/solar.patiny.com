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

/**
 * Estimate the time until the battery reaches full (when charging) or empty
 * (when discharging), from the current power flow. Assumes the current power is
 * held constant, so it is a rough projection rather than a guarantee.
 * @param flow - Charge/discharge/standby direction.
 * @param watts - Absolute power magnitude in watts.
 * @param soc - State of charge in percent (0–100), or null when unknown.
 * @param capacityKwh - Capacity in kWh, or null when unknown.
 * @returns Hours until full/empty, or null when not applicable (idle, no power, or unknown).
 */
export function batteryEtaHours(
  flow: BatteryFlow,
  watts: number,
  soc: number | null,
  capacityKwh: number | null,
): number | null {
  if (flow === 'idle' || watts <= 0 || soc === null || capacityKwh === null) {
    return null;
  }
  const stored = (soc / 100) * capacityKwh;
  const energyKwh = flow === 'charging' ? capacityKwh - stored : stored;
  if (energyKwh <= 0) return null;
  return energyKwh / (watts / 1000);
}

/**
 * Format a duration in hours as a compact human string.
 * @param hours - Duration in hours.
 * @returns e.g. "2h 15m" or "45m".
 */
export function formatDuration(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return wholeHours === 0 ? `${minutes}m` : `${wholeHours}h ${minutes}m`;
}

/** A battery's state re-expressed over only its usable (above-reserve) range. */
export interface UsableBattery {
  /** SOC rescaled so 0 % is the reserve floor and 100 % is full, or null. */
  soc: number | null;
  /** Usable capacity (total minus the untouchable reserve) in kWh, or null. */
  capacityKwh: number | null;
}

/**
 * Re-express a battery's state of charge and capacity over only its *usable*
 * range, hiding the bottom `reservePct` that must never be discharged. The SOC
 * is rescaled so 0 % is the reserve floor and 100 % is full, and the capacity
 * drops to the usable amount — so a cell rendered from these values shows the
 * usable energy end to end and the dial truly spans 0–100 %.
 * @param soc - Raw state of charge in percent (0–100), or null when unknown.
 * @param capacityKwh - Raw total capacity in kWh, or null when unknown.
 * @param reservePct - Reserve floor in percent (0–100) that stays untouched.
 * @returns The usable SOC and capacity.
 */
export function usableBattery(
  soc: number | null,
  capacityKwh: number | null,
  reservePct: number,
): UsableBattery {
  const reserve = Math.min(Math.max(reservePct, 0), 99);
  const span = 100 - reserve;
  const usableSoc =
    soc === null
      ? null
      : Math.min(Math.max(((soc - reserve) / span) * 100, 0), 100);
  const usableCapacityKwh =
    capacityKwh === null ? null : (capacityKwh * span) / 100;
  return { soc: usableSoc, capacityKwh: usableCapacityKwh };
}

/**
 * Sum the energy currently stored across the home battery and every Marstek
 * device, in kWh. Uses raw (reserve-included) stored energy so the total matches
 * the per-device figures shown on the battery cards.
 * @param homeSoc - Home battery state of charge in percent, or null when unknown.
 * @param homeCapacityKwh - Home battery total capacity in kWh, or null when unknown.
 * @param devices - The configured Marstek devices.
 * @param liveById - Latest live snapshot per device id.
 * @returns Total stored energy across all batteries, in kWh.
 */
export function sumStoredKwh(
  homeSoc: number | null,
  homeCapacityKwh: number | null,
  devices: Device[],
  liveById: Record<number, DeviceLive>,
): number {
  let total =
    homeSoc !== null && homeCapacityKwh !== null
      ? (homeSoc / 100) * homeCapacityKwh
      : 0;
  for (const device of devices) {
    const live = liveById[device.id];
    if (live?.is_stale) continue;
    const values = live?.values;
    if (values?.soc_pct == null || values.energy_kwh == null) continue;
    total += (values.soc_pct / 100) * values.energy_kwh;
  }
  return total;
}

/**
 * Sum the instantaneous AC power across every Marstek device, in watts, using the
 * same sign convention as the home battery (positive = discharging, negative =
 * charging). Devices without a live power reading — and stale (offline) devices,
 * whose last-known power would otherwise inflate the figure — are skipped.
 * @param devices - The configured Marstek devices.
 * @param liveById - Latest live snapshot per device id.
 * @returns Net Marstek power in watts (positive discharging, negative charging).
 */
export function sumMarstekPowerW(
  devices: Device[],
  liveById: Record<number, DeviceLive>,
): number {
  let total = 0;
  for (const device of devices) {
    const live = liveById[device.id];
    if (live?.is_stale) continue;
    const acPowerW = live?.values?.ac_power_w;
    if (acPowerW == null) continue;
    total += acPowerW;
  }
  return total;
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
