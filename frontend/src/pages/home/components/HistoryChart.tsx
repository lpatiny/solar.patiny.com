import { ResponsiveLine } from '@nivo/line';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { BrushLayer } from './BrushLayer.tsx';
import { SeasonLayer } from './SeasonLayer.tsx';
import type { HistoryPoint, HistoryResolution } from './historyChartUtils.ts';
import {
  buildOverlayNivoData,
  buildOverlaySocData,
  buildPowerLegendData,
  buildSocLegendData,
  buildTimelineNivoData,
  buildTimelineSocData,
  dailyKeyToMonthYear,
  dailyKeyToShort,
  deriveResolution,
  formatDateRange,
  formatTime,
  formatTimeOfDay,
  groupByDay,
  hourlyKeyToDate,
  hourlyKeyToTime,
  nivoTheme,
} from './historyChartUtils.ts';

interface HistoryChartProps {
  from: number;
  to: number;
}

/**
 * Pill-shaped toggle/selection button used for resolution and overlay controls.
 * @param root0 - Component props.
 * @param root0.label - Button label text.
 * @param root0.active - Whether the button is in active/selected state.
 * @param root0.onClick - Click handler.
 * @returns The button element.
 */
function ToggleButton({
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
 * Historical power and battery SOC charts with resolution selector and day-overlay mode.
 * @param root0 - Component props.
 * @param root0.from - Start of the displayed range as a unix timestamp (seconds).
 * @param root0.to - End of the displayed range as a unix timestamp (seconds).
 * @returns The history chart card.
 */
export default function HistoryChart({ from, to }: HistoryChartProps) {
  const autoResolution = deriveResolution(from, to);
  const [manualResolution, setManualResolution] =
    useState<HistoryResolution | null>(null);
  const [overlayMode, setOverlayMode] = useState(false);
  const [prevFrom, setPrevFrom] = useState(from);
  const [prevTo, setPrevTo] = useState(to);
  const [zoomIndices, setZoomIndices] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  if (from !== prevFrom || to !== prevTo) {
    setPrevFrom(from);
    setPrevTo(to);
    setManualResolution(null);
    setZoomIndices(null);
    setOverlayMode(false);
    setHiddenIds(new Set());
  }

  const resolution = manualResolution ?? autoResolution;
  const [data, setData] = useState<HistoryPoint[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const fetchKey = `${resolution}-${from}-${to}`;
  const loading = loadedKey !== fetchKey;

  const visibleData = useMemo(
    () =>
      zoomIndices ? data.slice(zoomIndices.start, zoomIndices.end + 1) : data,
    [data, zoomIndices],
  );

  const overlayDays = useMemo(
    () => (overlayMode ? groupByDay(visibleData) : null),
    [overlayMode, visibleData],
  );

  const nivoData = useMemo(
    () =>
      overlayDays
        ? buildOverlayNivoData(overlayDays, hiddenIds)
        : buildTimelineNivoData(visibleData, resolution, hiddenIds),
    [overlayDays, visibleData, resolution, hiddenIds],
  );

  const socData = useMemo(
    () =>
      overlayDays
        ? buildOverlaySocData(overlayDays, hiddenIds)
        : buildTimelineSocData(visibleData, resolution, hiddenIds),
    [overlayDays, visibleData, resolution, hiddenIds],
  );

  const powerLegendData = useMemo(
    () => buildPowerLegendData(overlayDays, hiddenIds),
    [overlayDays, hiddenIds],
  );

  const socLegendData = useMemo(
    () => buildSocLegendData(overlayDays, hiddenIds),
    [overlayDays, hiddenIds],
  );

  const toggleId = useCallback((id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleOverlayToggle = useCallback(() => {
    setOverlayMode((prev) => !prev);
    setHiddenIds(new Set());
  }, []);

  const handleResolutionChange = useCallback((res: HistoryResolution) => {
    setManualResolution(res);
    if (res !== 'hourly') {
      setOverlayMode(false);
      setHiddenIds(new Set());
    }
  }, []);

  const handleZoom = useCallback(
    (startFrac: number, endFrac: number) => {
      const len = visibleData.length;
      const startIdx = Math.round(startFrac * (len - 1));
      const endIdx = Math.round(endFrac * (len - 1));
      if (endIdx > startIdx) {
        const base = zoomIndices?.start ?? 0;
        setZoomIndices({ start: base + startIdx, end: base + endIdx });
      }
    },
    [zoomIndices, visibleData.length],
  );

  const resetZoom = useCallback(() => setZoomIndices(null), []);

  const timestamps = useMemo(
    () => visibleData.map((p) => p.timestamp),
    [visibleData],
  );

  const isMultiDayHourly = useMemo(() => {
    if (overlayMode || resolution !== 'hourly') return false;
    const first = visibleData[0];
    const last = visibleData.at(-1);
    return (
      first !== undefined &&
      last !== undefined &&
      new Date(first.timestamp * 1000).toDateString() !==
        new Date(last.timestamp * 1000).toDateString()
    );
  }, [overlayMode, resolution, visibleData]);

  const isMultiYearDaily = useMemo(() => {
    if (resolution !== 'daily') return false;
    const first = visibleData[0];
    const last = visibleData.at(-1);
    return (
      first !== undefined &&
      last !== undefined &&
      new Date(first.timestamp * 1000).getFullYear() !==
        new Date(last.timestamp * 1000).getFullYear()
    );
  }, [resolution, visibleData]);

  const tickValues = useMemo(() => {
    if (isMultiDayHourly) {
      // One tick per calendar day, subsampled to ~8 visible labels
      const daysSeen = new Set<string>();
      const dayTicks: string[] = [];
      for (const p of visibleData) {
        const dateKey = new Date(p.timestamp * 1000).toDateString();
        if (!daysSeen.has(dateKey)) {
          daysSeen.add(dateKey);
          dayTicks.push(formatTime(p.timestamp, resolution));
        }
      }
      const step = Math.max(1, Math.round(dayTicks.length / 8));
      return dayTicks.filter((_, i) => i % step === 0);
    }
    if (isMultiYearDaily) {
      // One tick per calendar month, subsampled to ~8 visible labels
      const monthsSeen = new Set<string>();
      const monthTicks: string[] = [];
      for (const p of visibleData) {
        const d = new Date(p.timestamp * 1000);
        const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
        if (!monthsSeen.has(monthKey)) {
          monthsSeen.add(monthKey);
          monthTicks.push(formatTime(p.timestamp, resolution));
        }
      }
      const step = Math.max(1, Math.round(monthTicks.length / 8));
      return monthTicks.filter((_, i) => i % step === 0);
    }
    const sourcePoints = overlayDays?.[0]?.[1] ?? visibleData;
    const step = Math.max(1, Math.round(sourcePoints.length / 8));
    return sourcePoints
      .filter((_, i) => i % step === 0)
      .map((p) =>
        overlayMode
          ? formatTimeOfDay(p.timestamp)
          : formatTime(p.timestamp, resolution),
      );
  }, [
    visibleData,
    overlayDays,
    resolution,
    overlayMode,
    isMultiDayHourly,
    isMultiYearDaily,
  ]);

  const axisBottomFormat = useMemo(() => {
    if (resolution === 'hourly' && !overlayMode) {
      return isMultiDayHourly ? hourlyKeyToDate : hourlyKeyToTime;
    }
    if (resolution === 'daily') {
      return isMultiYearDaily ? dailyKeyToMonthYear : dailyKeyToShort;
    }
    return undefined;
  }, [resolution, overlayMode, isMultiDayHourly, isMultiYearDaily]);

  const makeSeasonLayer = useCallback(
    (props: { innerWidth: number; innerHeight: number }) => (
      <SeasonLayer
        innerWidth={props.innerWidth}
        innerHeight={props.innerHeight}
        timestamps={timestamps}
      />
    ),
    [timestamps],
  );

  const makeBrushLayer = useCallback(
    (props: { innerWidth: number; innerHeight: number }) => (
      <BrushLayer
        innerWidth={props.innerWidth}
        innerHeight={props.innerHeight}
        onZoom={handleZoom}
        onReset={resetZoom}
      />
    ),
    [handleZoom, resetZoom],
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/history?resolution=${resolution}&from=${from}&to=${to}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((rows: unknown) => {
        if (!cancelled) {
          setData(Array.isArray(rows) ? (rows as HistoryPoint[]) : []);
          setLoadedKey(fetchKey);
          setZoomIndices(null);
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

  const rangeLabel =
    zoomIndices && visibleData.length > 1
      ? formatDateRange(
          visibleData[0]?.timestamp ?? from,
          visibleData.at(-1)?.timestamp ?? to,
        )
      : formatDateRange(from, to);

  const chartLayers = overlayMode
    ? ([
        'grid',
        'markers',
        'axes',
        'areas',
        'crosshair',
        'lines',
        'points',
        'slices',
        'mesh',
        'legends',
      ] as const)
    : ([
        makeSeasonLayer,
        'grid',
        'markers',
        'axes',
        'areas',
        'crosshair',
        'lines',
        'points',
        'slices',
        'mesh',
        'legends',
        makeBrushLayer,
      ] as const);

  const controls = (
    <div style={{ alignItems: 'center', display: 'flex', gap: 6 }}>
      {resolution === 'hourly' && (
        <ToggleButton
          label="Overlay"
          active={overlayMode}
          onClick={handleOverlayToggle}
        />
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <ToggleButton
          label="Hour"
          active={resolution === 'hourly'}
          onClick={() => handleResolutionChange('hourly')}
        />
        <ToggleButton
          label="Day"
          active={resolution === 'daily'}
          onClick={() => handleResolutionChange('daily')}
        />
        <ToggleButton
          label="Month"
          active={resolution === 'monthly'}
          onClick={() => handleResolutionChange('monthly')}
        />
      </div>
    </div>
  );

  if (!loading && data.length === 0) {
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
            {rangeLabel} — Power
          </span>
          {controls}
        </div>
        <div
          style={{
            color: 'var(--text-secondary)',
            padding: '40px 0',
            textAlign: 'center',
          }}
        >
          No historical data for the selected range.
        </div>
      </div>
    );
  }

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
          {rangeLabel} — Power
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
      ) : (
        <div style={{ height: 260 }}>
          <ResponsiveLine
            data={nivoData}
            theme={nivoTheme}
            colors={({ color }) => color}
            margin={{ top: 10, right: 60, bottom: 40, left: 70 }}
            xScale={{ type: 'point' }}
            yScale={{ type: 'linear', min: 'auto', max: 'auto' }}
            axisBottom={{
              tickSize: 0,
              tickPadding: 8,
              tickRotation: -30,
              tickValues,
              format: axisBottomFormat,
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
            useMesh={false}
            layers={chartLayers}
            legends={[
              {
                anchor: 'top-right',
                direction: 'column',
                translateX: -5,
                translateY: 5,
                itemWidth: overlayMode ? 160 : 120,
                itemHeight: 18,
                symbolSize: 10,
                symbolShape: 'circle',
                onClick: (datum) => toggleId(datum.id as string),
                data: powerLegendData,
              },
            ]}
          />
        </div>
      )}

      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 8,
          marginTop: 24,
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
            padding: '20px 0',
            textAlign: 'center',
          }}
        >
          Loading…
        </div>
      ) : (
        <div style={{ height: 180 }}>
          <ResponsiveLine
            data={socData}
            theme={nivoTheme}
            colors={({ color }) => color}
            margin={{ top: 10, right: 60, bottom: 40, left: 70 }}
            xScale={{ type: 'point' }}
            yScale={{ type: 'linear', min: 0, max: 100 }}
            axisBottom={{
              tickSize: 0,
              tickPadding: 8,
              tickRotation: -30,
              tickValues,
              format: axisBottomFormat,
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
            useMesh={false}
            layers={chartLayers}
            legends={[
              {
                anchor: 'top-right',
                direction: 'column',
                translateX: -5,
                translateY: 5,
                itemWidth: overlayMode ? 160 : 100,
                itemHeight: 18,
                symbolSize: 10,
                symbolShape: 'circle',
                onClick: (datum) => toggleId(datum.id as string),
                data: socLegendData,
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
