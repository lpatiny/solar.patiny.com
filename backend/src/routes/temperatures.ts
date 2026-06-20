/* eslint-disable camelcase -- TypeBox schema keys match JSON API snake_case */
import { Type } from 'typebox';

import { db } from '../db/Database.ts';
import { getTemperatures } from '../services/dirigeraService.ts';
import type { FastifyTyped } from '../types.ts';

const N = Type.Union([Type.Number(), Type.Null()]); // nullable number shorthand

const TemperaturesResponse = Type.Object({
  timestamp: Type.Number(),
  is_stale: Type.Boolean(),
  configured: Type.Boolean(),
  sensors: Type.Array(
    Type.Object({
      id: Type.String(),
      name: Type.String(),
      temperature_c: Type.Number(),
      humidity_pct: N,
      co2_ppm: N,
      pm25_ugm3: N,
    }),
  ),
  unavailable_sensors: Type.Array(
    Type.Object({ id: Type.String(), name: Type.String() }),
  ),
});

const TemperatureResolution = Type.Union([
  Type.Literal('raw'),
  Type.Literal('hourly'),
  Type.Literal('daily'),
  Type.Literal('monthly'),
]);

const TemperatureHistoryResponse = Type.Object({
  sensors: Type.Array(Type.Object({ id: Type.String(), name: Type.String() })),
  readings: Type.Array(
    Type.Object({
      timestamp: Type.Number(),
      sensor_id: Type.String(),
      temperature_c: Type.Number(),
      humidity_pct: N,
      co2_ppm: N,
      pm25_ugm3: N,
    }),
  ),
});

/**
 * Temperature sensors read from the IKEA DIRIGERA hub (served from memory cache),
 * plus a history endpoint backed by the SQLite time-series.
 * @param fastify
 */
export default async function temperaturesRoutes(fastify: FastifyTyped) {
  fastify.get(
    '/api/temperatures',
    { schema: { response: { 200: TemperaturesResponse } } },
    () => getTemperatures(),
  );

  fastify.get(
    '/api/temperatures/history',
    {
      schema: {
        querystring: Type.Object({
          from: Type.Number(),
          to: Type.Number(),
          resolution: Type.Optional(TemperatureResolution),
        }),
        response: { 200: TemperatureHistoryResponse },
      },
    },
    (request) => {
      const { from, to, resolution = 'raw' } = request.query;
      const readings =
        resolution === 'hourly'
          ? db.queryTemperatureReadingsHourly(from, to)
          : resolution === 'daily'
            ? db.queryTemperatureReadingsDaily(from, to)
            : resolution === 'monthly'
              ? db.queryTemperatureReadingsMonthly(from, to)
              : db.queryTemperatureReadingsRaw(from, to);
      return { sensors: db.listTemperatureSensors(), readings };
    },
  );
}
