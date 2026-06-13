/* eslint-disable @typescript-eslint/naming-convention -- API fields use snake_case */
import { ResponsiveLine } from '@nivo/line';
import { useEffect, useState } from 'react';

interface WeeklyEnvelopePoint {
  week: number;
  max_kwh: number;
  best_date: string;
  clear_sky_kwh: number;
}

// Approximate week numbers where each month begins (365-day year)
const MONTH_WEEK_STARTS = [1, 5, 9, 13, 18, 22, 26, 31, 35, 40, 44, 48];
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

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

export default function WeeklyEnvelopeChart() {
  const [points, setPoints] = useState<WeeklyEnvelopePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/analysis/weekly-envelope')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<WeeklyEnvelopePoint[]>;
      })
      .then((data) => {
        setPoints(data);
        setLoading(false);
      })
      .catch((error_: unknown) => {
        setError(error_ instanceof Error ? error_.message : 'Load error');
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div style={{ color: '#64748b', padding: '40px 0', textAlign: 'center' }}>
        Computing weekly envelope…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ color: '#f87171', padding: '20px 0' }}>Error: {error}</div>
    );
  }
  if (points.length === 0) {
    return (
      <div style={{ color: '#64748b', padding: '40px 0', textAlign: 'center' }}>
        No production data available yet.
      </div>
    );
  }

  const lineData = [
    {
      id: 'Best day per week',
      color: '#4ade80',
      data: points.map((p) => ({ x: p.week, y: p.max_kwh })),
    },
    {
      id: 'Clear-sky model',
      color: '#60a5fa',
      data: points.map((p) => ({ x: p.week, y: p.clear_sky_kwh })),
    },
  ];

  return (
    <div style={{ height: 320 }}>
      <ResponsiveLine
        data={lineData}
        theme={nivoTheme}
        margin={{ top: 16, right: 120, bottom: 48, left: 52 }}
        xScale={{ type: 'linear', min: 1, max: 52 }}
        yScale={{ type: 'linear', min: 0, stacked: false }}
        axisBottom={{
          tickValues: MONTH_WEEK_STARTS,
          format: (week) => {
            const idx = MONTH_WEEK_STARTS.indexOf(week as number);
            return idx !== -1 ? (MONTH_NAMES[idx] ?? '') : '';
          },
          legend: 'Week of year',
          legendOffset: 36,
          legendPosition: 'middle',
        }}
        axisLeft={{
          legend: 'kWh / day',
          legendOffset: -40,
          legendPosition: 'middle',
        }}
        colors={['#4ade80', '#60a5fa']}
        lineWidth={2}
        pointSize={4}
        pointColor={{ from: 'color' }}
        pointBorderWidth={0}
        enableArea={false}
        enableCrosshair
        useMesh
        legends={[
          {
            anchor: 'bottom-right',
            direction: 'column',
            justify: false,
            translateX: 110,
            translateY: 0,
            itemsSpacing: 4,
            itemDirection: 'left-to-right',
            itemWidth: 100,
            itemHeight: 20,
            symbolSize: 10,
            symbolShape: 'circle',
          },
        ]}
        tooltip={({ point }) => {
          const weekIdx = point.data.x - 1;
          const entry = points[weekIdx];
          const isClearSky = point.seriesId === 'Clear-sky model';
          return (
            <div
              style={{
                background: '#263347',
                border: '1px solid #334155',
                borderRadius: 8,
                color: '#f1f5f9',
                fontSize: 12,
                padding: '8px 12px',
              }}
            >
              <strong>Week {point.data.x}</strong>
              {isClearSky ? (
                <>
                  <br />
                  Clear-sky:{' '}
                  <strong style={{ color: '#60a5fa' }}>
                    {point.data.y.toFixed(2)} kWh
                  </strong>
                </>
              ) : (
                <>
                  <br />
                  Best day: {entry?.best_date ?? '—'}
                  <br />
                  Production:{' '}
                  <strong style={{ color: '#4ade80' }}>
                    {point.data.y.toFixed(2)} kWh
                  </strong>
                </>
              )}
            </div>
          );
        }}
      />
    </div>
  );
}
