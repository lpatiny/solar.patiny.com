/* eslint-disable camelcase -- TypeBox schema keys match JSON API snake_case */
import { Type } from 'typebox';

import { collectEnergyFlow } from '../services/energyFlow.ts';
import type { FastifyTyped } from '../types.ts';

const W = Type.Number({ description: 'Power in watts (never negative).' });

const EnergyFlowResponse = Type.Object({
  timestamp: Type.Number(),
  is_stale: Type.Boolean(),
  // The four displayed quantities.
  production_w: W,
  consumption_w: W,
  grid_import_w: W,
  grid_export_w: W,
  battery_stored_wh: Type.Number({
    description:
      'Usable energy stored across every pack: the reserve floor is already ' +
      'taken out, so a fleet sitting on its floors reads 0.',
  }),
  battery_capacity_wh: Type.Number({
    description: 'Usable capacity across every pack, above the reserve floors.',
  }),
  battery_soc_pct: Type.Number({
    description: 'Usable charge: 0 % is the reserve floor, 100 % is full.',
  }),
  battery_charge_w: W,
  battery_discharge_w: W,
  // The six links between them.
  solar_to_home_w: W,
  solar_to_battery_w: W,
  solar_to_grid_w: W,
  battery_to_home_w: W,
  battery_to_grid_w: W,
  grid_to_home_w: W,
  grid_to_battery_w: W,
});

const ErrorResponse = Type.Object({ error: Type.String() });

/**
 * Live energy balance split into the four displayed quantities (solar
 * production, stored battery energy, household consumption, grid import) and the
 * directed flows between them.
 * @param fastify
 */
export default async function energyFlowRoutes(fastify: FastifyTyped) {
  fastify.get(
    '/api/energy-flow',
    {
      schema: {
        tags: ['realtime'],
        summary: 'Live energy levels and the directed flows between them.',
        description:
          'Splits the live power balance into source → sink flows in ' +
          'self-consumption order: solar serves the house first, then charges ' +
          'the battery, and only the leftover is exported.',
        response: { 200: EnergyFlowResponse, 503: ErrorResponse },
      },
    },
    async (_request, reply) => {
      const payload = collectEnergyFlow();
      if (!payload) {
        return reply
          .code(503)
          .send({ error: 'No data yet — check Fronius connectivity' });
      }
      return payload;
    },
  );
}
