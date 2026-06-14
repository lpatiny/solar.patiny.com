import { useEffect, useState } from 'react';

import type { HistoryPoint } from './historyChartUtils.ts';

const LIVE_POLL_MS = 30_000;

/**
 * Load the BYD home-battery state-of-charge history for a day from the
 * aggregated electrical readings, polling so today's chart stays current.
 * @param from - day start (unix seconds)
 * @param to - day end (unix seconds)
 * @param live - when `true`, re-poll the history. Defaults to `false`.
 * @returns the measured SOC points as `{ x: ms, y: percent }`.
 */
export function useHomeBatterySoc(
  from: number,
  to: number,
  live = false,
): Array<{ x: number; y: number }> {
  const [points, setPoints] = useState<Array<{ x: number; y: number }>>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch(`/api/history?resolution=raw&from=${from}&to=${to}`)
        .then((r) => r.json())
        .then((rows: HistoryPoint[]) => {
          if (cancelled) return;
          const series: Array<{ x: number; y: number }> = [];
          for (const row of rows) {
            if (row?.battery_soc_max == null) continue;
            series.push({
              x: row.timestamp * 1000,
              y: Math.round(row.battery_soc_max),
            });
          }
          setPoints(series);
        })
        .catch(() => {
          if (!cancelled) setPoints([]);
        });
    void load();
    const interval = live
      ? setInterval(() => void load(), LIVE_POLL_MS)
      : undefined;
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [from, to, live]);

  return points;
}
