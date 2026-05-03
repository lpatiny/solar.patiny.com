import { ResponsiveLine } from '@nivo/line';

import type { HistoryPoint } from '../HomePage.tsx';

interface HistoryChartProps {
  data: HistoryPoint[];
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
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

export default function HistoryChart({ data }: HistoryChartProps) {
  if (data.length === 0) {
    return (
      <div className="card">
        <span className="card-title">Last 24 Hours</span>
        <div
          style={{
            color: 'var(--text-secondary)',
            padding: '40px 0',
            textAlign: 'center',
          }}
        >
          No historical data yet — data accumulates over time.
        </div>
      </div>
    );
  }

  const nivoData = [
    {
      id: 'Solar',
      color: '#fbbf24',
      data: data.map((p) => ({
        x: formatTime(p.timestamp),
        y: Math.round(p.production_w),
      })),
    },
    {
      id: 'Consumption',
      color: '#c084fc',
      data: data.map((p) => ({
        x: formatTime(p.timestamp),
        y: Math.round(p.consumption_w),
      })),
    },
    {
      id: 'Grid injection',
      color: '#34d399',
      data: data.map((p) => ({
        x: formatTime(p.timestamp),
        y: p.grid_w < 0 ? Math.round(-p.grid_w) : 0,
      })),
    },
  ];

  const socData = [
    {
      id: 'State of Charge (%)',
      color: '#60a5fa',
      data: data
        .filter((p) => p.battery_soc !== null)
        .map((p) => ({
          x: formatTime(p.timestamp),
          y: Math.round(p.battery_soc as number),
        })),
    },
  ];

  return (
    <div className="card">
      <span className="card-title">Last 24 Hours — Power</span>
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
          useMesh
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

      <span className="card-title" style={{ marginTop: 24 }}>
        Battery State of Charge
      </span>
      <div style={{ height: 160 }}>
        <ResponsiveLine
          data={socData}
          theme={nivoTheme}
          colors={({ color }) => color}
          margin={{ top: 10, right: 60, bottom: 40, left: 50 }}
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
          useMesh
        />
      </div>
    </div>
  );
}
