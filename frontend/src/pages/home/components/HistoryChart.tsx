/* eslint-disable @typescript-eslint/naming-convention -- API response fields use snake_case */
import { ResponsiveLine } from '@nivo/line';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { BrushLayer } from './BrushLayer.tsx';

type HistoryResolution = 'hourly' | 'daily' | 'monthly';

interface HistoryPoint {
  timestamp: number;
  production_w: number;
  grid_w: number;
  battery_w: number;
  consumption_w: number;
  battery_soc_max: number | null;
  battery_soc_min: number | null;
}

interface HistoryChartProps {
  from: number;
  to: number;
}

function deriveResolution(from: number, to: number): HistoryResolution {
  const days = (to - from) / 86_400;
  if (days > 90) return 'monthly';
  if (days > 1) return 'daily';
  return 'hourly';
}

function formatTime(ts: number, resolution: HistoryResolution): string {
  const d = new Date(ts * 1000);
  if (resolution === 'monthly') {
    return d.toLocaleDateString([], { month: 'short', year: 'numeric' });
  }
  if (resolution === 'daily') {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateRange(from: number, to: number): string {
  const f = new Date(from * 1000);
  const t = new Date(to * 1000);
  const sameDay = f.toDateString() === t.toDateString();
  if (sameDay) {
    return f.toLocaleDateString([], { dateStyle: 'medium' });
  }
  const fromOptions: Intl.DateTimeFormatOptions =
    f.getFullYear() !== t.getFullYear()
      ? { month: 'short', day: 'numeric', year: 'numeric' }
      : { month: 'short', day: 'numeric' };
  return `${f.toLocaleDateString([], fromOptions)} – ${t.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function ResolutionButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? '#3b82f6' : 'transparent',
        border: '1px solid',
        borderColor: active ? '#3b82f6' : '#334155',
        borderRadius: 6,
        color: active ? '#fff' : '#94a3b8',
        cursor: 'pointer',
        fontSize: 12,
        padding: '3px 10px',
      }}
    >
      {label}
    </button>
  );
}

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

export default function HistoryChart({ from, to }: HistoryChartProps) {
  const autoResolution = deriveResolution(from, to);
  const [manualResolution, setManualResolution] =
    useState<HistoryResolution | null>(null);
  const [prevFrom, setPrevFrom] = useState(from);
  const [prevTo, setPrevTo] = useState(to);
  const [zoomIndices, setZoomIndices] = useState<{
    start: number;
    end: number;
  } | null>(null);

  if (from !== prevFrom || to !== prevTo) {
    setPrevFrom(from);
    setPrevTo(to);
    setManualResolution(null);
    setZoomIndices(null);
  }

  const resolution = manualResolution ?? autoResolution;
  const [data, setData] = useState<HistoryPoint[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const fetchKey = `${resolution}-${from}-${to}`;
  const loading = loadedKey !== fetchKey;

  const visibleData = useMemo(
    () =>
      zoomIndices ? data.slice(zoomIndices.start, zoomIndices.end + 1) : data,
    [data, zoomIndices],
  );

  const handleZoom = useCallback(
    (startIdx: number, endIdx: number) => {
      const base = zoomIndices?.start ?? 0;
      setZoomIndices({ start: base + startIdx, end: base + endIdx });
    },
    [zoomIndices],
  );

  const resetZoom = useCallback(() => setZoomIndices(null), []);

  const makeBrushLayer = useCallback(
    (props: { innerWidth: number; innerHeight: number }) => (
      <BrushLayer
        innerWidth={props.innerWidth}
        innerHeight={props.innerHeight}
        dataLength={visibleData.length}
        onZoom={handleZoom}
        onReset={resetZoom}
      />
    ),
    [visibleData.length, handleZoom, resetZoom],
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/history?resolution=${resolution}&from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((rows) => {
        if (!cancelled) {
          setData(rows as HistoryPoint[]);
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

  const rangeLabel =
    zoomIndices && visibleData.length > 1
      ? formatDateRange(
          visibleData[0]?.timestamp ?? from,
          visibleData.at(-1)?.timestamp ?? to,
        )
      : formatDateRange(from, to);

  const resolutionButtons = (
    <div style={{ display: 'flex', gap: 6 }}>
      <ResolutionButton
        label="Hour"
        active={resolution === 'hourly'}
        onClick={() => setManualResolution('hourly')}
      />
      <ResolutionButton
        label="Day"
        active={resolution === 'daily'}
        onClick={() => setManualResolution('daily')}
      />
      <ResolutionButton
        label="Month"
        active={resolution === 'monthly'}
        onClick={() => setManualResolution('monthly')}
      />
    </div>
  );

  if (!loading && data.length === 0) {
    return (
      <div className="card">
        <div
          style={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <span className="card-title" style={{ margin: 0 }}>
            {rangeLabel} — Power
          </span>
          {resolutionButtons}
        </div>
        <div
          style={{
            color: 'var(--text-secondary)',
            padding: '40px 0',
            textAlign: 'center',
          }}
        >
          No historical data for the selected range.
        </div>
      </div>
    );
  }

  const nivoData = [
    {
      id: 'Solar',
      color: '#fbbf24',
      data: visibleData.map((p) => ({
        x: formatTime(p.timestamp, resolution),
        y: Math.round(p.production_w),
      })),
    },
    {
      id: 'Consumption',
      color: '#c084fc',
      data: visibleData.map((p) => ({
        x: formatTime(p.timestamp, resolution),
        y: Math.round(p.consumption_w),
      })),
    },
    {
      id: 'Grid injection',
      color: '#34d399',
      data: visibleData.map((p) => ({
        x: formatTime(p.timestamp, resolution),
        y: p.grid_w < 0 ? Math.round(-p.grid_w) : 0,
      })),
    },
  ];

  const socData = [
    {
      id: 'Max SOC (%)',
      color: '#60a5fa',
      data: visibleData
        .filter((p) => p.battery_soc_max !== null)
        .map((p) => ({
          x: formatTime(p.timestamp, resolution),
          y: Math.round(p.battery_soc_max as number),
        })),
    },
    {
      id: 'Min SOC (%)',
      color: '#818cf8',
      data: visibleData
        .filter((p) => p.battery_soc_min !== null)
        .map((p) => ({
          x: formatTime(p.timestamp, resolution),
          y: Math.round(p.battery_soc_min as number),
        })),
    },
  ];

  const brushLayers = [
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
  ] as const;

  return (
    <div className="card">
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <span className="card-title" style={{ margin: 0 }}>
          {rangeLabel} — Power
        </span>
        {resolutionButtons}
      </div>

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
        <div style={{ height: 260 }}>
          <ResponsiveLine
            data={nivoData}
            theme={nivoTheme}
            colors={({ color }) => color}
            margin={{ top: 10, right: 60, bottom: 50, left: 70 }}
            xScale={{ type: 'point' }}
            yScale={{ type: 'linear', min: 'auto', max: 'auto' }}
            axisBottom={{
              tickSize: 0,
              tickPadding: 8,
              tickRotation: -30,
              tickValues: 8,
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
            layers={brushLayers}
            legends={[
              {
                anchor: 'bottom-right',
                direction: 'row',
                translateY: 48,
                itemWidth: 100,
                itemHeight: 14,
                symbolSize: 10,
                symbolShape: 'circle',
              },
            ]}
          />
        </div>
      )}

      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 8,
          marginTop: 24,
        }}
      >
        <span className="card-title" style={{ margin: 0 }}>
          Battery State of Charge
        </span>
        {resolutionButtons}
      </div>

      {loading ? (
        <div
          style={{
            color: 'var(--text-secondary)',
            padding: '20px 0',
            textAlign: 'center',
          }}
        >
          Loading…
        </div>
      ) : (
        <div style={{ height: 180 }}>
          <ResponsiveLine
            data={socData}
            theme={nivoTheme}
            colors={({ color }) => color}
            margin={{ top: 10, right: 60, bottom: 60, left: 70 }}
            xScale={{ type: 'point' }}
            yScale={{ type: 'linear', min: 0, max: 100 }}
            axisBottom={{
              tickSize: 0,
              tickPadding: 8,
              tickRotation: -30,
              tickValues: 8,
            }}
            axisLeft={{
              tickSize: 0,
              tickPadding: 8,
              format: (v: number) => `${v}%`,
              tickValues: 5,
            }}
            enablePoints={false}
            enableGridX={false}
            curve="monotoneX"
            lineWidth={2}
            useMesh={false}
            layers={brushLayers}
            legends={[
              {
                anchor: 'bottom-right',
                direction: 'row',
                translateY: 55,
                itemWidth: 90,
                itemHeight: 14,
                symbolSize: 10,
                symbolShape: 'circle',
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
