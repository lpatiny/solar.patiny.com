/* eslint-disable @typescript-eslint/naming-convention -- API response fields use snake_case */
/* eslint-disable jsdoc/require-param, jsdoc/require-returns -- internal module, descriptions are sufficient */

export type HistoryResolution = 'hourly' | 'daily' | 'monthly';

export interface HistoryPoint {
  timestamp: number;
  production_w: number;
  grid_w: number;
  battery_w: number;
  consumption_w: number;
  battery_soc_max: number | null;
  battery_soc_min: number | null;
}

export interface NivoSeries {
  id: string;
  color: string;
  data: Array<{ x: string; y: number }>;
}

export const POWER_SERIES_META = [
  { id: 'Solar', color: '#fbbf24' },
  { id: 'Consumption', color: '#c084fc' },
  { id: 'Grid injection', color: '#34d399' },
] as const;

export const SOC_SERIES_META = [
  { id: 'Max SOC (%)', color: '#60a5fa' },
  { id: 'Min SOC (%)', color: '#818cf8' },
] as const;

// Shades per metric for overlay mode: day 0 = vivid, later days = progressively lighter
export const METRIC_DAY_SHADES: Partial<Record<string, readonly string[]>> = {
  Solar: ['#fbbf24', '#fcd34d', '#fef08a', '#fef9c3'],
  Consumption: ['#c084fc', '#d8b4fe', '#e9d5ff', '#f3e8ff'],
  'Grid injection': ['#34d399', '#6ee7b7', '#a7f3d0', '#d1fae5'],
  'Max SOC (%)': ['#60a5fa', '#93c5fd', '#bfdbfe', '#dbeafe'],
  'Min SOC (%)': ['#818cf8', '#a5b4fc', '#c7d2fe', '#e0e7ff'],
};

