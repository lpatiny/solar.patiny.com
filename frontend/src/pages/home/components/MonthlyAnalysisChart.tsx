/* eslint-disable @typescript-eslint/naming-convention -- API response fields use snake_case */
import { ResponsiveBar } from '@nivo/bar';
import { useMemo } from 'react';

interface MonthlyAnalysis {
  year_month: string;
  actual_kwh: number | null;
  predicted_kwh: number | null;
  clear_sky_kwh: number | null;
  avg_performance_ratio: number | null;
  capacity_factor: number | null;
}

interface MonthlyAnalysisChartProps {
  monthly: MonthlyAnalysis[];
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

function formatMonth(ym: string): string {
  const [year, month] = ym.split('-');
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString([], { month: 'short', year: '2-digit' });
}

export default function MonthlyAnalysisChart({
  monthly,
}: MonthlyAnalysisChartProps) {
  const data = useMemo(
    () =>
      monthly.map((m) => ({
        month: formatMonth(m.year_month),
        Actual: m.actual_kwh ?? 0,
        Predicted: m.predicted_kwh ?? 0,
        'Clear-sky': m.clear_sky_kwh ?? 0,
      })),
    [monthly],
  );

  return (
    <div style={{ height: 320 }}>
      <ResponsiveBar
        data={data}
        keys={['Clear-sky', 'Predicted', 'Actual']}
        indexBy="month"
        theme={nivoTheme}
        margin={{ top: 20, right: 20, bottom: 60, left: 60 }}
        padding={0.25}
        groupMode="grouped"
        colors={['#3b82f640', '#f59e0b', '#4ade80']}
        axisBottom={{
          tickRotation: -30,
        }}
        axisLeft={{
          legend: 'Energy (kWh/month)',
          legendOffset: -50,
          legendPosition: 'middle',
        }}
        legends={[
          {
            dataFrom: 'keys',
            anchor: 'bottom',
            direction: 'row',
            translateY: 55,
            itemWidth: 100,
            itemHeight: 20,
            symbolSize: 10,
          },
        ]}
        tooltip={({ id, value, indexValue }) => (
          <div style={{ padding: '6px 10px', fontSize: 12 }}>
            <strong>{String(indexValue)}</strong> — {String(id)}:{' '}
            <strong>{value.toFixed(0)} kWh</strong>
          </div>
        )}
      />
    </div>
  );
}
