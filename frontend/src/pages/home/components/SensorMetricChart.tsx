/* eslint-disable @typescript-eslint/naming-convention -- API fields use snake_case */
import { ResponsiveLine } from '@nivo/line';
import { useMemo } from 'react';

import type { HistoryResolution, NivoSeries } from './historyChartUtils.ts';
import {
  dailyKeyToMonthYear,
  dailyKeyToShort,
  formatTime,
  hourlyKeyToTime,
  nivoTheme,
} from './historyChartUtils.ts';

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

/** True when at least one reading carries a non-null value for the metric. */
export function hasMetric(
  readings: SensorReadingPoint[],
  metric: SensorMetric,
): boolean {
  for (const reading of readings) {
    if (reading[metric] !== null) return true;
  }
  return false;
}

const SENSOR_COLORS = [
  '#60a5fa',
  '#f97316',
  '#34d399',
  '#c084fc',
  '#fbbf24',
  '#f87171',
  '#22d3ee',
  '#a3e635',
];

const sharedLineProps = {
  theme: nivoTheme,
  margin: { top: 10, right: 60, bottom: 40, left: 50 },
  xScale: { type: 'point' as const },
  yScale: {
    type: 'linear' as const,
    min: 'auto' as const,
    max: 'auto' as const,
  },
  enablePoints: false,
  enableGridX: false,
  curve: 'monotoneX' as const,
  lineWidth: 2,
  useMesh: true,
};

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function axisLabel(
  key: string,
  resolution: HistoryResolution,
  isMultiYear: boolean,
): string {
  if (!key.includes('|')) return key; // monthly keys carry no separator
  if (resolution === 'hourly') return hourlyKeyToTime(key);
  return isMultiYear ? dailyKeyToMonthYear(key) : dailyKeyToShort(key);
}

/**
 * Renders one line per sensor for a single metric. Presentational only — the
 * caller supplies the already-fetched sensors/readings and the bucket
 * resolution. Returns null when the chosen metric has no data to plot.
 * @param props - sensors, readings, resolution, metric and display options
 */
export default function SensorMetricChart({
  sensors,
  readings,
  resolution,
  metric,
  axisSuffix,
  decimals = 0,
  height = 200,
}: {
  sensors: SensorMeta[];
  readings: SensorReadingPoint[];
  resolution: HistoryResolution;
  metric: SensorMetric;
  axisSuffix: string;
  decimals?: number;
  height?: number;
}) {
  const series = useMemo<NivoSeries[]>(() => {
    const bySensor = new Map<string, SensorReadingPoint[]>();
    for (const reading of readings) {
      const existing = bySensor.get(reading.sensor_id);
      if (existing) existing.push(reading);
      else bySensor.set(reading.sensor_id, [reading]);
    }
    const result: NivoSeries[] = [];
    let colorIndex = 0;
    for (const sensor of sensors) {
      const points = bySensor.get(sensor.id);
      if (!points) continue;
      const data = [];
      for (const point of points) {
        const value = point[metric];
        if (value === null) continue;
        data.push({
          x: formatTime(point.timestamp, resolution),
          y: round(value, decimals),
        });
      }
      const color =
        SENSOR_COLORS[colorIndex % SENSOR_COLORS.length] ?? '#60a5fa';
      colorIndex++;
      if (data.length > 0) result.push({ id: sensor.name, color, data });
    }
    return result;
  }, [sensors, readings, resolution, metric, decimals]);

  const isMultiYear = useMemo(() => {
    if (resolution !== 'daily' || readings.length === 0) return false;
    let min = Infinity;
    let max = -Infinity;
    for (const reading of readings) {
      if (reading.timestamp < min) min = reading.timestamp;
      if (reading.timestamp > max) max = reading.timestamp;
    }
    return (
      new Date(min * 1000).getFullYear() !== new Date(max * 1000).getFullYear()
    );
  }, [resolution, readings]);

  const tickValues = useMemo(() => {
    const seen = new Set<string>();
    const labels: string[] = [];
    const sorted = readings.toSorted((a, b) => a.timestamp - b.timestamp);
    for (const reading of sorted) {
      const label = formatTime(reading.timestamp, resolution);
      if (!seen.has(label)) {
        seen.add(label);
        labels.push(label);
      }
    }
    const step = Math.max(1, Math.round(labels.length / 8));
    return labels.filter((_, i) => i % step === 0);
  }, [readings, resolution]);

  if (series.length === 0) return null;

  return (
    <div style={{ height }}>
      <ResponsiveLine
        {...sharedLineProps}
        data={series}
        colors={({ color }) => color}
        axisBottom={{
          tickSize: 0,
          tickPadding: 8,
          tickRotation: -30,
          tickValues,
          format: (key: string) => axisLabel(key, resolution, isMultiYear),
        }}
        axisLeft={{
          tickSize: 0,
          tickPadding: 8,
          format: (v: number) => `${v}${axisSuffix}`,
          tickValues: 5,
        }}
        legends={[
          {
            anchor: 'top-right',
            direction: 'column',
            translateX: -5,
            translateY: 5,
            itemWidth: 120,
            itemHeight: 18,
            symbolSize: 10,
            symbolShape: 'circle',
          },
        ]}
      />
    </div>
  );
}
