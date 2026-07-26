/* eslint-disable camelcase -- TypeBox schema keys match JSON API snake_case */
import { Type } from 'typebox';

import {
  collectCompactEnergyFlow,
  collectEnergyFlow,
} from '../services/energyFlow.ts';
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
  byd_stored_wh: Type.Number({
    description: "The BYD pack's share of battery_stored_wh.",
  }),
  byd_capacity_wh: Type.Number({
    description: "The BYD pack's share of battery_capacity_wh.",
  }),
  marstek_stored_wh: Type.Number({
    description: "The Marstek fleet's share of battery_stored_wh.",
  }),
  marstek_capacity_wh: Type.Number({
    description: "The Marstek fleet's share of battery_capacity_wh.",
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

const CompactResponse = Type.Object(
  {
    pv: Type.Number({ description: 'Solar production (W).' }),
    ba: Type.Number({ description: 'Usable stored energy (Wh).' }),
    bd: Type.Number({ description: "The BYD pack's share of ba (Wh)." }),
    mk: Type.Number({ description: "The Marstek fleet's share of ba (Wh)." }),
    bc: Type.Number({ description: 'Usable capacity (Wh) across every pack.' }),
    gr: Type.Number({ description: 'Grid magnitude (W), either direction.' }),
    co: Type.Number({ description: 'Household consumption (W).' }),
    ph: Type.Number({ description: 'Solar → home (W).' }),
    pb: Type.Number({ description: 'Solar → battery (W).' }),
    pg: Type.Number({ description: 'Solar → grid (W).' }),
    bh: Type.Number({ description: 'Battery → home (W).' }),
    bg: Type.Number({ description: 'Battery → grid (W).' }),
    gh: Type.Number({ description: 'Grid → home (W).' }),
    gb: Type.Number({ description: 'Grid → battery (W).' }),
    st: Type.Number({ description: '1 when the reading is stale, else 0.' }),
  },
  { description: 'Just the values the LED wall draws, ~110 bytes.' },
);

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

  fastify.get(
    '/api/energy-flow/compact',
    {
      schema: {
        tags: ['realtime'],
        summary: 'The LED wall payload: four levels and six links, ~110 bytes.',
        description:
          'The same figures as /api/energy-flow reduced to exactly what the ' +
          'wall draws, under two-letter keys. Built for the ESP32 panel ' +
          '(hackuarium/esp32-c3), which parses it into a fixed-size document.',
        response: { 200: CompactResponse, 503: ErrorResponse },
      },
    },
    async (_request, reply) => {
      const payload = collectCompactEnergyFlow();
      if (!payload) {
        return reply
          .code(503)
          .send({ error: 'No data yet — check Fronius connectivity' });
      }
      return payload;
    },
  );
}
