/* eslint-disable camelcase -- TypeBox schema keys match JSON API snake_case */
import { Type } from 'typebox';

import {
  getCurrentBatteryControl,
  getModbusEnabled,
  setBatteryControl,
} from '../services/modbus.ts';
import { getCurrentReading } from '../services/poller.ts';
import type { FastifyTyped } from '../types.ts';

const BatteryResponse = Type.Object({
  soc: Type.Number(),
  power_w: Type.Number(),
  mode: Type.String(),
  charge_rate_percent: Type.Number(),
  capacity_wh: Type.Number(),
  modbus_enabled: Type.Boolean(),
});

const BatteryControlBody = Type.Object({
  mode: Type.Union([
    Type.Literal('auto'),
    Type.Literal('charge'),
    Type.Literal('discharge'),
    Type.Literal('idle'),
  ]),
  ratePercent: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
});

/**
 * Battery status and control routes.
 * @param fastify
 */
export default async function batteryRoutes(fastify: FastifyTyped) {
  fastify.get(
    '/api/battery',
    { schema: { response: { 200: BatteryResponse } } },
    async () => {
      const reading = getCurrentReading();
      const { mode, ratePercent } = getCurrentBatteryControl();
      return {
        soc: reading?.battery_soc ?? 0,
        power_w: reading?.battery_w ?? 0,
        mode,
        charge_rate_percent: ratePercent,
        capacity_wh: 11_000,
        modbus_enabled: getModbusEnabled(),
      };
    },
  );

  fastify.post(
    '/api/battery/control',
    { schema: { body: BatteryControlBody } },
    async (request, reply) => {
      const { mode, ratePercent = 100 } = request.body;
      try {
        await setBatteryControl(mode, ratePercent);
        return { ok: true, mode, ratePercent };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.code(501).send({ error: message });
      }
    },
  );
}
