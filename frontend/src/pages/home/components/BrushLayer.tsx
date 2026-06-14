import { useCallback, useState } from 'react';

/** One nivo-computed point: original datum plus its pixel position. */
interface NivoComputedPoint {
  position: { x: number; y: number };
  data: { x: number; y: number };
}

/** Nivo's computed series passed to custom layers (pixel positions + data). */
export interface NivoComputedSerie {
  id: string;
  color: string;
  data: NivoComputedPoint[];
}

interface BrushLayerProps {
  innerWidth: number;
  innerHeight: number;
  /** Visible computed series; when provided, a hover value tracker is shown. */
  series?: readonly NivoComputedSerie[];
  /** Maps a series id to its display label (required when `series` is set). */
  labelById?: (id: string) => string;
  onZoom: (startFraction: number, endFraction: number) => void;
  onReset: () => void;
}

interface Brush {
  start: number;
  current: number;
}

/** A series value resolved at the tracked timestamp. */
interface TrackerRow {
  id: string;
  label: string;
  color: string;
  value: number;
  pointY: number;
}

interface Tracker {
  x: number;
  timestampMs: number;
  rows: TrackerRow[];
}

const TOOLTIP_WIDTH = 188;
const ROW_HEIGHT = 18;
const TOOLTIP_PADDING = 8;

function formatTimeMs(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Resolve, for every visible series, the data point nearest the cursor and the
 * shared snapped timestamp, so the crosshair lands on real samples.
 * @param series - nivo's computed series (pixel positions + original data)
 * @param labelById - maps a series id to its display label
 * @param pixelX - the cursor x within the inner chart area
 * @returns the tracker state, or null when there is nothing to show
 */
function buildTracker(
  series: readonly NivoComputedSerie[],
  labelById: (id: string) => string,
  pixelX: number,
): Tracker | null {
  let snapX = pixelX;
  let snapMs = 0;
  let bestDistance = Infinity;
  for (const serie of series) {
    for (const point of serie.data) {
      const distance = Math.abs(point.position.x - pixelX);
      if (distance < bestDistance) {
        bestDistance = distance;
        snapX = point.position.x;
        snapMs = point.data.x;
      }
    }
  }
  if (bestDistance === Infinity) return null;

  const rows: TrackerRow[] = [];
  for (const serie of series) {
    // Skip series that have no sample at the tracked time (e.g. the solar
    // forecast, which only spans from the last reading into the future).
    const firstX = serie.data[0]?.data.x;
    const lastX = serie.data.at(-1)?.data.x;
    if (firstX == null || lastX == null) continue;
    if (snapMs < firstX || snapMs > lastX) continue;

    let nearest: NivoComputedPoint | null = null;
    let nearestDistance = Infinity;
    for (const point of serie.data) {
      const distance = Math.abs(point.position.x - snapX);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = point;
      }
    }
    if (!nearest) continue;
    const isForecast = serie.id.endsWith('_forecast');
    rows.push({
      id: serie.id,
      label: isForecast
        ? `${labelById(serie.id.replace('_forecast', ''))} (forecast)`
        : labelById(serie.id),
      color: serie.color,
      value: nearest.data.y,
      pointY: nearest.position.y,
    });
  }
  return { x: snapX, timestampMs: snapMs, rows };
}

export function BrushLayer({
  innerWidth,
  innerHeight,
  series,
  labelById,
  onZoom,
  onReset,
}: BrushLayerProps) {
  const [brush, setBrush] = useState<Brush | null>(null);
  const [tracker, setTracker] = useState<Tracker | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setBrush({ start: x, current: x });
    setTracker(null);
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGRectElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.max(0, Math.min(innerWidth, e.clientX - rect.left));
      if (brush) {
        setBrush((prev) => (prev ? { ...prev, current: x } : null));
        return;
      }
      if (series && labelById) {
        setTracker(buildTracker(series, labelById, x));
      }
    },
    [brush, innerWidth, series, labelById],
  );

  const commit = useCallback(() => {
    if (!brush) return;
    const minX = Math.min(brush.start, brush.current);
    const maxX = Math.max(brush.start, brush.current);
    if (maxX - minX > 5) {
      const startFraction = minX / innerWidth;
      const endFraction = maxX / innerWidth;
      if (endFraction > startFraction) {
        onZoom(startFraction, endFraction);
      }
    }
    setBrush(null);
  }, [brush, innerWidth, onZoom]);

  const handleMouseLeave = useCallback(() => {
    commit();
    setTracker(null);
  }, [commit]);

  const selX = brush ? Math.min(brush.start, brush.current) : 0;
  const selW = brush ? Math.abs(brush.current - brush.start) : 0;

  const tooltipHeight = tracker
    ? TOOLTIP_PADDING * 2 + ROW_HEIGHT * (tracker.rows.length + 1)
    : 0;
  const tooltipX =
    tracker && tracker.x + 12 + TOOLTIP_WIDTH > innerWidth
      ? tracker.x - 12 - TOOLTIP_WIDTH
      : (tracker?.x ?? 0) + 12;
  const tooltipY = Math.max(0, Math.min(8, innerHeight - tooltipHeight));

  return (
    <g>
      {brush && selW > 2 && (
        <rect
          x={selX}
          y={0}
          width={selW}
          height={innerHeight}
          fill="rgba(148,163,184,0.12)"
          stroke="#94a3b8"
          strokeWidth={1}
          pointerEvents="none"
        />
      )}
      {tracker && !brush && (
        <g pointerEvents="none">
          <line
            x1={tracker.x}
            x2={tracker.x}
            y1={0}
            y2={innerHeight}
            stroke="#94a3b8"
            strokeWidth={1}
            strokeDasharray="3,3"
          />
          {tracker.rows.map((row) => (
            <circle
              key={row.id}
              cx={tracker.x}
              cy={row.pointY}
              r={4}
              fill={row.color}
              stroke="#0f172a"
              strokeWidth={1.5}
            />
          ))}
          <foreignObject
            x={tooltipX}
            y={tooltipY}
            width={TOOLTIP_WIDTH}
            height={tooltipHeight}
          >
            <div
              style={{
                background: '#263347',
                border: '1px solid #334155',
                borderRadius: 8,
                color: '#f1f5f9',
                fontSize: 12,
                padding: TOOLTIP_PADDING,
              }}
            >
              <div
                style={{
                  borderBottom: '1px solid #334155',
                  color: '#94a3b8',
                  marginBottom: 4,
                  paddingBottom: 4,
                }}
              >
                {formatTimeMs(tracker.timestampMs)}
              </div>
              {tracker.rows.map((row) => (
                <div
                  key={row.id}
                  style={{
                    alignItems: 'center',
                    display: 'flex',
                    gap: 6,
                    height: ROW_HEIGHT,
                  }}
                >
                  <span
                    style={{
                      background: row.color,
                      borderRadius: '50%',
                      flexShrink: 0,
                      height: 8,
                      width: 8,
                    }}
                  />
                  <span style={{ flex: 1 }}>{row.label}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {Math.round(row.value)} W
                  </span>
                </div>
              ))}
            </div>
          </foreignObject>
        </g>
      )}
      <rect
        x={0}
        y={0}
        width={innerWidth}
        height={innerHeight}
        fill="transparent"
        style={{ cursor: 'crosshair', pointerEvents: 'all' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={commit}
        onMouseLeave={handleMouseLeave}
        onDoubleClick={onReset}
      />
    </g>
  );
}
