import { useEffect, useState } from 'react';

import type { SensorMeta, SensorReadingPoint } from './SensorMetricChart.tsx';
import SensorMetricChart, {
  SENSOR_METRICS,
  hasMetric,
} from './SensorMetricChart.tsx';
import { deriveResolution } from './historyChartUtils.ts';

interface HistoryResponse {
  sensors: SensorMeta[];
  readings: SensorReadingPoint[];
}

const messageStyle = {
  color: 'var(--text-secondary)',
  padding: '40px 0',
  textAlign: 'center' as const,
};

const metricLabelStyle = {
  color: 'var(--text-secondary)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.06em',
  marginBottom: 4,
  marginTop: 20,
  textTransform: 'uppercase' as const,
};

export default function TemperatureHistoryChart({
  from,
  to,
}: {
  from: number;
  to: number;
}) {
  const resolution = deriveResolution(from, to);
  const [data, setData] = useState<HistoryResponse>({
    sensors: [],
    readings: [],
  });
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const fetchKey = `${resolution}-${from}-${to}`;
  const loading = loadedKey !== fetchKey;

  useEffect(() => {
    let cancelled = false;
    fetch(
      `/api/temperatures/history?resolution=${resolution}&from=${from}&to=${to}`,
    )
      .then((r) => r.json() as Promise<HistoryResponse>)
      .then((response) => {
        if (!cancelled) {
          setData(response);
          setLoadedKey(fetchKey);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData({ sensors: [], readings: [] });
          setLoadedKey(fetchKey);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fetchKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hide entirely when no sensor has ever been recorded (e.g. no DIRIGERA hub).
  if (!loading && data.sensors.length === 0) return null;

  return (
    <div className="card">
      <span className="card-title">Temperature &amp; air quality history</span>

      {loading ? (
        <div style={messageStyle}>Loading…</div>
      ) : data.readings.length === 0 ? (
        <div style={messageStyle}>
          No sensor data for this range yet — readings are recorded every 5
          minutes.
        </div>
      ) : (
        SENSOR_METRICS.filter((m) => hasMetric(data.readings, m.metric)).map(
          (m) => (
            <div key={m.metric}>
              <div style={metricLabelStyle}>{m.label}</div>
              <SensorMetricChart
                sensors={data.sensors}
                readings={data.readings}
                resolution={resolution}
                metric={m.metric}
                axisSuffix={m.axisSuffix}
                decimals={m.decimals}
                height={200}
              />
            </div>
          ),
        )
      )}
    </div>
  );
}
