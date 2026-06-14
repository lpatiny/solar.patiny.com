/* eslint-disable @typescript-eslint/naming-convention -- API response fields use snake_case */
import type { BatteryHistoryPoint } from '../../../types.ts';

import type { BatteryDevice } from './batteryChargeSeries.ts';
import { batteryColor } from './batteryChargeSeries.ts';

/** One historical power reading from `/api/history`. */
export interface ReadingPoint {
  timestamp: number;
  production_w: number;
  grid_w: number;
  battery_w: number;
  consumption_w: number;
  battery_soc_max: number | null;
}

/** One future solar slot from `/api/forecast`. */
export interface ForecastSlot {
  timestamp: number;
  endTimestamp: number;
  predictedProductionKwh: number;
  isPast: boolean;
}

/** Forecast payload from `/api/forecast`. */
export interface ForecastData {
  slots: ForecastSlot[];
}

interface Point {
  x: number;
  y: number;
}

/** A signed line series for the symmetric power-balance chart. */
export interface BalanceSerie {
  id: string;
  color: string;
  data: Point[];
}

interface ZoomRange {
  startMs: number;
  endMs: number;
}

const SOLAR_COLOR = '#fbbf24';
const GRID_COLOR = '#34d399';
const BYD_COLOR = '#818cf8';
const CONSUMPTION_COLOR = '#c084fc';

/**
 * Resample a sorted (x ascending) series onto sorted target timestamps using a
 * single forward pass of linear interpolation. Targets before the first / after
 * the last point are clamped to the nearest sample; an empty series yields zeros.
 * @param points - the source series, sorted by ascending x
 * @param targetsMs - the target x positions (ms), sorted ascending
 * @returns one resampled y value per target
 */
function resampleOnto(points: Point[], targetsMs: number[]): number[] {
  if (points.length === 0) return new Array<number>(targetsMs.length).fill(0);
  const out: number[] = [];
  let j = 0;
  for (const x of targetsMs) {
    while (j < points.length - 1) {
      const next = points[j + 1];
      if (next && next.x <= x) j++;
      else break;
    }
    const a = points[j];
    const b = points[j + 1];
    if (!a) {
      out.push(0);
    } else if (x <= a.x || !b) {
      out.push(a.y);
    } else {
      const span = b.x - a.x;
      out.push(span === 0 ? b.y : a.y + ((x - a.x) / span) * (b.y - a.y));
    }
  }
  return out;
}

/**
 * Signed Marstek AC power: discharging is positive (supplies the bus) and
 * charging is negative (draws from it); a null/idle reading counts as zero.
 * @param acPowerW - the device's signed AC power reading, or null
 * @returns the signed power in watts
 */
function signedAcPower(acPowerW: number | null): number {
  return acPowerW === null ? 0 : acPowerW;
}

/**
 * Build the six signed lines of the symmetric power-balance chart, all sampled
 * on the Fronius reading timestamps so the vertical sum is exactly zero at every
 * point. Power supplied to the house bus is positive (Solar, grid import,
 * battery discharge); power drawn from it is negative (consumption, grid export,
 * battery charge). Consumption is the negated sum of the other five lines, which
 * equals the true household load and guarantees the balance.
 * @param readings - Fronius readings for the selected day
 * @param batteries - the Marstek batteries, in display order
 * @param historyById - per-battery reading history keyed by device id
 * @param zoomRange - the active zoom window, or null for the full day
 * @returns the signed series and the largest absolute value (for a symmetric axis)
 */
export function buildPowerBalanceSeries(
  readings: ReadingPoint[],
  batteries: BatteryDevice[],
  historyById: Record<number, BatteryHistoryPoint[]>,
  zoomRange: ZoomRange | null,
): { series: BalanceSerie[]; yMax: number } {
  const visible = zoomRange
    ? readings.filter((r) => {
        const ms = r.timestamp * 1000;
        return ms >= zoomRange.startMs && ms <= zoomRange.endMs;
      })
    : readings;

  const targetsMs: number[] = [];
  const solar: Point[] = [];
  const grid: Point[] = [];
  const byd: Point[] = [];
  for (const r of visible) {
    const x = r.timestamp * 1000;
    targetsMs.push(x);
    solar.push({ x, y: Math.round(r.production_w) });
    grid.push({ x, y: Math.round(r.grid_w) });
    byd.push({ x, y: Math.round(r.battery_w) });
  }

  const batterySeries: BalanceSerie[] = [];
  const batteryValues: number[][] = [];
  for (const [index, device] of batteries.entries()) {
    const points: Point[] = [];
    for (const row of historyById[device.id] ?? []) {
      points.push({
        x: row.timestamp * 1000,
        y: signedAcPower(row.ac_power_w),
      });
    }
    const resampled = resampleOnto(points, targetsMs);
    const values: number[] = [];
    const data: Point[] = [];
    for (const [i, x] of targetsMs.entries()) {
      const y = Math.round(resampled[i] ?? 0);
      values.push(y);
      data.push({ x, y });
    }
    batteryValues.push(values);
    batterySeries.push({
      id: `Battery ${device.name}`,
      color: batteryColor(index),
      data,
    });
  }

  const consumption: Point[] = [];
  for (const [i, point] of solar.entries()) {
    let sum = point.y + (grid[i]?.y ?? 0) + (byd[i]?.y ?? 0);
    for (const values of batteryValues) sum += values[i] ?? 0;
    consumption.push({ x: point.x, y: -sum });
  }

  const series: BalanceSerie[] = [
    { id: 'Solar', color: SOLAR_COLOR, data: solar },
    { id: 'Grid', color: GRID_COLOR, data: grid },
    { id: 'BYD', color: BYD_COLOR, data: byd },
    ...batterySeries,
    { id: 'Consumption', color: CONSUMPTION_COLOR, data: consumption },
  ];

  let yMax = 0;
  for (const serie of series) {
    for (const point of serie.data) {
      const magnitude = Math.abs(point.y);
      if (magnitude > yMax) yMax = magnitude;
    }
  }

  return { series, yMax };
}

/**
 * Build the dashed solar-production forecast line, anchored at the last actual
 * reading so it continues from where history ends. Only solar is forecast; the
 * other balance lines have no prediction.
 * @param readings - Fronius readings for the selected day
 * @param forecast - the forecast payload from `/api/forecast`
 * @returns one dashed solar series, or an empty array when there is nothing to draw
 */
export function buildSolarForecastSeries(
  readings: ReadingPoint[],
  forecast: ForecastData,
): BalanceSerie[] {
  const futureSlots = forecast.slots.filter((s) => !s.isPast);
  if (futureSlots.length === 0) return [];

  const last = readings.at(-1);
  const data: Point[] = last
    ? [{ x: last.timestamp * 1000, y: Math.round(last.production_w) }]
    : [];
  for (const slot of futureSlots) {
    const midMs = ((slot.timestamp + slot.endTimestamp) / 2) * 1000;
    data.push({
      x: midMs,
      y: Math.round((slot.predictedProductionKwh / 3) * 1000),
    });
  }
  return [{ id: 'Solar_forecast', color: SOLAR_COLOR, data }];
}
