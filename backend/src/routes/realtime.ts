/* eslint-disable camelcase -- TypeBox schema keys match JSON API snake_case */
import { Type } from '@sinclair/typebox';

import { getCurrentReading } from '../services/poller.ts';
import type { FastifyTyped } from '../types.ts';

const N = Type.Union([Type.Number(), Type.Null()]); // nullable number shorthand

const RealtimeResponse = Type.Object({
  timestamp: Type.Number(),
  // From Fronius REST API
  production_w: Type.Number(),
  grid_w: Type.Number(),
  battery_w: Type.Number(),
  consumption_w: Type.Number(),
  battery_soc: Type.Number(),
  grid_injection_w: Type.Number(),
  is_stale: Type.Boolean(),
  // Modbus connection state
  modbus_status: Type.Union([
    Type.Literal('disabled'),
    Type.Literal('ok'),
    Type.Literal('error'),
  ]),
  modbus_error: Type.Union([Type.String(), Type.Null()]),
  // From Modbus (null when Modbus not enabled or failing)
  ac_power_w: N,
  voltage_a_v: N,
  voltage_b_v: N,
  voltage_c_v: N,
  frequency_hz: N,
  pv1_power_w: N,
  pv2_power_w: N,
  battery_charging_w: N,
  battery_discharging_w: N,
  meter_power_w: N,
});

const ErrorResponse = Type.Object({ error: Type.String() });

/**
 * Real-time power flow from the Fronius inverter (served from memory cache).
 */
export default async function realtimeRoutes(fastify: FastifyTyped) {
  fastify.get(
    '/api/realtime',
    {
      schema: {
        response: { 200: RealtimeResponse, 503: ErrorResponse },
      },
    },
    async (_request, reply) => {
      const reading = getCurrentReading();
      if (!reading) {
        return reply
          .code(503)
          .send({ error: 'No data yet — check Fronius connectivity' });
      }
      return reading;
    },
  );
}
