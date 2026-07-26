/* eslint-disable @typescript-eslint/naming-convention -- API fields are snake_case */
import { useEffect, useState } from 'react';

/** The `/api/energy-flow` payload: four levels plus the links between them. */
export interface EnergyFlowData {
  timestamp: number;
  is_stale: boolean;
  production_w: number;
  consumption_w: number;
  grid_import_w: number;
  grid_export_w: number;
  battery_stored_wh: number;
  battery_capacity_wh: number;
  byd_stored_wh: number;
  byd_capacity_wh: number;
  marstek_stored_wh: number;
  marstek_capacity_wh: number;
  battery_soc_pct: number;
  battery_charge_w: number;
  battery_discharge_w: number;
  solar_to_home_w: number;
  solar_to_battery_w: number;
  solar_to_grid_w: number;
  battery_to_home_w: number;
  battery_to_grid_w: number;
  grid_to_home_w: number;
  grid_to_battery_w: number;
}

/** Refresh cadence of the wall, in milliseconds. */
const POLL_MS = 10_000;

/**
 * Poll `/api/energy-flow` every 10 s. The previous reading is kept while a
 * request fails, so a dropped poll dims the wall rather than blanking it.
 * @returns The latest reading and the last error, if any.
 */
export function useEnergyFlow(): {
  data: EnergyFlowData | null;
  error: string | null;
} {
  const [data, setData] = useState<EnergyFlowData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch('/api/energy-flow');
        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const payload = (await response.json()) as EnergyFlowData;
        if (!cancelled) {
          setData(payload);
          setError(null);
        }
      } catch (error_) {
        if (!cancelled) {
          setError(error_ instanceof Error ? error_.message : 'Fetch failed');
        }
      }
    }

    void load();
    const interval = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { data, error };
}
