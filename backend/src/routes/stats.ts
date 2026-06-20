/* eslint-disable camelcase -- TypeBox schema keys match JSON API snake_case */
import { Type } from 'typebox';

import { db } from '../db/Database.ts';
import type { AggregatedStatsRow } from '../db/rows.ts';
import type { FastifyTyped } from '../types.ts';

const AggregatedStatsItem = Type.Object({
  period: Type.String(),
  production_kwh: Type.Number(),
  export_kwh: Type.Number(),
  import_kwh: Type.Number(),
  self_consumption_kwh: Type.Number(),
  battery_charge_kwh: Type.Number(),
});

const StatsQuery = Type.Object({
  resolution: Type.Optional(
    Type.Union([
      Type.Literal('day'),
      Type.Literal('month'),
      Type.Literal('year'),
    ]),
  ),
  from: Type.Optional(Type.String({ description: 'ISO date YYYY-MM-DD' })),
  to: Type.Optional(Type.String({ description: 'ISO date YYYY-MM-DD' })),
});

// Energy = Σ power × actual seconds-to-next-sample / 3 600 000 (W·s per kWh).
// Deriving the duration from real timestamps (rather than assuming a fixed 5-min
// cadence) keeps a partial or irregularly-sampled day from being mis-scaled; the
// gap to the next sample is clamped so a long outage cannot overcount.
const WS_PER_KWH = 3_600_000;
const NOMINAL_SLOT_S = 300; // assumed duration of the last sample in the range
const MAX_SLOT_S = 600; // cap a gap so missing samples contribute at most this

function energySql(periodExpr: string): string {
  return `
    SELECT
      ${periodExpr} AS period,
      SUM(production_w * dt_s)       / ${WS_PER_KWH} AS production_kwh,
      SUM(export_w * dt_s)           / ${WS_PER_KWH} AS export_kwh,
      SUM(import_w * dt_s)           / ${WS_PER_KWH} AS import_kwh,
      SUM(self_consumption_w * dt_s) / ${WS_PER_KWH} AS self_consumption_kwh,
      SUM(battery_w * dt_s)          / ${WS_PER_KWH} AS battery_charge_kwh
    FROM (
      SELECT
        timestamp, production_w, export_w, import_w, self_consumption_w, battery_w,
        MIN(
          MAX(
            COALESCE(LEAD(timestamp) OVER (ORDER BY timestamp) - timestamp, ${NOMINAL_SLOT_S}),
            0
          ),
          ${MAX_SLOT_S}
        ) AS dt_s
      FROM solarweb_readings
      WHERE timestamp BETWEEN ? AND ?
    )
    GROUP BY period
    ORDER BY period`;
}

const DAILY_SQL = energySql("strftime('%Y-%m-%d', timestamp, 'unixepoch')");
const MONTHLY_SQL = energySql("strftime('%Y-%m', timestamp, 'unixepoch')");
const YEARLY_SQL = energySql("strftime('%Y', timestamp, 'unixepoch')");

function dateToTs(date: string, endOfDay = false): number {
  return Math.floor(
    new Date(`${date}T${endOfDay ? '23:59:59' : '00:00:00'}Z`).getTime() / 1000,
  );
}

/**
 * Energy statistics (kWh) aggregated by day, month, or year from SolarWeb 5-min data.
 * @param fastify
 */
export default async function statsRoutes(fastify: FastifyTyped) {
  fastify.get(
    '/api/stats',
    {
      schema: {
        querystring: StatsQuery,
        response: { 200: Type.Array(AggregatedStatsItem) },
      },
    },
    async (request) => {
      const resolution = request.query.resolution ?? 'day';
      const from = request.query.from ?? '2000-01-01';
      const to = request.query.to ?? new Date().toISOString().slice(0, 10);
      const fromTs = dateToTs(from);
      const toTs = dateToTs(to, true);

      const sql =
        resolution === 'month'
          ? MONTHLY_SQL
          : resolution === 'year'
            ? YEARLY_SQL
            : DAILY_SQL;

      return db.statement<AggregatedStatsRow>(sql).all(fromTs, toTs);
    },
  );
}
