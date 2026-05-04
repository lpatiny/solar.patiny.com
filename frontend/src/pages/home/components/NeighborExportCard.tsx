import { ResponsiveBar } from '@nivo/bar';
import { useEffect, useState } from 'react';

interface ForecastSlot {
  timestamp: number;
  neighborExportKwh: number;
  isPast: boolean;
}

interface ForecastData {
  slots: ForecastSlot[];
}

interface SlotBar {
  [key: string]: string | number;
  slot: string;
  kwh: number;
}

interface NeighborExportCardProps {
  gridInjectionW: number;
  todayExportKwh?: number;
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

function fmtTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatW(w: number): string {
  if (w >= 1000) return `${(w / 1000).toFixed(2)} kW`;
  return `${Math.round(w)} W`;
}

export default function NeighborExportCard({
  gridInjectionW,
  todayExportKwh,
}: NeighborExportCardProps) {
  const isExporting = gridInjectionW > 10;
  const [forecast, setForecast] = useState<ForecastData | null>(null);

  useEffect(() => {
    function loadForecast() {
      fetch('/api/forecast')
        .then((r) => r.json() as Promise<ForecastData>)
        .then(setForecast)
        .catch(() => undefined);
    }
    loadForecast();
    const interval = setInterval(loadForecast, 10 * 60_000);
    return () => clearInterval(interval);
  }, []);

  const barData: SlotBar[] =
    forecast?.slots.map((s) => ({
      slot: fmtTime(s.timestamp),
      kwh: Number(s.neighborExportKwh.toFixed(2)),
    })) ?? [];

  const barColors =
    forecast?.slots.map((s) => (s.isPast ? '#166534' : '#34d399')) ?? [];

  return (
    <div
      className="card"
      style={{
        borderColor: isExporting ? '#065f46' : 'var(--border)',
        background: isExporting ? '#022c22' : 'var(--surface)',
      }}
    >
      <span className="card-title">Available for Neighbours</span>

      <div
        className="value-large"
        style={{
          color: isExporting ? 'var(--grid-export)' : 'var(--text-secondary)',
          fontSize: 36,
          marginBottom: 4,
        }}
      >
        {isExporting ? formatW(gridInjectionW) : '0 W'}
      </div>

      <p
        style={{
          color: isExporting ? '#6ee7b7' : 'var(--text-secondary)',
          fontSize: 13,
          marginTop: 4,
          marginBottom: 16,
        }}
      >
        {isExporting
          ? 'Currently injecting into the grid'
          : 'No surplus power right now'}
      </p>

      {todayExportKwh !== undefined && (
        <div
          style={{
            background: 'var(--surface-raised)',
            borderRadius: 8,
            padding: '10px 12px',
          }}
        >
          <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
            Exported today
          </span>
          <div
            style={{
              fontWeight: 700,
              fontSize: 20,
              color: 'var(--grid-export)',
            }}
          >
            {todayExportKwh.toFixed(2)}{' '}
            <span
              style={{
                fontWeight: 400,
                fontSize: 13,
                color: 'var(--text-secondary)',
              }}
            >
              kWh
            </span>
          </div>
        </div>
      )}

      {barData.length > 0 && (
        <>
          <div
            style={{
              color: 'var(--text-secondary)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.06em',
              marginBottom: 4,
              marginTop: 20,
              paddingBottom: 4,
              borderBottom: '1px solid var(--border)',
              textTransform: 'uppercase',
            }}
          >
            Expected surplus today
          </div>
          <div style={{ height: 130 }}>
            <ResponsiveBar
              data={barData}
              keys={['kwh']}
              indexBy="slot"
              theme={nivoTheme}
              colors={(d) => barColors[d.index] ?? '#34d399'}
              margin={{ top: 4, right: 8, bottom: 40, left: 46 }}
              padding={0.35}
              axisBottom={{
                tickSize: 0,
                tickPadding: 6,
                tickRotation: -30,
              }}
              axisLeft={{
                tickSize: 0,
                tickPadding: 6,
                format: (v: number) => `${v}kWh`,
                tickValues: 4,
              }}
              enableLabel={false}
              enableGridX={false}
              tooltip={({ indexValue, value }) => (
                <div
                  style={{
                    background: '#263347',
                    border: '1px solid #334155',
                    borderRadius: 8,
                    color: '#f1f5f9',
                    fontSize: 12,
                    padding: '6px 10px',
                  }}
                >
                  <div style={{ marginBottom: 2 }}>{indexValue}</div>
                  <div style={{ color: '#34d399', fontWeight: 700 }}>
                    {(value ?? 0).toFixed(2)} kWh
                  </div>
                </div>
              )}
            />
          </div>
        </>
      )}
    </div>
  );
}
