import { Button, ButtonGroup } from '@blueprintjs/core';
import { ResponsiveLine } from '@nivo/line';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { NivoComputedSerie } from './BrushLayer.tsx';
import { BrushLayer } from './BrushLayer.tsx';
import { batteryColor } from './batteryChargeSeries.ts';
import type { ForecastData, ReadingPoint } from './powerBalanceSeries.ts';
import {
  buildPowerBalanceSeries,
  buildSolarForecastSeries,
} from './powerBalanceSeries.ts';
import { useBatteryCharge } from './useBatteryCharge.ts';

type NivoLayer = NonNullable<
  Parameters<typeof ResponsiveLine>[0]['layers']
>[number];

// How often the live (today) reading and battery-charge series re-poll.
const LIVE_POLL_MS = 30_000;

const nivoTheme = {
  background: 'transparent',
  text: { fill: '#94a3b8', fontSize: 11 },
  axis: {
    ticks: {
      line: { stroke: '#334155' },
      text: { fill: '#94a3b8', fontSize: 11 },
    },
    legend: { text: { fill: '#94a3b8', fontSize: 12 } },
  },
  grid: { line: { stroke: '#334155', strokeDasharray: '3 3' } },
  legends: { text: { fill: '#94a3b8', fontSize: 12 } },
  crosshair: { line: { stroke: '#94a3b8' } },
  tooltip: {
    container: {
      background: '#263347',
      border: '1px solid #334155',
      borderRadius: 8,
      color: '#f1f5f9',
      fontSize: 12,
    },
  },
};

function MixedLineLayer({
  series,
  lineGenerator,
}: {
  series: NivoComputedSerie[];
  lineGenerator: (points: Array<{ x: number; y: number }>) => string | null;
}) {
  return series.map((serie) => {
    const isForecast = serie.id.endsWith('_forecast');
    const path = lineGenerator(
      serie.data.map((d) => ({ x: d.position.x, y: d.position.y })),
    );
    return (
      <path
        key={serie.id}
        d={path ?? ''}
        fill="none"
        stroke={serie.color}
        strokeWidth={2}
        strokeDasharray={isForecast ? '7,4' : undefined}
        strokeOpacity={isForecast ? 0.85 : 1}
      />
    );
  });
}

function ForecastDotsLayer({ series }: { series: NivoComputedSerie[] }) {
  return series
    .filter((s) => s.id.endsWith('_forecast'))
    .flatMap((serie, si) =>
      serie.data.map((d, di) => (
        <circle
          key={`${si}-${di}`}
          cx={d.position.x}
          cy={d.position.y}
          r={4}
          fill={serie.color}
          opacity={0.8}
        />
      )),
    );
}

function dayBounds(date: Date): { from: number; to: number } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 0);
  return {
    from: Math.floor(start.getTime() / 1000),
    to: Math.floor(end.getTime() / 1000),
  };
}

function formatDateLabel(date: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString([], { dateStyle: 'medium' });
}

function getThreeHourTicksMs(midnightMs: number): number[] {
  return Array.from({ length: 9 }, (_, i) => midnightMs + i * 3 * 3600_000);
}

