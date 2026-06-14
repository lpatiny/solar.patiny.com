import { useEffect, useState } from 'react';

import type { BatteryHistoryPoint, Device } from '../../../types.ts';

import type { BatteryDevice } from './batteryChargeSeries.ts';

interface BatteryCharge {
  batteries: BatteryDevice[];
  historyById: Record<number, BatteryHistoryPoint[]>;
}

const LIVE_POLL_MS = 30_000;

/**
 * Load the per-battery data backing the day power chart: the enabled Marstek
 * devices and each device's reading history for the selected day.
 * @param from - day start (unix seconds)
 * @param to - day end (unix seconds)
 * @param live - when `true`, re-poll the history so today's chart stays current. Defaults to `false`.
 * @returns the batteries and their history
 */
export function useBatteryCharge(
  from: number,
  to: number,
  live = false,
): BatteryCharge {
  const [batteries, setBatteries] = useState<BatteryDevice[]>([]);
  const [historyById, setHistoryById] = useState<
    Record<number, BatteryHistoryPoint[]>
  >({});

  useEffect(() => {
    fetch('/api/devices')
      .then((r) => r.json())
      .then((rows: Device[]) =>
        setBatteries(
          rows
            .filter((d) => d.enabled && d.type === 'marstek')
            .map((d) => ({ id: d.id, name: d.name })),
        ),
      )
      .catch(() => setBatteries([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Promise.all over an empty battery list resolves to {} and clears stale
    // history without a synchronous setState in the effect body.
    const load = () =>
      Promise.all(
        batteries.map((battery) =>
          fetch(
            `/api/devices/${battery.id}/history?resolution=raw&from=${from}&to=${to}`,
          )
            .then((r) => r.json())
            .then(
              (rows) => [battery.id, rows as BatteryHistoryPoint[]] as const,
            )
            .catch(() => [battery.id, [] as BatteryHistoryPoint[]] as const),
        ),
      ).then((entries) => {
        if (!cancelled) setHistoryById(Object.fromEntries(entries));
      });
    void load();
    const interval = live
      ? setInterval(() => void load(), LIVE_POLL_MS)
      : undefined;
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [batteries, from, to, live]);

  return { batteries, historyById };
}
