/* eslint-disable @typescript-eslint/naming-convention -- API response fields use snake_case */
import { Button, ButtonGroup } from '@blueprintjs/core';
import { ResponsiveLine } from '@nivo/line';
import { useEffect, useState } from 'react';

interface ReadingPoint {
  timestamp: number;
  production_w: number;
  grid_w: number;
  battery_w: number;
  consumption_w: number;
  battery_soc_max: number | null;
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

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
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

export default function DayPowerChart() {
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [data, setData] = useState<ReadingPoint[]>([]);

  useEffect(() => {
    const { from, to } = dayBounds(selectedDate);
    fetch(`/api/history?resolution=raw&from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((rows) => setData(rows as ReadingPoint[]))
      .catch(() => setData([]));
  }, [selectedDate]);

  function goBack() {
    setSelectedDate((d) => {
      const prev = new Date(d);
      prev.setDate(prev.getDate() - 1);
      return prev;
    });
  }

  function goForward() {
    setSelectedDate((d) => {
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      return next;
    });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sel = new Date(selectedDate);
  sel.setHours(0, 0, 0, 0);
  const isToday = sel.getTime() === today.getTime();

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
        <ButtonGroup variant="minimal">
          <Button icon="chevron-left" size="small" onClick={goBack} />
          <Button
            size="small"
            disabled={isToday}
            onClick={goForward}
            icon="chevron-right"
          />
        </ButtonGroup>
      </div>

      {data.length === 0 ? (
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
      )}
    </div>
  );
}
