/** Distinct line colors for the per-battery charging series. */
const BATTERY_COLORS = ['#38bdf8', '#fb7185', '#f97316', '#a78bfa', '#2dd4bf'];

/**
 * Stable line color for the battery at the given index.
 * @param index - position of the battery in the device list
 * @returns a hex color, cycling through the palette
 */
export function batteryColor(index: number): string {
  return BATTERY_COLORS[index % BATTERY_COLORS.length] ?? '#38bdf8';
}

/** A battery device as needed to build its charging series. */
export interface BatteryDevice {
  id: number;
  name: string;
}
