/* eslint-disable camelcase -- DB fields use snake_case */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';

import { db } from '../db/Database.ts';
import { syncWeatherHistory } from '../services/weatherSyncService.ts';

const WeatherReadingSchema = Type.Object({
  timestamp: Type.Number(),
  station: Type.String(),
  global_radiation_w: Type.Union([Type.Number(), Type.Null()]),
  global_radiation_w_max: Type.Optional(
    Type.Union([Type.Number(), Type.Null()]),
  ),
  temperature_c: Type.Union([Type.Number(), Type.Null()]),
  humidity_pct: Type.Union([Type.Number(), Type.Null()]),
  precipitation_mm: Type.Union([Type.Number(), Type.Null()]),
  sunshine_min: Type.Union([Type.Number(), Type.Null()]),
});

const WeatherResolutionSchema = Type.Union([
  Type.Literal('raw'),
  Type.Literal('hourly'),
  Type.Literal('daily'),
]);

const weatherRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/api/weather',
    {
      schema: {
        querystring: Type.Object({
          from: Type.Number(),
          to: Type.Number(),
          resolution: Type.Optional(WeatherResolutionSchema),
        }),
        response: {
          200: Type.Array(WeatherReadingSchema),
        },
      },
    },
    async (request) => {
      const { from, to, resolution = 'raw' } = request.query;
      if (resolution === 'hourly') return db.queryWeatherHourly(from, to);
      if (resolution === 'daily') return db.queryWeatherDaily(from, to);
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
