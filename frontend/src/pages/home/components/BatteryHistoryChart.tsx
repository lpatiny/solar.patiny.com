import { ResponsiveLine } from '@nivo/line';
import { useEffect, useState } from 'react';

import type { BatteryHistoryPoint } from '../../../types.ts';

import type { HistoryResolution } from './historyChartUtils.ts';
import { formatTime, nivoTheme } from './historyChartUtils.ts';

interface BatteryHistoryChartProps {
  deviceId: number;
  from: number;
  to: number;
}

function Toggle({
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

/**
 * SOC and charge/discharge power history for one battery device.
 * @param root0 - Component props.
 * @param root0.deviceId - Device id to load history for.
 * @param root0.from - Range start (unix seconds).
 * @param root0.to - Range end (unix seconds).
 * @returns The history chart card.
 */
export default function BatteryHistoryChart({
  deviceId,
  from,
  to,
}: BatteryHistoryChartProps) {
  const [resolution, setResolution] = useState<HistoryResolution>('hourly');
  const [data, setData] = useState<BatteryHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);

  // Show the loader as soon as the query inputs change — during render, not in
  // the fetch effect, to avoid a cascading re-render.
  const fetchKey = `${deviceId}|${resolution}|${from}|${to}`;
  const [loadingKey, setLoadingKey] = useState(fetchKey);
  if (fetchKey !== loadingKey) {
    setLoadingKey(fetchKey);
    setLoading(true);
  }

  useEffect(() => {
    let cancelled = false;
    const res = resolution === 'monthly' ? 'daily' : resolution;
    fetch(
      `/api/devices/${deviceId}/history?resolution=${res}&from=${from}&to=${to}`,
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((rows: unknown) => {
        if (!cancelled) {
          setData(Array.isArray(rows) ? (rows as BatteryHistoryPoint[]) : []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId, from, to, resolution]);

  const step = Math.max(1, Math.round(data.length / 8));
  const tickValues = data
    .filter((_, index) => index % step === 0)
    .map((point) => formatTime(point.timestamp, resolution));

  const socSeries = [
    {
      id: 'SOC',
      color: '#60a5fa',
      data: data.map((point) => ({
        x: formatTime(point.timestamp, resolution),
        y: point.soc_pct,
      })),
    },
  ];

  const powerSeries = [
    {
      id: 'Battery power',
      color: '#34d399',
      data: data.map((point) => ({
        x: formatTime(point.timestamp, resolution),
        y: point.power_w === null ? null : Math.round(point.power_w),
      })),
    },
    {
      id: 'AC power',
      color: '#c084fc',
      data: data.map((point) => ({
        x: formatTime(point.timestamp, resolution),
        y: point.ac_power_w === null ? null : Math.round(point.ac_power_w),
      })),
    },
  ];

  const controls = (
    <div style={{ display: 'flex', gap: 6 }}>
      <Toggle
        label="Hour"
        active={resolution === 'hourly'}
        onClick={() => setResolution('hourly')}
      />
      <Toggle
        label="Day"
        active={resolution === 'daily'}
        onClick={() => setResolution('daily')}
      />
    </div>
  );

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
          Battery State of Charge
        </span>
        {controls}
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
      ) : data.length === 0 ? (
        <div
          style={{
            color: 'var(--text-secondary)',
            padding: '40px 0',
            textAlign: 'center',
          }}
        >
          No history yet — readings are stored as the device is polled.
        </div>
      ) : (
        <>
          <div style={{ height: 180 }}>
            <ResponsiveLine
              data={socSeries}
              theme={nivoTheme}
              colors={({ color }) => color}
              margin={{ top: 10, right: 20, bottom: 50, left: 50 }}
              xScale={{ type: 'point' }}
              yScale={{ type: 'linear', min: 0, max: 100 }}
              axisBottom={{
                tickSize: 0,
                tickPadding: 8,
                tickRotation: -30,
                tickValues,
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

          <div className="card-title" style={{ marginTop: 16 }}>
            Charge / Discharge power
          </div>
          <div style={{ height: 200 }}>
            <ResponsiveLine
              data={powerSeries}
              theme={nivoTheme}
              colors={({ color }) => color}
              margin={{ top: 10, right: 20, bottom: 50, left: 60 }}
              xScale={{ type: 'point' }}
              yScale={{ type: 'linear', min: 'auto', max: 'auto' }}
              axisBottom={{
                tickSize: 0,
                tickPadding: 8,
                tickRotation: -30,
                tickValues,
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
                  anchor: 'top-right',
                  direction: 'column',
                  translateX: 0,
                  translateY: 0,
                  itemWidth: 110,
                  itemHeight: 18,
                  symbolSize: 10,
                  symbolShape: 'circle',
                },
              ]}
            />
          </div>
        </>
      )}
    </div>
  );
}
