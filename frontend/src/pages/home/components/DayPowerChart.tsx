import { Button, ButtonGroup } from '@blueprintjs/core';
import { ResponsiveLine } from '@nivo/line';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

// Candidate tick spacings (ms), ascending; each is an even divisor of 24 h so
// that, aligned to local midnight, ticks always land on round clock times.
const TICK_STEPS_MS = [
  60_000, // 1 min
  2 * 60_000, // 2 min
  5 * 60_000, // 5 min
  10 * 60_000, // 10 min
  15 * 60_000, // 15 min
  30 * 60_000, // 30 min
  3600_000, // 1 h
  2 * 3600_000, // 2 h
  3 * 3600_000, // 3 h
  6 * 3600_000, // 6 h
  12 * 3600_000, // 12 h
];

const TARGET_TICK_COUNT = 8;

/**
 * Compute evenly-spaced x-axis ticks for the currently visible time window.
 * The spacing is chosen from {@link TICK_STEPS_MS} so a zoomed-in view shows
 * several labelled ticks (recalculated for the span) instead of falling back to
 * the sparse whole-day 3-hour marks. Ticks are aligned to local midnight so
 * they land on round clock times; the unzoomed full day yields the usual
 * 3-hour ticks.
 * @param midnightMs - Local midnight of the displayed day, in epoch ms.
 * @param xMin - Left edge of the visible window, in epoch ms.
 * @param xMax - Right edge of the visible window, in epoch ms.
 */
function getTimeTicksMs(
  midnightMs: number,
  xMin: number,
  xMax: number,
): number[] {
  const idealStep = (xMax - xMin) / TARGET_TICK_COUNT;
  let step = TICK_STEPS_MS.at(-1) ?? 3600_000;
  for (const candidate of TICK_STEPS_MS) {
    if (candidate >= idealStep) {
      step = candidate;
      break;
    }
  }
  const ticks: number[] = [];
  const firstIndex = Math.ceil((xMin - midnightMs) / step);
  for (let t = midnightMs + firstIndex * step; t <= xMax; t += step) {
    ticks.push(t);
  }
  return ticks;
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
  const [zoomRange, setZoomRange] = useState<{
    startMs: number;
    endMs: number;
  } | null>(null);
  // Multiplier on the auto-fitted y-axis magnitude, driven by the mouse wheel
  // while hovering the chart. < 1 magnifies the traces (zoom in), > 1 shrinks
  // them (zoom out). Reset to 1 on a new day or via "Reset zoom".
  const [yZoom, setYZoom] = useState(1);
  const chartRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sel = new Date(selectedDate);
  sel.setHours(0, 0, 0, 0);
  const isToday = sel.getTime() === today.getTime();

  // Adjust state in response to derived changes during render (not in an effect)
  // so it never triggers a cascading re-render: reset zoom when the selected day
  // changes, and clear the forecast when leaving "today".
  const [prevSelectedDate, setPrevSelectedDate] = useState(selectedDate);
  if (selectedDate !== prevSelectedDate) {
    setPrevSelectedDate(selectedDate);
    setZoomRange(null);
    setYZoom(1);
  }
  const [wasToday, setWasToday] = useState(isToday);
  if (isToday !== wasToday) {
    setWasToday(isToday);
    if (!isToday) setForecast(null);
  }

  // Live "now" marker position; ticks each minute while viewing today so the
  // line tracks the clock without calling the impure Date.now() during render.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!isToday) return;
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [isToday]);

  // Wheel over the chart rescales the y-axis instead of scrolling the page.
  // Registered as a non-passive native listener so preventDefault() works
  // (React's onWheel is passive and cannot stop the page from scrolling).
  const showChart = !(data.length === 0 && !isToday);
  useEffect(() => {
    const node = chartRef.current;
    if (!node) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = Math.exp(event.deltaY * 0.001);
      setYZoom((prev) => Math.min(10, Math.max(0.1, prev * factor)));
    };
    node.addEventListener('wheel', handleWheel, { passive: false });
    return () => node.removeEventListener('wheel', handleWheel);
  }, [showChart]);

  useEffect(() => {
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
    if (!isToday) return;
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

  const resetZoom = useCallback(() => {
    setZoomRange(null);
    setYZoom(1);
  }, []);

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

  const scaledAxisMax = axisMax * yZoom;

  const yTickValues = useMemo(
    () => [
      -scaledAxisMax,
      -scaledAxisMax / 2,
      0,
      scaledAxisMax / 2,
      scaledAxisMax,
    ],
    [scaledAxisMax],
  );

  const allSeries = useMemo(
    () => [...balanceSeries, ...forecastSeries],
    [balanceSeries, forecastSeries],
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

  const visibleTicks = useMemo(
    () => getTimeTicksMs(midnightMs, xMin, xMax),
    [midnightMs, xMin, xMax],
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
        value: nowMs,
        lineStyle: {
          stroke: '#94a3b8',
          strokeWidth: 1,
          strokeDasharray: '4,3',
        },
      },
    ];
  }, [isToday, nowMs]);

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
          {(zoomRange || yZoom !== 1) && (
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

      {!showChart ? (
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
        <div ref={chartRef} style={{ height: 280 }}>
          <ResponsiveLine
            data={allSeries}
            theme={nivoTheme}
            colors={(d) => (d as unknown as { color: string }).color}
            margin={{ top: 10, right: 60, bottom: 50, left: 70 }}
            xScale={{ type: 'linear', min: xMin, max: xMax }}
            yScale={{ type: 'linear', min: -scaledAxisMax, max: scaledAxisMax }}
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
                data: seriesMeta.map((s) => ({
                  id: s.id,
                  label: s.label,
                  color: s.color,
                })),
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
