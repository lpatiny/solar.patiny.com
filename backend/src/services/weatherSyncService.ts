import { db } from '../db/Database.ts';

import {
  STATION_CODES,
  fetchHistoricalStationReadings,
  fetchRecentStationReadings,
  fetchStationReadings,
  hasClimateData,
} from './meteoStationService.ts';

/**
 * Full historical backfill: fetches every relevant decade from MeteoSwiss OGD,
 * then the recent ~2-month window, then the live reading.
 * Safe to call multiple times (all writes are upserts).
 */
export async function syncWeatherHistory(): Promise<{
  inserted: number;
  years: number[];
}> {
  const oldestTs = db.getOldestSolarwebTimestamp();
  if (oldestTs === null) return { inserted: 0, years: [] };

  const oldestYear = new Date(oldestTs * 1000).getUTCFullYear();
  const currentYear = new Date().getUTCFullYear();
  const firstDecade = Math.floor(oldestYear / 10) * 10;
  const lastDecade = Math.floor(currentYear / 10) * 10;

  const insertedDecades: number[] = [];
  let inserted = 0;

  /* eslint-disable no-await-in-loop -- sequential by design: fetch one decade/station at a time */
  for (let decade = firstDecade; decade <= lastDecade; decade += 10) {
    for (const code of STATION_CODES) {
      const readings = await fetchHistoricalStationReadings(code, decade);
      if (hasClimateData(readings)) {
        db.upsertWeatherReadings(readings);
        inserted += readings.length;
        insertedDecades.push(decade);
        break;
      }
    }
  }
  /* eslint-enable no-await-in-loop */

  const recentInserted = await syncWeatherRecent();
  inserted += recentInserted;

  return { inserted, years: insertedDecades };
}

/**
 * Lightweight sync: fetches only the recent ~2-month window + live reading.
 * Called hourly to fill gaps caused by server downtime or network errors.
 * Returns the number of rows upserted.
 */
export async function syncWeatherRecent(): Promise<number> {
  let inserted = 0;

  /* eslint-disable no-await-in-loop -- tries stations sequentially */
  for (const code of STATION_CODES) {
    const readings = await fetchRecentStationReadings(code);
    if (hasClimateData(readings)) {
      db.upsertWeatherReadings(readings);
      inserted += readings.length;
      break;
    }
  }
  /* eslint-enable no-await-in-loop */

  const live = await fetchStationReadings();
  if (live.length > 0) {
    db.upsertWeatherReadings(live);
    inserted += live.length;
  }

  return inserted;
}
