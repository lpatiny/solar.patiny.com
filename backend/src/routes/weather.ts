/* eslint-disable camelcase -- DB fields use snake_case */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';

import { db } from '../db/Database.ts';
import {
  STATION_CODES,
  fetchHistoricalStationReadings,
  fetchStationReadings,
} from '../services/meteoStationService.ts';

const WeatherReadingSchema = Type.Object({
  timestamp: Type.Number(),
  station: Type.String(),
  global_radiation_w: Type.Union([Type.Number(), Type.Null()]),
  temperature_c: Type.Union([Type.Number(), Type.Null()]),
  humidity_pct: Type.Union([Type.Number(), Type.Null()]),
  precipitation_mm: Type.Union([Type.Number(), Type.Null()]),
  sunshine_min: Type.Union([Type.Number(), Type.Null()]),
});

async function syncWeatherHistory(): Promise<{
  inserted: number;
  years: number[];
}> {
  const oldestTs = db.getOldestSolarwebTimestamp();
  if (oldestTs === null) return { inserted: 0, years: [] };

  const oldestYear = new Date(oldestTs * 1000).getUTCFullYear();
  const currentYear = new Date().getUTCFullYear();
  const years: number[] = [];
  let inserted = 0;

  /* eslint-disable no-await-in-loop -- sequential by design: fetch one year at a time to avoid hammering MeteoSwiss */
  for (let year = oldestYear; year <= currentYear; year++) {
    for (const code of STATION_CODES) {
      const readings = await fetchHistoricalStationReadings(code, year);
      if (readings.length > 0) {
        db.upsertWeatherReadings(readings);
        inserted += readings.length;
        years.push(year);
        break;
      }
    }
  }
  /* eslint-enable no-await-in-loop */

  // Also fetch the most recent data (last ~2 days) from the live endpoint
  const recent = await fetchStationReadings();
  if (recent.length > 0) {
    db.upsertWeatherReadings(recent);
    inserted += recent.length;
  }

  return { inserted, years };
}

const weatherRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/api/weather',
    {
      schema: {
        querystring: Type.Object({
          from: Type.Number(),
          to: Type.Number(),
        }),
        response: {
          200: Type.Array(WeatherReadingSchema),
        },
      },
    },
    async (request) => {
      const { from, to } = request.query;
      return db.queryWeatherReadings(from, to);
    },
  );

  fastify.post(
    '/api/weather/sync',
    {
      schema: {
        response: {
          200: Type.Object({
            inserted: Type.Number(),
            years: Type.Array(Type.Number()),
          }),
        },
      },
    },
    async () => {
      return syncWeatherHistory();
    },
  );
};

export default weatherRoutes;
