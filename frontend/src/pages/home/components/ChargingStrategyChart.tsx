import { ResponsiveLine } from '@nivo/line';
import { useEffect, useState } from 'react';

interface MeteoReading {
  timestamp: number;
  temperatureC: number | null;
  globalRadiationWm2: number | null;
}

interface ForecastSlot {
  timestamp: number;
  endTimestamp: number;
  temperatureC: number;
  precipitationMm: number;
  weatherDescription: string;
  cloudFactor: number;
  predictedProductionKwh: number;
  batteryChargeKwh: number;
  neighborExportKwh: number;
  batterySocStartPct: number;
  batterySocEndPct: number;
  isPast: boolean;
  clearSkyIrradianceWm2: number;
  predictedIrradianceWm2: number;
}

interface ForecastData {
  slots: ForecastSlot[];
  sunriseTs: number;
  sunsetTs: number;
  solarNoonTs: number;
  totalDayPredictedKwh: number;
  remainingPredictedKwh: number;
  currentSocPct: number;
  batteryCapacityKwh: number;
  pvPeakKw: number;
  pvScalingFactor: number;
  neighborExportTargetW: number;
  meteoReadings: MeteoReading[];
}

interface HistoryProfile {
  timestamp: number;
  productionW: number;
  batteryChargeW: number;
  neighborExportW: number;
  batterySocPct: number;
}