export const nivoTheme = {
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

/** Chooses hourly/daily/monthly resolution based on the requested time span. */
export function deriveResolution(from: number, to: number): HistoryResolution {
  const days = (to - from) / 86_400;
  if (days > 90) return 'monthly';
  if (days > 1) return 'daily';
  return 'hourly';
}

/**
 * Formats a unix timestamp for the timeline x-axis according to the current resolution.
 * Uses a `|` separator to encode both the human-readable label and a disambiguator so
 * points from different years/days always get unique x-axis positions:
 *   - monthly  → "Jan 2025"  (already unique, no separator needed)
 *   - daily    → "Jul 1|2024"
 *   - hourly   → "Jul 1|09:00"
 * Use the `dailyKey*` / `hourlyKey*` helpers to extract parts for axis labels.
 */
export function formatTime(ts: number, resolution: HistoryResolution): string {
  const d = new Date(ts * 1000);
  if (resolution === 'monthly') {
    return d.toLocaleDateString([], { month: 'short', year: 'numeric' });
  }
  if (resolution === 'daily') {
    const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${date}|${d.getFullYear()}`;
  }
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${date}|${time}`;
}

/** Extracts "Jul 1" from a daily key "Jul 1|2024". */
export function dailyKeyToShort(key: string): string {
  return key.includes('|') ? (key.split('|')[0] ?? key) : key;
}

/** Extracts "Jul 2024" from a daily key "Jul 1|2024" (month + year, for multi-year axes). */
export function dailyKeyToMonthYear(key: string): string {
  const [datePart, year] = key.split('|');
  if (!datePart || !year) return key;
  const month = datePart.split(' ')[0] ?? datePart;
  return `${month} ${year}`;
}

/** Extracts the date part from a formatTime hourly key (e.g. "Jul 1|09:00" → "Jul 1"). */
export function hourlyKeyToDate(key: string): string {
  return key.includes('|') ? (key.split('|')[0] ?? key) : key;
}

/** Extracts the time part from a formatTime hourly key (e.g. "Jul 1|09:00" → "09:00"). */
export function hourlyKeyToTime(key: string): string {
  return key.includes('|') ? (key.split('|')[1] ?? key) : key;
}

/** Formats a unix timestamp as HH:MM for use as the x-axis value in overlay mode. */
export function formatTimeOfDay(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Formats a unix timestamp range as a human-readable date string for the chart title. */
export function formatDateRange(from: number, to: number): string {
  const f = new Date(from * 1000);
  const t = new Date(to * 1000);
  if (f.toDateString() === t.toDateString()) {
    return f.toLocaleDateString([], { dateStyle: 'medium' });
  }
  const fromOptions: Intl.DateTimeFormatOptions =
    f.getFullYear() !== t.getFullYear()
      ? { month: 'short', day: 'numeric', year: 'numeric' }
      : { month: 'short', day: 'numeric' };
  return `${f.toLocaleDateString([], fromOptions)} – ${t.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/** Groups history points by calendar day, returning entries ordered by first appearance. */
export function groupByDay(
  data: HistoryPoint[],
): Array<[string, HistoryPoint[]]> {
  const groups = new Map<string, HistoryPoint[]>();
  for (const p of data) {
    const key = new Date(p.timestamp * 1000).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
    });
    const existing = groups.get(key);
    if (existing) {
      existing.push(p);
    } else {
      groups.set(key, [p]);
    }
  }
  return [...groups.entries()];
}

/** Builds nivo series for the power chart in linear timeline mode. */
export function buildTimelineNivoData(
  data: HistoryPoint[],
  resolution: HistoryResolution,
  hiddenIds: Set<string>,
): NivoSeries[] {
  return [
    {
      id: 'Solar',
      color: '#fbbf24',
      data: data.map((p) => ({
        x: formatTime(p.timestamp, resolution),
        y: Math.round(p.production_w),
      })),
    },
    {
      id: 'Consumption',
      color: '#c084fc',
      data: data.map((p) => ({
        x: formatTime(p.timestamp, resolution),
        y: Math.round(p.consumption_w),
      })),
    },
    {
      id: 'Grid injection',
      color: '#34d399',
      data: data.map((p) => ({
        x: formatTime(p.timestamp, resolution),
        y: p.grid_w < 0 ? Math.round(-p.grid_w) : 0,
      })),
    },
  ].filter((s) => !hiddenIds.has(s.id));
}

/** Builds nivo series for the power chart in overlay mode (one series per metric per day). */
export function buildOverlayNivoData(
  days: Array<[string, HistoryPoint[]]>,
  hiddenIds: Set<string>,
): NivoSeries[] {
  const result: NivoSeries[] = [];
  for (const [dayIndex, [dayLabel, points]] of days.entries()) {
    const sorted = points.toSorted((a, b) => a.timestamp - b.timestamp);
    for (const meta of POWER_SERIES_META) {
      const id = `${meta.id} — ${dayLabel}`;
      if (hiddenIds.has(id)) continue;
      const shades = METRIC_DAY_SHADES[meta.id] ?? [meta.color];
      const color = shades[dayIndex % shades.length] ?? meta.color;
      result.push({
        id,
        color,
        data: sorted.map((p) => ({
          x: formatTimeOfDay(p.timestamp),
          y:
            meta.id === 'Solar'
              ? Math.round(p.production_w)
              : meta.id === 'Consumption'
                ? Math.round(p.consumption_w)
                : p.grid_w < 0
                  ? Math.round(-p.grid_w)
                  : 0,
        })),
      });
    }
  }
  return result;
}

/** Builds nivo series for the SOC chart in linear timeline mode. */
export function buildTimelineSocData(
  data: HistoryPoint[],
  resolution: HistoryResolution,
  hiddenIds: Set<string>,
): NivoSeries[] {
  return [
    {
      id: 'Max SOC (%)',
      color: '#60a5fa',
      data: data
        .filter((p) => p.battery_soc_max !== null)
        .map((p) => ({
          x: formatTime(p.timestamp, resolution),
          y: Math.round(p.battery_soc_max as number),
        })),
    },
    {
      id: 'Min SOC (%)',
      color: '#818cf8',
      data: data
        .filter((p) => p.battery_soc_min !== null)
        .map((p) => ({
          x: formatTime(p.timestamp, resolution),
          y: Math.round(p.battery_soc_min as number),
        })),
    },
  ].filter((s) => !hiddenIds.has(s.id));
}

/** Builds nivo series for the SOC chart in overlay mode (one series per metric per day). */
export function buildOverlaySocData(
  days: Array<[string, HistoryPoint[]]>,
  hiddenIds: Set<string>,
): NivoSeries[] {
  const result: NivoSeries[] = [];
  for (const [dayIndex, [dayLabel, points]] of days.entries()) {
    const sorted = points.toSorted((a, b) => a.timestamp - b.timestamp);
    for (const meta of SOC_SERIES_META) {
      const id = `${meta.id} — ${dayLabel}`;
      if (hiddenIds.has(id)) continue;
      const shades = METRIC_DAY_SHADES[meta.id] ?? [meta.color];
      const color = shades[dayIndex % shades.length] ?? meta.color;
      result.push({
        id,
        color,
        data: sorted
          .filter((p) =>
            meta.id === 'Max SOC (%)'
              ? p.battery_soc_max !== null
              : p.battery_soc_min !== null,
          )
          .map((p) => ({
            x: formatTimeOfDay(p.timestamp),
            y: Math.round(
              (meta.id === 'Max SOC (%)'
                ? p.battery_soc_max
                : p.battery_soc_min) as number,
            ),
          })),
      });
    }
  }
  return result;
}

/** Builds legend items for the power chart, with dimmed colors for hidden series. */
export function buildPowerLegendData(
  overlayDays: Array<[string, HistoryPoint[]]> | null,
  hiddenIds: Set<string>,
): Array<{ id: string; label: string; color: string }> {
  if (!overlayDays) {
    return POWER_SERIES_META.map((s) => ({
      id: s.id,
      label: s.id,
      color: hiddenIds.has(s.id) ? '#334155' : s.color,
    }));
  }
  return overlayDays.flatMap(([dayLabel], dayIndex) =>
    POWER_SERIES_META.map((meta) => {
      const id = `${meta.id} — ${dayLabel}`;
      const shades = METRIC_DAY_SHADES[meta.id] ?? [meta.color];
      const color = shades[dayIndex % shades.length] ?? meta.color;
      return { id, label: id, color: hiddenIds.has(id) ? '#334155' : color };
    }),
  );
}

/** Builds legend items for the SOC chart, with dimmed colors for hidden series. */
export function buildSocLegendData(
  overlayDays: Array<[string, HistoryPoint[]]> | null,
  hiddenIds: Set<string>,
): Array<{ id: string; label: string; color: string }> {
  if (!overlayDays) {
    return SOC_SERIES_META.map((s) => ({
      id: s.id,
      label: s.id,
      color: hiddenIds.has(s.id) ? '#334155' : s.color,
    }));
  }
  return overlayDays.flatMap(([dayLabel], dayIndex) =>
    SOC_SERIES_META.map((meta) => {
      const id = `${meta.id} — ${dayLabel}`;
      const shades = METRIC_DAY_SHADES[meta.id] ?? [meta.color];
      const color = shades[dayIndex % shades.length] ?? meta.color;
      return { id, label: id, color: hiddenIds.has(id) ? '#334155' : color };
    }),
  );
}
