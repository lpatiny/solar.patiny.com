/* eslint-disable @typescript-eslint/naming-convention -- API response fields use snake_case */
import { ResponsiveLine } from '@nivo/line';
import { useCallback, useMemo, useState } from 'react';

import { BrushLayer } from './BrushLayer.tsx';

interface DailyAnalysis {
  date: string;
  actual_kwh: number | null;
  predicted_kwh: number | null;
  clear_sky_kwh: number | null;
}

interface ComparisonChartProps {
  daily: DailyAnalysis[];
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

function formatDateLabel(date: string): string {
  const d = new Date(date);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ComparisonChart({ daily }: ComparisonChartProps) {
  const [zoomIndices, setZoomIndices] = useState<{
    start: number;
    end: number;
  } | null>(null);

  // Reset zoom when the data changes — done during render (not in an effect) so
  // it doesn't trigger a cascading re-render.
  const [prevDaily, setPrevDaily] = useState(daily);
  if (daily !== prevDaily) {
    setPrevDaily(daily);
    setZoomIndices(null);
  }

  const visibleDaily = useMemo(
    () =>
      zoomIndices ? daily.slice(zoomIndices.start, zoomIndices.end + 1) : daily,
    [daily, zoomIndices],
  );

  const handleZoom = useCallback(
    (startFrac: number, endFrac: number) => {
      const len = visibleDaily.length;
      const startIdx = Math.round(startFrac * (len - 1));
      const endIdx = Math.round(endFrac * (len - 1));
      if (endIdx > startIdx) {
        const base = zoomIndices?.start ?? 0;
        setZoomIndices({ start: base + startIdx, end: base + endIdx });
      }
    },
    [zoomIndices, visibleDaily.length],
  );

  const resetZoom = useCallback(() => setZoomIndices(null), []);

  const series = useMemo(() => {
    // Keep all dates in every series so all three share the same x domain.
    // null y values produce line gaps, which is correct for missing data.
    return [
      {
        id: 'Actual (SolarWeb)',
        color: '#4ade80',
        data: visibleDaily.map((d) => ({ x: d.date, y: d.actual_kwh })),
      },
      {
        id: 'Predicted (MeteoSwiss)',
        color: '#f59e0b',
        data: visibleDaily.map((d) => ({ x: d.date, y: d.predicted_kwh })),
      },
      {
        id: 'Clear-sky max',
        color: '#60a5fa',
        data: visibleDaily.map((d) => ({ x: d.date, y: d.clear_sky_kwh })),
      },
    ];
  }, [visibleDaily]);

  const tickValues = useMemo(() => {
    const step = Math.max(1, Math.round(visibleDaily.length / 12));
    return visibleDaily.filter((_, i) => i % step === 0).map((d) => d.date);
  }, [visibleDaily]);

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

  return (
    <div style={{ height: 320 }}>
      <ResponsiveLine
        data={series}
        theme={nivoTheme}
        margin={{ top: 20, right: 20, bottom: 60, left: 55 }}
        xScale={{ type: 'point' }}
        yScale={{ type: 'linear', min: 0, max: 'auto', nice: true }}
        axisBottom={{
          tickValues,
          format: formatDateLabel,
          tickRotation: -30,
        }}
        axisLeft={{
          legend: 'Energy (kWh/day)',
          legendOffset: -45,
          legendPosition: 'middle',
        }}
        colors={(d) => (d as { color: string }).color}
        lineWidth={1.5}
        pointSize={0}
        enableArea={false}
        useMesh={false}
        enableCrosshair
        layers={brushLayers}
        legends={[
          {
            anchor: 'bottom',
            direction: 'row',
            translateY: 55,
            itemWidth: 160,
            itemHeight: 20,
            symbolSize: 10,
            symbolShape: 'circle',
          },
        ]}
        tooltip={({ point }) => (
          <div
            style={{
              background: '#263347',
              border: '1px solid #334155',
              borderRadius: 8,
              padding: '6px 10px',
              fontSize: 12,
            }}
          >
            <strong style={{ color: '#f1f5f9' }}>
              {point.data.xFormatted}
            </strong>
            <br />
            <span style={{ color: point.seriesColor }}>{point.seriesId}</span>
            {': '}
            <strong>{Number(point.data.y).toFixed(2)} kWh</strong>
          </div>
        )}
      />
    </div>
  );
}