interface HistoryForecast {
  date: string;
  pvScalingFactor: number;
  sunriseTs: number;
  sunsetTs: number;
  solarNoonTs: number;
  profile: HistoryProfile[];
  meteoReadings: MeteoReading[];
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

function fmt(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function kwhToW(kwh: number, durationH: number): number {
  return durationH > 0 ? (kwh / durationH) * 1000 : 0;
}

// Nivo custom layer: renders series ending with "_forecast" as dashed lines
interface NivoLineSerie {
  id: string;
  color: string;
  data: Array<{ position: { x: number; y: number } }>;
}

interface MixedLineLayerProps {
  series: NivoLineSerie[];
  lineGenerator: (points: Array<{ x: number; y: number }>) => string | null;
}

function MixedLineLayer({ series, lineGenerator }: MixedLineLayerProps) {
  return series.map((serie) => {
    const isForecast = serie.id.endsWith('_forecast');
    const isClearSky = serie.id.startsWith('clearsky');
    const path = lineGenerator(
      serie.data.map((d) => ({ x: d.position.x, y: d.position.y })),
    );
    return (
      <path
        key={serie.id}
        d={path ?? ''}
        fill="none"
        stroke={serie.color}
        strokeWidth={isClearSky ? 1.5 : 2}
        strokeDasharray={isForecast ? '7,4' : undefined}
        strokeOpacity={isForecast ? 0.85 : 1}
      />
    );
  });
}

// Tick values at 3-hour boundaries for a full day
function getThreeHourTicks(midnightTs: number): number[] {
  return Array.from(
    { length: 9 },
    (_, i) => (midnightTs + i * 3 * 3600) * 1000,
  );
}

function formatTickMs(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface ChargingStrategyChartProps {
  historyDate?: string; // YYYY-MM-DD — when set, show historical simulation
}

export default function ChargingStrategyChart({
  historyDate,
}: ChargingStrategyChartProps) {
  const url = historyDate
    ? `/api/forecast/history?date=${historyDate}`
    : '/api/forecast';
  const [forecast, setForecast] = useState<ForecastData | null>(null);
  const [history, setHistory] = useState<HistoryForecast | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loading = loadedUrl !== url;

  useEffect(() => {
    let cancelled = false;

    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!cancelled) {
          if (historyDate) {
            setHistory(data as HistoryForecast);
            setForecast(null);
          } else {
            setForecast(data as ForecastData);
            setHistory(null);
          }
          setError(null);
          setLoadedUrl(url);
        }
      })
      .catch((error_: unknown) => {
        if (!cancelled) {
          setError(error_ instanceof Error ? error_.message : 'Failed to load');
          setLoadedUrl(url);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh today's forecast every 10 minutes
  useEffect(() => {
    if (historyDate) return;
    const interval = setInterval(() => {
      fetch('/api/forecast')
        .then((r) => r.json())
        .then((data) => setForecast(data as ForecastData))
        .catch(() => undefined);
    }, 10 * 60_000);
    return () => clearInterval(interval);
  }, [historyDate]);

  if (loading) {
    return (
      <div className="card" style={{ minHeight: 280 }}>
        <span className="card-title">
          {historyDate ? 'Charging Profile' : "Today's Strategy"}
        </span>
        <div
          style={{
            color: 'var(--text-secondary)',
            padding: '40px 0',
            textAlign: 'center',
          }}
        >
          Loading forecast…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ minHeight: 280 }}>
        <span className="card-title">
          {historyDate ? 'Charging Profile' : "Today's Strategy"}
        </span>
        <div
          style={{ color: '#f87171', padding: '40px 0', textAlign: 'center' }}
        >
          {error}
        </div>
      </div>
    );
  }

  if (forecast) {
    return <TodayStrategyChart data={forecast} />;
  }

  if (history) {
    return <HistoryStrategyChart data={history} />;
  }

  return null;
}

function TodayStrategyChart({ data }: { data: ForecastData }) {
  const SLOT_H = 3;
  const nowMs = Date.now();

  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const midnightTs = Math.floor(todayMidnight.getTime() / 1000);

  // Build slot-boundary points for power/SoC charts
  const points: Array<{
    xMs: number;
    productionW: number;
    chargeW: number;
    exportW: number;
    socPct: number;
    isPast: boolean;
  }> = [];

  for (const slot of data.slots) {
    const xMs = slot.timestamp * 1000;
    const prodW = kwhToW(slot.predictedProductionKwh, SLOT_H);
    const chargeW = kwhToW(slot.batteryChargeKwh, SLOT_H);
    const exportW = kwhToW(slot.neighborExportKwh, SLOT_H);
    points.push({
      xMs,
      productionW: prodW,
      chargeW,
      exportW,
      socPct: slot.batterySocStartPct,
      isPast: slot.isPast,
    });
  }
  const lastSlot = data.slots.at(-1);
  if (lastSlot) {
    points.push({
      xMs: lastSlot.endTimestamp * 1000,
      productionW: 0,
      chargeW: 0,
      exportW: 0,
      socPct: lastSlot.batterySocEndPct,
      isPast: true,
    });
  }

  const powerLines = [
    {
      id: 'Production',
      color: '#fbbf24',
      data: points.map((p) => ({ x: p.xMs, y: Math.round(p.productionW) })),
    },
    {
      id: 'Battery charge',
      color: '#60a5fa',
      data: points.map((p) => ({ x: p.xMs, y: Math.round(p.chargeW) })),
    },
    {
      id: 'Neighbor export',
      color: '#34d399',
      data: points.map((p) => ({ x: p.xMs, y: Math.round(p.exportW) })),
    },
  ];

  const socLines = [
    {
      id: 'Battery SoC',
      color: '#22d3ee',
      data: points.map((p) => ({ x: p.xMs, y: Math.round(p.socPct) })),
    },
  ];

  // Temperature: actual (solid) + forecast (dashed)
  const meteoActual = data.meteoReadings.filter(
    (r): r is MeteoReading & { temperatureC: number } =>
      r.temperatureC !== null && r.timestamp * 1000 <= nowMs,
  );
  const forecastSlotPoints = data.slots.map((s) => ({
    x: (s.timestamp + (s.endTimestamp - s.timestamp) / 2) * 1000,
    y: Math.round(s.temperatureC * 10) / 10,
  }));

  const temperatureLines = [
    {
      id: 'temp_actual',
      color: '#fb923c',
      data: meteoActual.map((r) => ({
        x: r.timestamp * 1000,
        y: r.temperatureC,
      })),
    },
    {
      id: 'temp_forecast',
      color: '#fb923c',
      data: forecastSlotPoints,
    },
  ];

  // Panel power: actual measured (solid) + predicted (dashed) + clear-sky (dashed, lighter)
  // globalRadiationWm2 × pvScalingFactor → estimated AC output power (W)
  const { pvScalingFactor } = data;
  const radActual = data.meteoReadings.filter(
    (r): r is MeteoReading & { globalRadiationWm2: number } =>
      r.globalRadiationWm2 !== null && r.timestamp * 1000 <= nowMs,
  );
  const irradianceForecast = data.slots.map((s) => ({
    x: (s.timestamp + (s.endTimestamp - s.timestamp) / 2) * 1000,
    y: Math.round(s.predictedIrradianceWm2 * pvScalingFactor),
  }));
  const clearSkyForecast = data.slots.map((s) => ({
    x: (s.timestamp + (s.endTimestamp - s.timestamp) / 2) * 1000,
    y: Math.round(s.clearSkyIrradianceWm2 * pvScalingFactor),
  }));

  const irradianceLines = [
    {
      id: 'rad_actual',
      color: '#fbbf24',
      data: radActual.map((r) => ({
        x: r.timestamp * 1000,
        y: Math.round(r.globalRadiationWm2 * pvScalingFactor),
      })),
    },
    {
      id: 'rad_predicted_forecast',
      color: '#fbbf24',
      data: irradianceForecast,
    },
    {
      id: 'clearsky_forecast',
      color: '#64748b',
      data: clearSkyForecast,
    },
  ];

  const ticks = getThreeHourTicks(midnightTs);
  const batteryDeficitKwh =
    ((100 - data.currentSocPct) / 100) * data.batteryCapacityKwh;
  const finalSoc = lastSlot?.batterySocEndPct ?? data.currentSocPct;

  const nowMarker = [
    {
      axis: 'x' as const,
      value: nowMs,
      lineStyle: { stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '4,3' },
    },
  ];

  return (
    <div className="card">
      <div
        style={{
          alignItems: 'flex-start',
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <span className="card-title" style={{ margin: 0 }}>
          {"Today's Strategy"}
        </span>
        <div
          style={{
            color: 'var(--text-secondary)',
            display: 'flex',
            flexDirection: 'column',
            fontSize: 11,
            gap: 2,
            textAlign: 'right',
          }}
        >
          <span>
            Predicted:{' '}
            <strong style={{ color: '#fbbf24' }}>
              {data.totalDayPredictedKwh.toFixed(1)} kWh
            </strong>
          </span>
          <span>
            Need to charge:{' '}
            <strong style={{ color: '#60a5fa' }}>
              {batteryDeficitKwh.toFixed(1)} kWh
            </strong>
          </span>
          <span>
            Battery at sunset:{' '}
            <strong style={{ color: finalSoc >= 100 ? '#34d399' : '#fbbf24' }}>
              {Math.round(finalSoc)}%
            </strong>
          </span>
        </div>
      </div>

      <SunTimeline
        sunriseTs={data.sunriseTs}
        sunsetTs={data.sunsetTs}
        solarNoonTs={data.solarNoonTs}
      />

      {/* Power chart */}
      <div style={{ height: 200, marginTop: 8 }}>
        <ResponsiveLine
          data={powerLines}
          theme={nivoTheme}
          colors={({ color }) => color}
          margin={{ top: 8, right: 20, bottom: 48, left: 60 }}
          xScale={{
            type: 'linear',
            min: midnightTs * 1000,
            max: (midnightTs + 86_400) * 1000,
          }}
          yScale={{ type: 'linear', min: 0, max: 'auto' }}
          curve="stepAfter"
          axisBottom={{
            tickSize: 0,
            tickPadding: 8,
            tickRotation: -30,
            tickValues: ticks,
            format: formatTickMs,
          }}
          axisLeft={{
            tickSize: 0,
            tickPadding: 8,
            format: (v: number) => `${Math.round(v)} W`,
            tickValues: 4,
          }}
          enablePoints={false}
          enableGridX={false}
          lineWidth={2}
          useMesh
          markers={nowMarker}
          legends={[
            {
              anchor: 'bottom-right',
              direction: 'row',
              translateY: 44,
              itemWidth: 110,
              itemHeight: 14,
              symbolSize: 10,
              symbolShape: 'circle',
            },
          ]}
        />
      </div>

      {/* SoC projection */}
      <span className="card-title" style={{ marginTop: 16 }}>
        Battery SoC Projection
      </span>
      <div style={{ height: 120 }}>
        <ResponsiveLine
          data={socLines}
          theme={nivoTheme}
          colors={({ color }) => color}
          margin={{ top: 8, right: 20, bottom: 30, left: 48 }}
          xScale={{
            type: 'linear',
            min: midnightTs * 1000,
            max: (midnightTs + 86_400) * 1000,
          }}
          yScale={{ type: 'linear', min: 0, max: 100 }}
          curve="monotoneX"
          axisBottom={{
            tickSize: 0,
            tickPadding: 6,
            tickRotation: -30,
            tickValues: ticks,
            format: formatTickMs,
          }}
          axisLeft={{
            tickSize: 0,
            tickPadding: 6,
            format: (v: number) => `${v}%`,
            tickValues: 5,
          }}
          enablePoints={false}
          enableGridX={false}
          lineWidth={2}
          useMesh
          markers={nowMarker}
        />
      </div>

      {/* Temperature chart */}
      <span className="card-title" style={{ marginTop: 16 }}>
        Temperature
      </span>
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-secondary)',
          marginBottom: 4,
        }}
      >
        <span style={{ color: '#fb923c' }}>— measured</span>
        <span style={{ marginLeft: 10, color: '#fb923c', opacity: 0.7 }}>
          - - forecast
        </span>
      </div>
      <div style={{ height: 120 }}>
        <ResponsiveLine
          data={temperatureLines}
          theme={nivoTheme}
          colors={({ color }) => color}
          margin={{ top: 8, right: 20, bottom: 30, left: 48 }}
          xScale={{
            type: 'linear',
            min: midnightTs * 1000,
            max: (midnightTs + 86_400) * 1000,
          }}
          yScale={{ type: 'linear', min: 'auto', max: 'auto' }}
          curve="monotoneX"
          axisBottom={{
            tickSize: 0,
            tickPadding: 6,
            tickRotation: -30,
            tickValues: ticks,
            format: formatTickMs,
          }}
          axisLeft={{
            tickSize: 0,
            tickPadding: 6,
            format: (v: number) => `${v}°C`,
            tickValues: 4,
          }}
          enablePoints={false}
          enableGridX={false}
          useMesh
          markers={nowMarker}
          layers={[
            'grid',
            'markers',
            'axes',
            MixedLineLayer as Parameters<
              typeof ResponsiveLine
            >[0]['layers'] extends Array<infer L>
              ? L
              : never,
            'crosshair',
            'mesh',
            'legends',
          ]}
        />
      </div>

      {/* Panel power chart */}
      <span className="card-title" style={{ marginTop: 16 }}>
        Solar Panel Power
      </span>
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-secondary)',
          marginBottom: 4,
        }}
      >
        <span style={{ color: '#fbbf24' }}>— measured</span>
        <span style={{ marginLeft: 10, color: '#fbbf24', opacity: 0.7 }}>
          - - predicted
        </span>
        <span style={{ marginLeft: 10, color: '#64748b' }}>- - clear sky</span>
      </div>
      <div style={{ height: 140 }}>
        <ResponsiveLine
          data={irradianceLines}
          theme={nivoTheme}
          colors={({ color }) => color}
          margin={{ top: 8, right: 20, bottom: 30, left: 56 }}
          xScale={{
            type: 'linear',
            min: midnightTs * 1000,
            max: (midnightTs + 86_400) * 1000,
          }}
          yScale={{ type: 'linear', min: 0, max: 'auto' }}
          curve="monotoneX"
          axisBottom={{
            tickSize: 0,
            tickPadding: 6,
            tickRotation: -30,
            tickValues: ticks,
            format: formatTickMs,
          }}
          axisLeft={{
            tickSize: 0,
            tickPadding: 6,
            format: (v: number) => `${Math.round(v)} W`,
            tickValues: 4,
          }}
          enablePoints={false}
          enableGridX={false}
          useMesh
          markers={nowMarker}
          layers={[
            'grid',
            'markers',
            'axes',
            MixedLineLayer as Parameters<
              typeof ResponsiveLine
            >[0]['layers'] extends Array<infer L>
              ? L
              : never,
            'crosshair',
            'mesh',
            'legends',
          ]}
        />
      </div>
    </div>
  );
}

