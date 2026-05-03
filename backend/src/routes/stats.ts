/* eslint-disable camelcase -- TypeBox schema keys match JSON API snake_case */
import { Type } from '@sinclair/typebox';

import { db } from '../db/Database.ts';
import type { FastifyTyped } from '../types.ts';

const DailyStatsItem = Type.Object({
  date: Type.String(),
  production_kwh: Type.Number(),
  export_kwh: Type.Number(),
  import_kwh: Type.Number(),
  self_consumption_kwh: Type.Number(),
});

const StatsQuery = Type.Object({
  from: Type.Optional(Type.String({ description: 'ISO date YYYY-MM-DD' })),
  to: Type.Optional(Type.String({ description: 'ISO date YYYY-MM-DD' })),
});

/**
 * Daily energy statistics (kWh), sourced from SolarWeb cloud sync.
 */
export default async function statsRoutes(fastify: FastifyTyped) {
  fastify.get(
    '/api/stats',
    {
      schema: {
        querystring: StatsQuery,
        response: { 200: Type.Array(DailyStatsItem) },
      },
    },
    async (request) => {
      const today = new Date().toISOString().slice(0, 10);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000)
        .toISOString()
        .slice(0, 10);

      const from = request.query.from ?? thirtyDaysAgo;
      const to = request.query.to ?? today;

      return db.queryDailyStats(from, to);
    },
  );
}
