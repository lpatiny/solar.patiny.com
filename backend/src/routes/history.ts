/* eslint-disable camelcase -- API response fields use snake_case */
import { Type } from 'typebox';

import { db } from '../db/Database.ts';
import type { FastifyTyped } from '../types.ts';

const HistoryPoint = Type.Object({
  timestamp: Type.Number(),
  production_w: Type.Number(),
  grid_w: Type.Number(),
  battery_w: Type.Number(),
  consumption_w: Type.Number(),
  battery_soc_max: Type.Union([Type.Number(), Type.Null()]),
  battery_soc_min: Type.Union([Type.Number(), Type.Null()]),
});

const HistoryQuery = Type.Object({
  from: Type.Optional(Type.Number()),
  to: Type.Optional(Type.Number()),
  resolution: Type.Optional(
    Type.Union([
      Type.Literal('raw'),
      Type.Literal('hourly'),
      Type.Literal('daily'),
      Type.Literal('monthly'),
    ]),
  ),
});

/**
 * Historical power readings with configurable time range and resolution.
 * @param fastify
 */
export default async function historyRoutes(fastify: FastifyTyped) {
  fastify.get(
    '/api/history/range',
    {
      schema: {
        response: {
          200: Type.Object({
            oldest: Type.Union([Type.Number(), Type.Null()]),
            newest: Type.Union([Type.Number(), Type.Null()]),
          }),
        },
      },
    },
    async () => {
      const oldest = db.getOldestTimestamp();
      const newest = oldest === null ? null : Math.floor(Date.now() / 1000);
      return { oldest, newest };
    },
  );

  fastify.get(
    '/api/history',
    {
      schema: {
        querystring: HistoryQuery,
        response: { 200: Type.Array(HistoryPoint) },
      },
    },
    async (request) => {
      const now = Math.floor(Date.now() / 1000);
      const from = request.query.from ?? now - 86_400;
      const to = request.query.to ?? now;
      const resolution = request.query.resolution ?? 'raw';

      if (resolution === 'hourly') {
        return db.querySolarwebHourly(from, to).map((r) => ({
          timestamp: r.bucket,
          production_w: r.production_w,
          grid_w: r.grid_w,
          battery_w: r.battery_w,
          consumption_w: r.consumption_w,
          battery_soc_max: r.battery_soc_max,
          battery_soc_min: null as number | null,
        }));
      }

      if (resolution === 'daily') {
        return db.querySolarwebDaily(from, to).map((r) => ({
          timestamp: r.bucket,
          production_w: r.production_w,
          grid_w: r.grid_w,
          battery_w: r.battery_w,
          consumption_w: r.consumption_w,
          battery_soc_max: r.battery_soc_max,
          battery_soc_min: r.battery_soc_min,
        }));
      }

      if (resolution === 'monthly') {
        return db.querySolarwebMonthly(from, to).map((r) => ({
          timestamp: r.bucket,
          production_w: r.production_w,
          grid_w: r.grid_w,
          battery_w: r.battery_w,
          consumption_w: r.consumption_w,
          battery_soc_max: r.battery_soc_max,
          battery_soc_min: r.battery_soc_min,
        }));
      }

      return db.queryReadingsRaw(from, to).map((r) => ({
        timestamp: r.timestamp,
        production_w: r.production_w,
        grid_w: r.grid_w,
        battery_w: r.battery_w,
        consumption_w: r.consumption_w,
        battery_soc_max: r.battery_soc,
        battery_soc_min: null as number | null,
      }));
    },
  );
}
