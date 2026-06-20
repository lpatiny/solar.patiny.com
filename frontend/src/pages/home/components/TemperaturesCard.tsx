/* eslint-disable @typescript-eslint/naming-convention -- API response types use snake_case */
import { useEffect, useState } from 'react';

import type { SensorMeta, SensorReadingPoint } from './SensorMetricChart.tsx';
import SensorMetricChart, {
  SENSOR_METRICS,
  hasMetric,
} from './SensorMetricChart.tsx';

interface TemperatureSensor {
  id: string;
  name: string;
  temperature_c: number;
  humidity_pct: number | null;
  co2_ppm: number | null;
  pm25_ugm3: number | null;
}

interface TemperaturesData {
  timestamp: number;
  is_stale: boolean;
  configured: boolean;
  sensors: TemperatureSensor[];
  unavailable_sensors: Array<{ id: string; name: string }>;
}

interface HistoryData {
  sensors: SensorMeta[];
  readings: SensorReadingPoint[];
}

const POLL_MS = 60_000;
const HISTORY_POLL_MS = 5 * 60_000;

// Temperature and humidity get their own little trend below the tiles.
const OVERVIEW_METRICS = SENSOR_METRICS.filter(
  (m) => m.metric === 'temperature_c' || m.metric === 'humidity_pct',
);

const metricLabelStyle = {
  color: 'var(--text-secondary)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.06em',
  marginBottom: 4,
  marginTop: 16,
  textTransform: 'uppercase' as const,
};

/** Compact secondary line for a tile: "47% · 457 ppm · PM2.5 1". */
function secondaryLine(sensor: TemperatureSensor): string {
  const parts: string[] = [];
  if (sensor.humidity_pct !== null) {
    parts.push(`${Math.round(sensor.humidity_pct)}%`);
  }
  if (sensor.co2_ppm !== null) parts.push(`${Math.round(sensor.co2_ppm)} ppm`);
  if (sensor.pm25_ugm3 !== null) {
    parts.push(`PM2.5 ${Math.round(sensor.pm25_ugm3)}`);
  }
  return parts.join(' · ');
}

export default function TemperaturesCard() {
  const [data, setData] = useState<TemperaturesData | null>(null);
  const [history, setHistory] = useState<HistoryData | null>(null);

  useEffect(() => {
    let cancelled = false;

    function load() {
      fetch('/api/temperatures')
        .then((r) => r.json() as Promise<TemperaturesData>)
        .then((d) => {
          if (!cancelled) setData(d);
        })
        .catch(() => undefined);
    }

    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    function load() {
      const to = Math.floor(Date.now() / 1000);
      const from = to - 86_400;
      fetch(`/api/temperatures/history?resolution=hourly&from=${from}&to=${to}`)
        .then((r) => r.json() as Promise<HistoryData>)
        .then((d) => {
          if (!cancelled) setHistory(d);
        })
        .catch(() => undefined);
    }

    load();
    const interval = setInterval(load, HISTORY_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Hide the card entirely when the hub is not configured or has neither a live
  // nor a previously-seen (now offline) sensor to show.
  if (!data?.configured) return null;
  const unavailableSensors = data.unavailable_sensors ?? [];
  if (data.sensors.length === 0 && unavailableSensors.length === 0) return null;

  return (
    <div className="card">
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          gap: 8,
          justifyContent: 'space-between',
        }}
      >
        <span className="card-title" style={{ marginBottom: 0 }}>
          Temperatures
        </span>
        {data.is_stale && <span className="stale-badge">stale</span>}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 10,
          marginTop: 16,
        }}
      >
        {data.sensors.map((sensor) => (
          <div
            key={sensor.id}
            style={{
              background: 'var(--surface-raised)',
              borderRadius: 8,
              padding: '10px 12px',
            }}
          >
            <div
              style={{
                color: 'var(--text-secondary)',
                fontSize: 12,
                marginBottom: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={sensor.name}
            >
              {sensor.name}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>
              {sensor.temperature_c.toFixed(1)}
              <span
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: 13,
                  fontWeight: 400,
                  marginLeft: 3,
                }}
              >
                °C
              </span>
            </div>
            {secondaryLine(sensor) && (
              <div
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: 11,
                  marginTop: 2,
                }}
              >
                {secondaryLine(sensor)}
              </div>
            )}
          </div>
        ))}
        {unavailableSensors.map((sensor) => (
          <div
            key={sensor.id}
            style={{
              background: 'var(--surface-raised)',
              borderRadius: 8,
              opacity: 0.5,
              padding: '10px 12px',
            }}
          >
            <div
              style={{
                color: 'var(--text-secondary)',
                fontSize: 12,
                marginBottom: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={sensor.name}
            >
              {sensor.name}
            </div>
            <div
              style={{
                color: 'var(--text-secondary)',
                fontSize: 13,
                fontWeight: 600,
                marginTop: 6,
              }}
            >
              not available
            </div>
          </div>
        ))}
      </div>

      {history &&
        OVERVIEW_METRICS.filter((m) =>
          hasMetric(history.readings, m.metric),
        ).map((m) => (
          <div key={m.metric}>
            <div style={metricLabelStyle}>Last 24h — {m.label}</div>
            <SensorMetricChart
              sensors={history.sensors}
              readings={history.readings}
              resolution="hourly"
              metric={m.metric}
              axisSuffix={m.axisSuffix}
              decimals={m.decimals}
              height={150}
            />
          </div>
        ))}
    </div>
  );
}