function HistoryStrategyChart({ data }: { data: HistoryForecast }) {
  if (data.profile.length === 0) {
    return (
      <div className="card">
        <span className="card-title">Charging Profile — {data.date}</span>
        <div
          style={{
            color: 'var(--text-secondary)',
            padding: '40px 0',
            textAlign: 'center',
          }}
        >
          No data for this date.
        </div>
      </div>
    );
  }

  const dayStart = new Date(`${data.date}T00:00:00`);
  const midnightTs = Math.floor(dayStart.getTime() / 1000);
  const ticks = getThreeHourTicks(midnightTs);

  const powerLines = [
    {
      id: 'Production',
      color: '#fbbf24',
      data: data.profile.map((p) => ({
        x: p.timestamp * 1000,
        y: Math.round(p.productionW),
      })),
    },
    {
      id: 'Battery charge',
      color: '#60a5fa',
      data: data.profile.map((p) => ({
        x: p.timestamp * 1000,
        y: Math.round(p.batteryChargeW),
      })),
    },
    {
      id: 'Neighbor export',
      color: '#34d399',
      data: data.profile.map((p) => ({
        x: p.timestamp * 1000,
        y: Math.round(p.neighborExportW),
      })),
    },
  ];

  const socLines = [
    {
      id: 'Battery SoC',
      color: '#22d3ee',
      data: data.profile.map((p) => ({
        x: p.timestamp * 1000,
        y: Math.round(p.batterySocPct),
      })),
    },
  ];

  const meteoTemp = data.meteoReadings.filter(
    (r): r is MeteoReading & { temperatureC: number } =>
      r.temperatureC !== null,
  );
  const meteoRad = data.meteoReadings.filter(
    (r): r is MeteoReading & { globalRadiationWm2: number } =>
      r.globalRadiationWm2 !== null,
  );

  const temperatureLines = [
    {
      id: 'temp_actual',
      color: '#fb923c',
      data: meteoTemp.map((r) => ({
        x: r.timestamp * 1000,
        y: r.temperatureC,
      })),
    },
  ];

  const { pvScalingFactor } = data;
  const irradianceLines = [
    {
      id: 'rad_actual',
      color: '#fbbf24',
      data: meteoRad.map((r) => ({
        x: r.timestamp * 1000,
        y: Math.round(r.globalRadiationWm2 * pvScalingFactor),
      })),
    },
  ];

  return (
    <div className="card">
      <span className="card-title">Charging Profile — {data.date}</span>

      <SunTimeline
        sunriseTs={data.sunriseTs}
        sunsetTs={data.sunsetTs}
        solarNoonTs={data.solarNoonTs}
      />

      {/* Power chart */}
      <div style={{ height: 200, marginTop: 8 }}>
        <ResponsiveLine
          data={powerLines}
          theme={nivoTheme}
          colors={({ color }) => color}
          margin={{ top: 8, right: 20, bottom: 48, left: 60 }}
          xScale={{
            type: 'linear',
            min: midnightTs * 1000,
            max: (midnightTs + 86_400) * 1000,
          }}
          yScale={{ type: 'linear', min: 0, max: 'auto' }}
          curve="stepAfter"
          axisBottom={{
            tickSize: 0,
            tickPadding: 8,
            tickRotation: -30,
            tickValues: ticks,
            format: formatTickMs,
          }}
          axisLeft={{
            tickSize: 0,
            tickPadding: 8,
            format: (v: number) => `${Math.round(v)} W`,
            tickValues: 4,
          }}
          enablePoints={false}
          enableGridX={false}
          lineWidth={2}
          useMesh
          legends={[
            {
              anchor: 'bottom-right',
              direction: 'row',
              translateY: 44,
              itemWidth: 110,
              itemHeight: 14,
              symbolSize: 10,
              symbolShape: 'circle',
            },
          ]}
        />
      </div>

      {/* SoC */}
      <span className="card-title" style={{ marginTop: 16 }}>
        Simulated Battery SoC
      </span>
      <div style={{ height: 120 }}>
        <ResponsiveLine
          data={socLines}
          theme={nivoTheme}
          colors={({ color }) => color}
          margin={{ top: 8, right: 20, bottom: 30, left: 48 }}
          xScale={{
            type: 'linear',
            min: midnightTs * 1000,
            max: (midnightTs + 86_400) * 1000,
          }}
          yScale={{ type: 'linear', min: 0, max: 100 }}
          curve="monotoneX"
          axisBottom={{
            tickSize: 0,
            tickPadding: 6,
            tickRotation: -30,
            tickValues: ticks,
            format: formatTickMs,
          }}
          axisLeft={{
            tickSize: 0,
            tickPadding: 6,
            format: (v: number) => `${v}%`,
            tickValues: 5,
          }}
          enablePoints={false}
          enableGridX={false}
          lineWidth={2}
          useMesh
        />
      </div>

      {/* Temperature chart (historical, solid only) */}
      {meteoTemp.length > 0 && (
        <>
          <span className="card-title" style={{ marginTop: 16 }}>
            Temperature
          </span>
          <div style={{ height: 120 }}>
            <ResponsiveLine
              data={temperatureLines}
              theme={nivoTheme}
              colors={({ color }) => color}
              margin={{ top: 8, right: 20, bottom: 30, left: 48 }}
              xScale={{
                type: 'linear',
                min: midnightTs * 1000,
                max: (midnightTs + 86_400) * 1000,
              }}
              yScale={{ type: 'linear', min: 'auto', max: 'auto' }}
              curve="monotoneX"
              axisBottom={{
                tickSize: 0,
                tickPadding: 6,
                tickRotation: -30,
                tickValues: ticks,
                format: formatTickMs,
              }}
              axisLeft={{
                tickSize: 0,
                tickPadding: 6,
                format: (v: number) => `${v}°C`,
                tickValues: 4,
              }}
              enablePoints={false}
              enableGridX={false}
              lineWidth={2}
              useMesh
            />
          </div>
        </>
      )}

      {/* Panel power chart (historical, solid only) */}
      {meteoRad.length > 0 && (
        <>
          <span className="card-title" style={{ marginTop: 16 }}>
            Solar Panel Power
          </span>
          <div style={{ height: 140 }}>
            <ResponsiveLine
              data={irradianceLines}
              theme={nivoTheme}
              colors={({ color }) => color}
              margin={{ top: 8, right: 20, bottom: 30, left: 56 }}
              xScale={{
                type: 'linear',
                min: midnightTs * 1000,
                max: (midnightTs + 86_400) * 1000,
              }}
              yScale={{ type: 'linear', min: 0, max: 'auto' }}
              curve="monotoneX"
              axisBottom={{
                tickSize: 0,
                tickPadding: 6,
                tickRotation: -30,
                tickValues: ticks,
                format: formatTickMs,
              }}
              axisLeft={{
                tickSize: 0,
                tickPadding: 6,
                format: (v: number) => `${Math.round(v)} W`,
                tickValues: 4,
              }}
              enablePoints={false}
              enableGridX={false}
              lineWidth={2}
              useMesh
            />
          </div>
        </>
      )}
    </div>
  );
}

function SunTimeline({
  sunriseTs,
  sunsetTs,
  solarNoonTs,
}: {
  sunriseTs: number;
  sunsetTs: number;
  solarNoonTs: number;
}) {
  return (
    <div
      style={{
        alignItems: 'center',
        color: 'var(--text-secondary)',
        display: 'flex',
        fontSize: 11,
        gap: 12,
        marginBottom: 4,
      }}
    >
      <span>🌅 {fmt(sunriseTs)}</span>
      <span>☀️ {fmt(solarNoonTs)}</span>
      <span>🌇 {fmt(sunsetTs)}</span>
    </div>
  );
}
