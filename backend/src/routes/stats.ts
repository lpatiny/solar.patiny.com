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

// Each 5-min point represents 1/12 of an hour → divide watt-sum by 12 000 for kWh.
const KWH_DIVISOR = 12_000;

const DAILY_SQL = `
  SELECT
    strftime('%Y-%m-%d', timestamp, 'unixepoch') AS period,
    SUM(production_w)      / ${KWH_DIVISOR} AS production_kwh,
    SUM(export_w)          / ${KWH_DIVISOR} AS export_kwh,
    SUM(import_w)          / ${KWH_DIVISOR} AS import_kwh,
    SUM(self_consumption_w)/ ${KWH_DIVISOR} AS self_consumption_kwh,
    SUM(battery_w)         / ${KWH_DIVISOR} AS battery_charge_kwh
  FROM solarweb_readings
  WHERE timestamp BETWEEN ? AND ?
  GROUP BY period
  ORDER BY period`;

const MONTHLY_SQL = `
  SELECT
    strftime('%Y-%m', timestamp, 'unixepoch') AS period,
    SUM(production_w)      / ${KWH_DIVISOR} AS production_kwh,
    SUM(export_w)          / ${KWH_DIVISOR} AS export_kwh,
    SUM(import_w)          / ${KWH_DIVISOR} AS import_kwh,
    SUM(self_consumption_w)/ ${KWH_DIVISOR} AS self_consumption_kwh,
    SUM(battery_w)         / ${KWH_DIVISOR} AS battery_charge_kwh
  FROM solarweb_readings
  WHERE timestamp BETWEEN ? AND ?
  GROUP BY period
  ORDER BY period`;

const YEARLY_SQL = `
  SELECT
    strftime('%Y', timestamp, 'unixepoch') AS period,
    SUM(production_w)      / ${KWH_DIVISOR} AS production_kwh,
    SUM(export_w)          / ${KWH_DIVISOR} AS export_kwh,
    SUM(import_w)          / ${KWH_DIVISOR} AS import_kwh,
    SUM(self_consumption_w)/ ${KWH_DIVISOR} AS self_consumption_kwh,
    SUM(battery_w)         / ${KWH_DIVISOR} AS battery_charge_kwh
  FROM solarweb_readings
  WHERE timestamp BETWEEN ? AND ?
  GROUP BY period
  ORDER BY period`;

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
