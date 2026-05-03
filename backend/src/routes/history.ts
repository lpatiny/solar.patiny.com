/* eslint-disable camelcase -- TypeBox schema keys match JSON API snake_case */
import { Type } from '@sinclair/typebox';

import { db } from '../db/Database.ts';
import type { FastifyTyped } from '../types.ts';

const HistoryPoint = Type.Object({
  timestamp: Type.Number(),
  production_w: Type.Number(),
  grid_w: Type.Number(),
  battery_w: Type.Number(),
  consumption_w: Type.Number(),
  battery_soc: Type.Number(),
});

const HistoryQuery = Type.Object({
  from: Type.Optional(Type.Number()),
  to: Type.Optional(Type.Number()),
  resolution: Type.Optional(
    Type.Union([
      Type.Literal('raw'),
      Type.Literal('hourly'),
      Type.Literal('daily'),
    ]),
  ),
});

/**
 * Historical power readings with configurable time range and resolution.
 */
export default async function historyRoutes(fastify: FastifyTyped) {
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
        return db.queryReadingsHourly(from, to).map((r) => ({
          timestamp: r.bucket,
          production_w: r.production_w,
          grid_w: r.grid_w,
          battery_w: r.battery_w,
          consumption_w: r.consumption_w,
          battery_soc: r.battery_soc,
        }));
      }

      if (resolution === 'daily') {
        return db.queryReadingsDaily(from, to).map((r) => ({
          timestamp: r.bucket,
          production_w: r.production_w,
          grid_w: r.grid_w,
          battery_w: r.battery_w,
          consumption_w: r.consumption_w,
          battery_soc: r.battery_soc,
        }));
      }

      return db.queryReadingsRaw(from, to);
    },
  );
}
