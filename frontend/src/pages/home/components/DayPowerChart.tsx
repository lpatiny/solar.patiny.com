/* eslint-disable @typescript-eslint/naming-convention -- API response fields use snake_case */
import { Button, ButtonGroup } from '@blueprintjs/core';
import { ResponsiveLine } from '@nivo/line';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { BrushLayer } from './BrushLayer.tsx';

interface ReadingPoint {
  timestamp: number;
  production_w: number;
  grid_w: number;
  battery_w: number;
  consumption_w: number;
  battery_soc_max: number | null;
}

interface ForecastSlot {
  timestamp: number;
  endTimestamp: number;
  predictedProductionKwh: number;
  typicalConsumptionKwh: number;
  neighborExportKwh: number;
  batteryChargeKwh: number;
  isPast: boolean;
}

interface ForecastData {
  slots: ForecastSlot[];
}

interface NivoLineSerie {
  id: string;
  color: string;
  data: Array<{ position: { x: number; y: number } }>;
}

type NivoLayer = NonNullable<
  Parameters<typeof ResponsiveLine>[0]['layers']
>[number];

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

const POWER_SERIES_META = [
  { id: 'Solar', color: '#fbbf24' },
  { id: 'Consumption', color: '#c084fc' },
  { id: 'Grid injection', color: '#34d399' },
] as const;

function MixedLineLayer({
  series,
  lineGenerator,
}: {
  series: NivoLineSerie[];
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

function ForecastDotsLayer({ series }: { series: NivoLineSerie[] }) {
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

function buildForecastSeries(
  data: ReadingPoint[],
  forecast: ForecastData,
): Array<{ id: string; color: string; data: Array<{ x: number; y: number }> }> {
  const futureSlots = forecast.slots.filter((s) => !s.isPast);
  if (futureSlots.length === 0) return [];

  const last = data.at(-1);
  const solar: Array<{ x: number; y: number }> = last
    ? [{ x: last.timestamp * 1000, y: Math.round(last.production_w) }]
    : [];
  const consumption: Array<{ x: number; y: number }> = last
    ? [{ x: last.timestamp * 1000, y: Math.round(last.consumption_w) }]
    : [];
  const injection: Array<{ x: number; y: number }> = last
    ? [
        {
          x: last.timestamp * 1000,
          y: last.grid_w < 0 ? Math.round(-last.grid_w) : 0,
        },
      ]
    : [];

  for (const slot of futureSlots) {
    const midMs = ((slot.timestamp + slot.endTimestamp) / 2) * 1000;
    solar.push({
      x: midMs,
      y: Math.round((slot.predictedProductionKwh / 3) * 1000),
    });
    consumption.push({
      x: midMs,
      y: Math.round((slot.typicalConsumptionKwh / 3) * 1000),
    });
    injection.push({
      x: midMs,
      y: Math.round((slot.neighborExportKwh / 3) * 1000),
    });
  }

  return [
    { id: 'Solar_forecast', color: '#fbbf24', data: solar },
    { id: 'Consumption_forecast', color: '#c084fc', data: consumption },
    { id: 'Grid injection_forecast', color: '#34d399', data: injection },
  ];
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
    const { from, to } = dayBounds(selectedDate);
    fetch(`/api/history?resolution=raw&from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((rows) => setData(rows as ReadingPoint[]))
      .catch(() => setData([]));
  }, [selectedDate]);

  useEffect(() => {
    if (!isToday) {
      setForecast(null);
      return;
    }
    fetch('/api/forecast')
      .then((r) => r.json())
      .then((d) => setForecast(d as ForecastData))
      .catch(() => setForecast(null));

    const interval = setInterval(() => {
      fetch('/api/forecast')
        .then((r) => r.json())
        .then((d) => setForecast(d as ForecastData))
        .catch(() => undefined);
    }, 10 * 60_000);
    return () => clearInterval(interval);
  }, [isToday]);

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

  const visibleData = useMemo(
    () =>
      zoomRange
        ? data.filter((p) => {
            const ms = p.timestamp * 1000;
            return ms >= zoomRange.startMs && ms <= zoomRange.endMs;
          })
        : data,
    [data, zoomRange],
  );

  const forecastSeries = useMemo(() => {
    if (!isToday || !forecast) return [];
    const series = buildForecastSeries(data, forecast);
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

  const xMin = zoomRange ? zoomRange.startMs : midnightMs;
  const xMax = zoomRange ? zoomRange.endMs : nextMidnightMs;

  const ticks = getThreeHourTicksMs(midnightMs);
  const visibleTicks = useMemo(
    () => ticks.filter((t) => t >= xMin && t <= xMax),
    [ticks, xMin, xMax],
  );

  const actualSeries = useMemo(
    () => [
      {
        id: 'Solar',
        color: '#fbbf24',
        data: visibleData.map((p) => ({
          x: p.timestamp * 1000,
          y: Math.round(p.production_w),
        })),
      },
      {
        id: 'Consumption',
        color: '#c084fc',
        data: visibleData.map((p) => ({
          x: p.timestamp * 1000,
          y: Math.round(p.consumption_w),
        })),
      },
      {
        id: 'Grid injection',
        color: '#34d399',
        data: visibleData.map((p) => ({
          x: p.timestamp * 1000,
          y: p.grid_w < 0 ? Math.round(-p.grid_w) : 0,
        })),
      },
    ],
    [visibleData],
  );

  const allSeries = useMemo(
    () => [
      ...actualSeries.filter((s) => !hiddenIds.has(s.id)),
      ...forecastSeries.filter(
        (s) => !hiddenIds.has(s.id.replace('_forecast', '')),
      ),
    ],
    [actualSeries, forecastSeries, hiddenIds],
  );

  const nowMarker = isToday
    ? [
        {
          axis: 'x' as const,
          value: Date.now(),
          lineStyle: {
            stroke: '#94a3b8',
            strokeWidth: 1,
            strokeDasharray: '4,3',
          },
        },
      ]
    : [];

  const makeBrushLayer = useCallback(
    (props: { innerWidth: number; innerHeight: number }) => (
      <BrushLayer
        innerWidth={props.innerWidth}
        innerHeight={props.innerHeight}
        onZoom={handleZoom}
        onReset={resetZoom}
      />
    ),
    [handleZoom, resetZoom],
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
        <div style={{ height: 240 }}>
          <ResponsiveLine
            data={allSeries}
            theme={nivoTheme}
            colors={(d) => (d as unknown as { color: string }).color}
            margin={{ top: 10, right: 60, bottom: 50, left: 70 }}
            xScale={{ type: 'linear', min: xMin, max: xMax }}
            yScale={{ type: 'linear', min: 0, max: 'auto' }}
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
              tickValues: 5,
            }}
            enablePoints={false}
            enableGridX={false}
            curve="monotoneX"
            lineWidth={2}
            useMesh={false}
            markers={nowMarker}
            layers={[
              'grid',
              'markers',
              'axes',
              MixedLineLayer as unknown as NivoLayer,
              ForecastDotsLayer as unknown as NivoLayer,
              'crosshair',
              'mesh',
              'legends',
              makeBrushLayer,
            ]}
            legends={[
              {
                anchor: 'bottom-right',
                direction: 'row',
                translateY: 48,
                itemWidth: 100,
                itemHeight: 14,
                symbolSize: 10,
                symbolShape: 'circle',
                onClick: (datum) => toggleId(datum.id as string),
                data: POWER_SERIES_META.map((s) => ({
                  id: s.id,
                  label: s.id,
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