function formatTickMs(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Round a watt magnitude up to a clean 500 W step, with a 500 W floor.
 * @param value
 */
function niceAxisMax(value: number): number {
  return Math.max(500, Math.ceil(value / 500) * 500);
}

export default function DayPowerChart() {
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [data, setData] = useState<ReadingPoint[]>([]);
  const [forecast, setForecast] = useState<ForecastData | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [zoomRange, setZoomRange] = useState<{
    startMs: number;
    endMs: number;
  } | null>(null);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sel = new Date(selectedDate);
  sel.setHours(0, 0, 0, 0);
  const isToday = sel.getTime() === today.getTime();

  const toggleId = useCallback((id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    setZoomRange(null);
    let cancelled = false;
    const { from, to } = dayBounds(selectedDate);
    const load = () =>
      fetch(`/api/history?resolution=raw&from=${from}&to=${to}`)
        .then((r) => r.json())
        .then((rows) => {
          if (!cancelled) setData(rows as ReadingPoint[]);
        })
        .catch(() => {
          if (!cancelled) setData([]);
        });
    void load();
    // Today's readings keep accumulating, so re-poll to keep the graph live.
    // Past days are immutable, so no interval is started for them.
    const interval = isToday
      ? setInterval(() => void load(), LIVE_POLL_MS)
      : undefined;
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [selectedDate, isToday]);

  useEffect(() => {
    if (!isToday) {
      setForecast(null);
      return;
    }
    const load = () =>
      fetch('/api/forecast')
        .then((r) => r.json())
        .then((d) => setForecast(d as ForecastData))
        .catch(() => undefined);
    void load();
    const interval = setInterval(() => void load(), 10 * 60_000);
    return () => clearInterval(interval);
  }, [isToday]);

  const { from: dayFrom, to: dayTo } = useMemo(
    () => dayBounds(selectedDate),
    [selectedDate],
  );
  const { batteries, historyById: batteryHistoryById } = useBatteryCharge(
    dayFrom,
    dayTo,
    isToday,
  );

  const midnightMs = useMemo(() => {
    const d = new Date(selectedDate);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, [selectedDate]);

  const nextMidnightMs = midnightMs + 86_400_000;

  const handleZoom = useCallback(
    (startFrac: number, endFrac: number) => {
      setZoomRange((prev) => {
        const currentMin = prev ? prev.startMs : midnightMs;
        const currentMax = prev ? prev.endMs : nextMidnightMs;
        const range = currentMax - currentMin;
        return {
          startMs: Math.round(currentMin + startFrac * range),
          endMs: Math.round(currentMin + endFrac * range),
        };
      });
    },
    [midnightMs, nextMidnightMs],
  );

  const resetZoom = useCallback(() => setZoomRange(null), []);

  const { series: balanceSeries, yMax: balanceYMax } = useMemo(
    () =>
      buildPowerBalanceSeries(data, batteries, batteryHistoryById, zoomRange),
    [data, batteries, batteryHistoryById, zoomRange],
  );

  const forecastSeries = useMemo(() => {
    if (!isToday || !forecast) return [];
    const series = buildSolarForecastSeries(data, forecast);
    if (!zoomRange) return series;
    return series.map((s) => {
      const filtered = s.data.filter(
        (p) => p.x >= zoomRange.startMs && p.x <= zoomRange.endMs,
      );
      // Include the first point beyond the zoom end so the line extends to the
      // chart boundary rather than ending abruptly at the last in-range point.
      const nextPoint = s.data.find((p) => p.x > zoomRange.endMs);
      if (nextPoint) filtered.push(nextPoint);
      return { ...s, data: filtered };
    });
  }, [isToday, forecast, data, zoomRange]);

  const axisMax = useMemo(() => {
    let raw = balanceYMax;
    for (const serie of forecastSeries) {
      for (const point of serie.data) {
        const magnitude = Math.abs(point.y);
        if (magnitude > raw) raw = magnitude;
      }
    }
    return niceAxisMax(raw);
  }, [balanceYMax, forecastSeries]);

  const yTickValues = useMemo(
    () => [-axisMax, -axisMax / 2, 0, axisMax / 2, axisMax],
    [axisMax],
  );

  const allSeries = useMemo(
    () => [
      ...balanceSeries.filter((s) => !hiddenIds.has(s.id)),
      ...forecastSeries.filter(
        (s) => !hiddenIds.has(s.id.replace('_forecast', '')),
      ),
    ],
    [balanceSeries, forecastSeries, hiddenIds],
  );

  const seriesMeta = useMemo(
    () => [
      { id: 'Solar', label: 'Solar', color: '#fbbf24' },
      { id: 'Grid', label: 'Grid', color: '#34d399' },
      { id: 'BYD', label: 'BYD', color: '#818cf8' },
      ...batteries.map((battery, index) => ({
        id: `Battery ${battery.name}`,
        label: battery.name,
        color: batteryColor(index),
      })),
      { id: 'Consumption', label: 'Consumption', color: '#c084fc' },
    ],
    [batteries],
  );

  const xMin = zoomRange ? zoomRange.startMs : midnightMs;
  const xMax = zoomRange ? zoomRange.endMs : nextMidnightMs;

  const ticks = getThreeHourTicksMs(midnightMs);
  const visibleTicks = useMemo(
    () => ticks.filter((t) => t >= xMin && t <= xMax),
    [ticks, xMin, xMax],
  );

  const markers = useMemo(() => {
    const zeroLine = {
      axis: 'y' as const,
      value: 0,
      lineStyle: { stroke: '#64748b', strokeWidth: 1 },
    };
    if (!isToday) return [zeroLine];
    return [
      zeroLine,
      {
        axis: 'x' as const,
        value: Date.now(),
        lineStyle: {
          stroke: '#94a3b8',
          strokeWidth: 1,
          strokeDasharray: '4,3',
        },
      },
    ];
  }, [isToday]);

  const labelById = useCallback(
    (id: string) => seriesMeta.find((s) => s.id === id)?.label ?? id,
    [seriesMeta],
  );

  const makeBrushLayer = useCallback(
    (props: {
      innerWidth: number;
      innerHeight: number;
      series: NivoComputedSerie[];
    }) => (
      <BrushLayer
        innerWidth={props.innerWidth}
        innerHeight={props.innerHeight}
        series={props.series}
        labelById={labelById}
        onZoom={handleZoom}
        onReset={resetZoom}
      />
    ),
    [handleZoom, resetZoom, labelById],
  );

  return (
    <div className="card" style={{ gridColumn: '1 / -1' }}>
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          gap: 8,
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <span className="card-title" style={{ margin: 0 }}>
          {formatDateLabel(selectedDate)} — Power
        </span>
        <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
          {zoomRange && (
            <Button size="small" variant="minimal" onClick={resetZoom}>
              Reset zoom
            </Button>
          )}
          <ButtonGroup variant="minimal">
            <Button
              icon="chevron-left"
              size="small"
              onClick={() => {
                setSelectedDate((d) => {
                  const prev = new Date(d);
                  prev.setDate(prev.getDate() - 1);
                  return prev;
                });
              }}
            />
            <Button
              size="small"
              disabled={isToday}
              onClick={() => {
                setSelectedDate((d) => {
                  const next = new Date(d);
                  next.setDate(next.getDate() + 1);
                  return next;
                });
              }}
              icon="chevron-right"
            />
          </ButtonGroup>
        </div>
      </div>

      {data.length === 0 && !isToday ? (
        <div
          style={{
            color: 'var(--text-secondary)',
            padding: '40px 0',
            textAlign: 'center',
          }}
        >
          No readings for this day.
        </div>
      ) : (
        <div style={{ height: 280 }}>
          <ResponsiveLine
            data={allSeries}
            theme={nivoTheme}
            colors={(d) => (d as unknown as { color: string }).color}
            margin={{ top: 10, right: 60, bottom: 50, left: 70 }}
            xScale={{ type: 'linear', min: xMin, max: xMax }}
            yScale={{ type: 'linear', min: -axisMax, max: axisMax }}
            axisBottom={{
              tickSize: 0,
              tickPadding: 8,
              tickRotation: -30,
              tickValues: visibleTicks,
              format: formatTickMs,
            }}
            axisLeft={{
              tickSize: 0,
              tickPadding: 8,
              format: (v: number) => `${Math.round(v)} W`,
              tickValues: yTickValues,
            }}
            enablePoints={false}
            enableGridX={false}
            curve="monotoneX"
            lineWidth={2}
            useMesh={false}
            markers={markers}
            layers={[
              'grid',
              'markers',
              'axes',
              MixedLineLayer as unknown as NivoLayer,
              ForecastDotsLayer as unknown as NivoLayer,
              'crosshair',
              'mesh',
              'legends',
              makeBrushLayer as unknown as NivoLayer,
            ]}
            legends={[
              {
                anchor: 'bottom-right',
                direction: 'row',
                translateY: 48,
                itemWidth: 110,
                itemHeight: 14,
                symbolSize: 10,
                symbolShape: 'circle',
                onClick: (datum) => toggleId(datum.id as string),
                data: seriesMeta.map((s) => ({
                  id: s.id,
                  label: s.label,
                  color: hiddenIds.has(s.id) ? '#334155' : s.color,
                })),
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
