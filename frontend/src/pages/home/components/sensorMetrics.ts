/* eslint-disable @typescript-eslint/naming-convention -- API fields use snake_case */

export interface SensorMeta {
  id: string;
  name: string;
}

export interface SensorReadingPoint {
  timestamp: number;
  sensor_id: string;
  temperature_c: number;
  humidity_pct: number | null;
  co2_ppm: number | null;
  pm25_ugm3: number | null;
}

export type SensorMetric =
  | 'temperature_c'
  | 'humidity_pct'
  | 'co2_ppm'
  | 'pm25_ugm3';

export interface MetricMeta {
  metric: SensorMetric;
  label: string;
  axisSuffix: string;
  decimals: number;
}

/** Every metric a DIRIGERA environment sensor can report, in display order. */
export const SENSOR_METRICS: MetricMeta[] = [
  {
    metric: 'temperature_c',
    label: 'Temperature (°C)',
    axisSuffix: '°',
    decimals: 1,
  },
  {
    metric: 'humidity_pct',
    label: 'Humidity (%)',
    axisSuffix: '%',
    decimals: 0,
  },
  { metric: 'co2_ppm', label: 'CO₂ (ppm)', axisSuffix: '', decimals: 0 },
  { metric: 'pm25_ugm3', label: 'PM2.5 (µg/m³)', axisSuffix: '', decimals: 0 },
];

/**
 * True when at least one reading carries a non-null value for the metric.
 * @param readings - the sensor readings to scan
 * @param metric - the metric to look for
 * @returns whether any reading has a value for the metric
 */
export function hasMetric(
  readings: SensorReadingPoint[],
  metric: SensorMetric,
): boolean {
  for (const reading of readings) {
    if (reading[metric] !== null) return true;
  }
  return false;
}
