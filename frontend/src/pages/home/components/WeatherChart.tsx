/* eslint-disable @typescript-eslint/naming-convention -- API fields use snake_case */
import { ResponsiveLine } from '@nivo/line';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { BrushLayer } from './BrushLayer.tsx';

interface WeatherPoint {
  timestamp: number;
  station: string;
  global_radiation_w: number | null;
  global_radiation_w_max?: number | null;
  temperature_c: number | null;
  humidity_pct: number | null;
  precipitation_mm: number | null;
  sunshine_min: number | null;
}

type WeatherResolution = 'hourly' | 'daily';

function deriveResolution(from: number, to: number): WeatherResolution {
  return to - from > 86_400 ? 'daily' : 'hourly';
}

function formatTs(ts: number, resolution: WeatherResolution): string {
  const d = new Date(ts * 1000);
  if (resolution === 'daily') {
    const date = d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    return `${date}|${d.getFullYear()}`;
  }
  const date = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${date}|${time}`;
}

function formatAxisLabel(
  key: string,
  resolution: WeatherResolution,
  isMultiYear: boolean,
): string {
  if (!key.includes('|')) return key;
  const [datePart, suffix] = key.split('|') as [string, string];
  if (resolution === 'hourly') return suffix; // "09:00"
  if (isMultiYear) {
    const month = datePart.split(' ', 1)[0] ?? datePart;
    return `${month} ${suffix}`; // "Jul 2024"
  }
  return datePart; // "Jul 1"
}

const STATION_NAMES: Record<string, string> = {
  PRE: 'Pully',
  PUY: 'Pully',
};

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

const sharedLineProps = {
  theme: nivoTheme,
  margin: { top: 10, right: 60, bottom: 40, left: 70 },
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
  useMesh: false,
};

export default function WeatherChart({
  from,
  to,
}: {
  from: number;
  to: number;
}) {
  const resolution = deriveResolution(from, to);
  const [data, setData] = useState<WeatherPoint[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [zoomIndices, setZoomIndices] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const fetchKey = `${resolution}-${from}-${to}`;
  const loading = loadedKey !== fetchKey;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/weather?resolution=${resolution}&from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((rows: WeatherPoint[]) => {
        // Deduplicate by timestamp — prefer PUY (full climate data) over PRE
        const byTs = new Map<number, WeatherPoint>();
        for (const row of rows) {
          const prev = byTs.get(row.timestamp);
          if (!prev || row.station === 'PUY') byTs.set(row.timestamp, row);
        }
        const deduped = [...byTs.values()].toSorted(
          (a, b) => a.timestamp - b.timestamp,
        );
        if (!cancelled) {
          setData(deduped);
          setLoadedKey(fetchKey);
          setZoomIndices(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData([]);
          setLoadedKey(fetchKey);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fetchKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleData = useMemo(
    () =>
      zoomIndices ? data.slice(zoomIndices.start, zoomIndices.end + 1) : data,
    [data, zoomIndices],
  );

  const handleZoom = useCallback(
    (startFrac: number, endFrac: number) => {
      const len = visibleData.length;
      const startIdx = Math.round(startFrac * (len - 1));
      const endIdx = Math.round(endFrac * (len - 1));
      if (endIdx > startIdx) {
        const base = zoomIndices?.start ?? 0;
        setZoomIndices({ start: base + startIdx, end: base + endIdx });
      }
    },
    [zoomIndices, visibleData.length],
  );

  const resetZoom = useCallback(() => setZoomIndices(null), []);

  const isMultiYear = useMemo(() => {
    if (resolution !== 'daily') return false;
    const first = visibleData[0];
    const last = visibleData.at(-1);
    return (
      first !== undefined &&
      last !== undefined &&
      new Date(first.timestamp * 1000).getFullYear() !==
        new Date(last.timestamp * 1000).getFullYear()
    );
  }, [resolution, visibleData]);

  const tickValues = useMemo(() => {
    if (resolution === 'daily' && isMultiYear) {
      const monthsSeen = new Set<string>();
      const monthTicks: string[] = [];
      for (const p of visibleData) {
        const d = new Date(p.timestamp * 1000);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        if (!monthsSeen.has(key)) {
          monthsSeen.add(key);
          monthTicks.push(formatTs(p.timestamp, resolution));
        }
      }
      const step = Math.max(1, Math.round(monthTicks.length / 8));
      return monthTicks.filter((_, i) => i % step === 0);
    }
    const step = Math.max(1, Math.round(visibleData.length / 8));
    return visibleData
      .filter((_, i) => i % step === 0)
      .map((p) => formatTs(p.timestamp, resolution));
  }, [visibleData, resolution, isMultiYear]);

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

  const brushLayers = useMemo(
    () =>
      [
        'grid',
        'markers',
        'axes',
        'areas',
        'crosshair',
        'lines',
        'points',
        'slices',
        'mesh',
        'legends',
        makeBrushLayer,
      ] as const,
    [makeBrushLayer],
  );

  const stationCode = data[0]?.station ?? '';
  const station = STATION_NAMES[stationCode] ?? (stationCode || 'MeteoSwiss');

  const tempData = useMemo(
    () => [
      {
        id: 'Temperature (°C)',
        color: '#60a5fa',
        data: visibleData
          .filter((p) => p.temperature_c !== null)
          .map((p) => ({
            x: formatTs(p.timestamp, resolution),
            y: Math.round((p.temperature_c as number) * 10) / 10,
          })),
      },
    ],
    [visibleData, resolution],
  );

  const radAvgData = useMemo(
    () => [
      {
        id: 'Avg solar radiation (W/m²)',
        color: '#fbbf24',
        data: visibleData
          .filter((p) => p.global_radiation_w !== null)
          .map((p) => ({
            x: formatTs(p.timestamp, resolution),
            y: Math.round(p.global_radiation_w as number),
          })),
      },
    ],
    [visibleData, resolution],
  );

  const radMaxData = useMemo(
    () => [
      {
        id: 'Peak solar radiation (W/m²)',
        color: '#f97316',
        data: visibleData
          .filter((p) => p.global_radiation_w_max != null)
          .map((p) => ({
            x: formatTs(p.timestamp, resolution),
            y: Math.round(p.global_radiation_w_max as number),
          })),
      },
    ],
    [visibleData, resolution],
  );

  if (!loading && data.length === 0) {
    return (
      <div className="card">
        <span className="card-title">Weather — {station}</span>
        <div
          style={{
            color: 'var(--text-secondary)',
            padding: '40px 0',
            textAlign: 'center',
          }}
        >
          No weather data for this range — use &ldquo;Sync Meteo History&rdquo;
          in the Configuration tab to load historical data.
        </div>
      </div>
    );
  }

  const legends = [
    {
      anchor: 'top-right' as const,
      direction: 'column' as const,
      translateX: -5,
      translateY: 5,
      itemWidth: 160,
      itemHeight: 18,
      symbolSize: 10,
      symbolShape: 'circle' as const,
    },
  ];

  const axisBottom = {
    tickSize: 0,
    tickPadding: 8,
    tickRotation: -30,
    tickValues,
    format: (key: string) => formatAxisLabel(key, resolution, isMultiYear),
  };

  return (
    <div className="card">
      <span className="card-title">Weather — {station}</span>

      {loading ? (
        <div
          style={{
            color: 'var(--text-secondary)',
            padding: '40px 0',
            textAlign: 'center',
          }}
        >
          Loading…
        </div>
      ) : (
        <>
          <div style={{ height: 180 }}>
            <ResponsiveLine
              {...sharedLineProps}
              data={tempData}
              colors={({ color }) => color}
              axisBottom={axisBottom}
              axisLeft={{
                tickSize: 0,
                tickPadding: 8,
                format: (v: number) => `${v} °C`,
                tickValues: 5,
              }}
              legends={legends}
              layers={brushLayers}
            />
          </div>

          <div style={{ height: 180, marginTop: 24 }}>
            <ResponsiveLine
              {...sharedLineProps}
              data={radAvgData}
              colors={({ color }) => color}
              enableArea
              areaOpacity={0.15}
              axisBottom={axisBottom}
              axisLeft={{
                tickSize: 0,
                tickPadding: 8,
                format: (v: number) => `${Math.round(v)} W/m²`,
                tickValues: 5,
              }}
              legends={legends}
              layers={brushLayers}
            />
          </div>

          {(radMaxData[0]?.data.length ?? 0) > 0 && (
            <div style={{ height: 180, marginTop: 24 }}>
              <ResponsiveLine
                {...sharedLineProps}
                data={radMaxData}
                colors={({ color }) => color}
                enableArea
                areaOpacity={0.15}
                axisBottom={axisBottom}
                axisLeft={{
                  tickSize: 0,
                  tickPadding: 8,
                  format: (v: number) => `${Math.round(v)} W/m²`,
                  tickValues: 5,
                }}
                legends={legends}
                layers={brushLayers}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
