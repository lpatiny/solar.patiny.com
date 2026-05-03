/* eslint-disable camelcase, @typescript-eslint/naming-convention -- API response fields use snake_case */
import { ResponsiveBar } from '@nivo/bar';
import { useEffect, useState } from 'react';

type Resolution = 'day' | 'month' | 'year';

interface StatPoint {
  [key: string]: string | number;
  period: string;
  production_kwh: number;
  export_kwh: number;
  import_kwh: number;
  self_consumption_kwh: number;
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

const COLORS: Record<string, string> = {
  production_kwh: '#fbbf24',
  self_consumption_kwh: '#f97316',
  export_kwh: '#34d399',
  import_kwh: '#f87171',
};

const LABELS: Record<string, string> = {
  production_kwh: 'Production',
  self_consumption_kwh: 'Self-use',
  export_kwh: 'Export',
  import_kwh: 'Import',
};

const KEYS = [
  'production_kwh',
  'self_consumption_kwh',
  'export_kwh',
  'import_kwh',
];

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

function deriveResolution(from: number, to: number): Resolution {
  const days = (to - from) / 86_400;
  if (days > 730) return 'year';
  if (days > 90) return 'month';
  return 'day';
}

function tsToDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export default function EnergyChart({
  from,
  to,
}: {
  from: number;
  to: number;
}) {
  const autoResolution = deriveResolution(from, to);
  const [manualResolution, setManualResolution] = useState<Resolution | null>(
    null,
  );
  const [prevFrom, setPrevFrom] = useState(from);
  const [prevTo, setPrevTo] = useState(to);

  if (from !== prevFrom || to !== prevTo) {
    setPrevFrom(from);
    setPrevTo(to);
    setManualResolution(null);
  }

  const resolution = manualResolution ?? autoResolution;
  const [data, setData] = useState<StatPoint[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const fetchKey = `${resolution}-${from}-${to}`;
  const loading = loadedKey !== fetchKey;

  useEffect(() => {
    let cancelled = false;
    const url = `/api/stats?resolution=${resolution}&from=${tsToDate(from)}&to=${tsToDate(to)}`;
    fetch(url)
      .then((r) => r.json())
      .then((rows) => {
        if (!cancelled) {
          setData(rows as StatPoint[]);
          setLoadedKey(fetchKey);
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

  return (
    <div className="card">
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
          Energy History
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <ResolutionButton
            label="Day"
            active={resolution === 'day'}
            onClick={() => setManualResolution('day')}
          />
          <ResolutionButton
            label="Month"
            active={resolution === 'month'}
            onClick={() => setManualResolution('month')}
          />
          <ResolutionButton
            label="Year"
            active={resolution === 'year'}
            onClick={() => setManualResolution('year')}
          />
        </div>
      </div>

      {loading && (
        <div
          style={{
            color: 'var(--text-secondary)',
            padding: '40px 0',
            textAlign: 'center',
          }}
        >
          Loading…
        </div>
      )}

      {!loading && data.length === 0 && (
        <div
          style={{
            color: 'var(--text-secondary)',
            padding: '40px 0',
            textAlign: 'center',
          }}
        >
          No energy data yet — sync history from the Configuration tab.
        </div>
      )}

      {!loading && data.length > 0 && (
        <div style={{ height: 320 }}>
          <ResponsiveBar
            data={data}
            keys={KEYS}
            indexBy="period"
            theme={nivoTheme}
            colors={({ id }) => COLORS[id as string] ?? '#94a3b8'}
            margin={{ top: 10, right: 20, bottom: 70, left: 60 }}
            padding={0.25}
            groupMode="grouped"
            axisBottom={{
              tickSize: 0,
              tickPadding: 8,
              tickRotation: resolution === 'day' ? -45 : -30,
              tickValues: resolution === 'day' ? 10 : undefined,
            }}
            axisLeft={{
              tickSize: 0,
              tickPadding: 8,
              format: (v: number) => `${v} kWh`,
              tickValues: 5,
            }}
            enableLabel={false}
            enableGridX={false}
            tooltipLabel={({ id }) => LABELS[id as string] ?? String(id)}
            valueFormat={(v) => `${v.toFixed(2)} kWh`}
            legends={[
              {
                dataFrom: 'keys',
                anchor: 'bottom',
                direction: 'row',
                translateY: 65,
                itemWidth: 100,
                itemHeight: 14,
                symbolSize: 10,
                symbolShape: 'circle',
                data: KEYS.map((key) => ({
                  id: key,
                  label: LABELS[key] ?? key,
                  color: COLORS[key] ?? '#94a3b8',
                })),
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
