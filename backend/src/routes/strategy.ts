/* eslint-disable camelcase -- TypeBox schema keys match JSON API snake_case */
import { Type } from 'typebox';

import { requireAuth } from '../auth.ts';
import { getStrategyStatus } from '../services/batteryStrategy.ts';
import {
  MAX_CHARGE_POWER_W,
  MAX_DISCHARGE_POWER_W,
} from '../services/marstekRegisters.ts';
import {
  readStrategyConfig,
  writeStrategyConfig,
} from '../services/strategyConfig.ts';
import type { FastifyTyped } from '../types.ts';

const ModeSchema = Type.Union([
  Type.Literal('off'),
  Type.Literal('auto'),
  Type.Literal('manual'),
]);

const DischargeModeSchema = Type.Union([
  Type.Literal('cover'),
  Type.Literal('force'),
]);

const ConfigPart = Type.Object({
  mode: ModeSchema,
  inject_target_w: Type.Number(),
  charge_max_w: Type.Number(),
  charge_ceiling_pct: Type.Number(),
  discharge_max_w: Type.Number(),
  discharge_mode: DischargeModeSchema,
  discharge_floor_pct: Type.Number(),
  interval_ms: Type.Number(),
});

const DeviceDecision = Type.Object({
  device_id: Type.Number(),
  name: Type.String(),
  soc_pct: Type.Union([Type.Number(), Type.Null()]),
  action: Type.String(),
  power_w: Type.Number(),
  sent: Type.Boolean(),
});

const StatusPart = Type.Object({
  phase: Type.String(),
  timestamp: Type.Number(),
  production_w: Type.Union([Type.Number(), Type.Null()]),
  grid_injection_w: Type.Union([Type.Number(), Type.Null()]),
  devices: Type.Array(DeviceDecision),
  error: Type.Union([Type.String(), Type.Null()]),
});

const StrategyResponse = Type.Object({
  config: ConfigPart,
  status: StatusPart,
});

const UpdateBody = Type.Object({
  mode: Type.Optional(ModeSchema),
  inject_target_w: Type.Optional(Type.Number({ minimum: 0, maximum: 20_000 })),
  charge_max_w: Type.Optional(
    Type.Number({ minimum: 0, maximum: MAX_CHARGE_POWER_W }),
  ),
  charge_ceiling_pct: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
  discharge_max_w: Type.Optional(
    Type.Number({ minimum: 0, maximum: MAX_DISCHARGE_POWER_W }),
  ),
  discharge_mode: Type.Optional(DischargeModeSchema),
  // discharge_floor_pct is read-only here: it mirrors the Marstek battery
  // reserve, edited in the Battery Reserve config section (/api/config).
  interval_ms: Type.Optional(
    Type.Number({ minimum: 10_000, maximum: 600_000 }),
  ),
});

function snapshot() {
  const config = readStrategyConfig();
  const status = getStrategyStatus();
  return {
    config: {
      mode: config.mode,
      inject_target_w: config.injectTargetW,
      charge_max_w: config.chargeMaxW,
      charge_ceiling_pct: config.chargeCeilingPct,
      discharge_max_w: config.dischargeMaxW,
      discharge_mode: config.dischargeMode,
      discharge_floor_pct: config.dischargeFloorPct,
      interval_ms: config.intervalMs,
    },
    status: {
      phase: status.phase,
      timestamp: status.timestamp,
      production_w: status.productionW,
      grid_injection_w: status.gridInjectionW,
      devices: status.devices.map((device) => ({
        device_id: device.deviceId,
        name: device.name,
        soc_pct: device.socPct,
        action: device.action,
        power_w: device.powerW,
        sent: device.sent,
      })),
      error: status.error,
    },
  };
}

/**
 * Strategy configuration and the latest control-cycle status.
 * @param fastify - the typed Fastify instance
 */
export default async function strategyRoutes(fastify: FastifyTyped) {
  fastify.get(
    '/api/strategy',
    {
      schema: {
        tags: ['strategy'],
        summary: 'Marstek strategy config and latest status',
        response: { 200: StrategyResponse },
      },
    },
    () => snapshot(),
  );

  fastify.patch(
    '/api/strategy',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['strategy'],
        summary: 'Update Marstek strategy configuration',
        body: UpdateBody,
        response: { 200: StrategyResponse },
      },
    },
    (request) => {
      const body = request.body;
      writeStrategyConfig({
        mode: body.mode,
        injectTargetW: body.inject_target_w,
        chargeMaxW: body.charge_max_w,
        chargeCeilingPct: body.charge_ceiling_pct,
        dischargeMaxW: body.discharge_max_w,
        dischargeMode: body.discharge_mode,
        intervalMs: body.interval_ms,
      });
      return snapshot();
    },
  );
}
