/* eslint-disable camelcase -- TypeBox schema keys match JSON API snake_case */
import { Type } from 'typebox';

import { getStrategyDebug } from '../services/strategyDebug.ts';
import type { FastifyTyped } from '../types.ts';

const NullableNumber = Type.Union([Type.Number(), Type.Null()]);

const ReadingSchema = Type.Object({
  present: Type.Boolean(),
  is_stale: Type.Boolean(),
  production_w: NullableNumber,
  consumption_w: NullableNumber,
  grid_w: NullableNumber,
  grid_injection_w: NullableNumber,
  import_w: NullableNumber,
  byd_battery_w: NullableNumber,
  marstek_net_w: NullableNumber,
});

const DeviceSchema = Type.Object({
  id: Type.Number(),
  name: Type.String(),
  host: Type.String(),
  port: Type.Number(),
  ac_power_w: NullableNumber,
  raw_soc_pct: NullableNumber,
  values_at: Type.Number(),
  age_ms: NullableNumber,
  fresh: Type.Boolean(),
  used_soc_pct: NullableNumber,
  used_charging_w: Type.Number(),
  used_discharging_w: Type.Number(),
  poll_error: Type.Union([Type.String(), Type.Null()]),
});

const DiagnosticsSchema = Type.Object({
  total_charging_w: Type.Number(),
  total_discharging_w: Type.Number(),
  surplus_w: Type.Number(),
  charge_eligible_count: Type.Number(),
  charge_cap_w: Type.Number(),
  desired_charge_w: Type.Number(),
  per_charge_w: Type.Number(),
  grid_balance_excluding_marstek_w: Type.Number(),
  discharge_target_w: Type.Number(),
  discharge_eligible_count: Type.Number(),
  discharge_cap_w: Type.Number(),
  desired_discharge_w: Type.Number(),
  per_discharge_w: Type.Number(),
});

const DecisionSchema = Type.Object({
  device_id: Type.Number(),
  name: Type.String(),
  soc_pct: NullableNumber,
  action: Type.String(),
  power_w: Type.Number(),
});

const LastCommandSchema = Type.Object({
  device_id: Type.Number(),
  action: Type.String(),
  power_w: Type.Number(),
  sent_at: Type.Number(),
  age_ms: Type.Number(),
});

const DebugResponse = Type.Object({
  now: Type.Number(),
  mode: Type.String(),
  config: Type.Object({
    mode: Type.String(),
    inject_target_w: Type.Number(),
    charge_max_w: Type.Number(),
    charge_ceiling_pct: Type.Number(),
    discharge_max_w: Type.Number(),
    discharge_mode: Type.String(),
    discharge_floor_pct: Type.Number(),
    interval_ms: Type.Number(),
  }),
  reading: ReadingSchema,
  devices: Type.Array(DeviceSchema),
  phase: Type.Union([Type.String(), Type.Null()]),
  decisions: Type.Array(DecisionSchema),
  diagnostics: Type.Union([DiagnosticsSchema, Type.Null()]),
  last_commands: Type.Array(LastCommandSchema),
  notes: Type.Array(Type.String()),
});

/**
 * Live, apply-nothing diagnosis of the Marstek control decision: every input the
 * loop reads (config, inverter reading, per-device telemetry with freshness), the
 * decision math (surplus, targets, caps, per-battery setpoints), the resulting
 * phase and per-device actions, the last commands actually confirmed-sent, and
 * plain-language notes on why the fleet is or is not charging. Use this to find
 * out why a battery is not charging without touching the hardware.
 * @param fastify - the typed Fastify instance
 */
export default async function debugStrategyRoutes(fastify: FastifyTyped) {
  fastify.get(
    '/api/debug/strategy',
    {
      schema: {
        tags: ['debug'],
        summary: 'Live diagnosis of the Marstek charge/discharge decision',
        response: { 200: DebugResponse },
      },
    },
    () => {
      const {
        now,
        mode,
        config,
        reading,
        devices,
        phase,
        decisions,
        diagnostics,
        lastCommands,
        notes,
      } = getStrategyDebug();
      return {
        now,
        mode,
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
        reading: {
          present: reading.present,
          is_stale: reading.isStale,
          production_w: reading.productionW,
          consumption_w: reading.consumptionW,
          grid_w: reading.gridW,
          grid_injection_w: reading.gridInjectionW,
          import_w: reading.importW,
          byd_battery_w: reading.bydBatteryW,
          marstek_net_w: reading.marstekNetW,
        },
        devices: devices.map((d) => ({
          id: d.id,
          name: d.name,
          host: d.host,
          port: d.port,
          ac_power_w: d.acPowerW,
          raw_soc_pct: d.rawSocPct,
          values_at: d.valuesAt,
          age_ms: d.ageMs,
          fresh: d.fresh,
          used_soc_pct: d.usedSocPct,
          used_charging_w: d.usedChargingW,
          used_discharging_w: d.usedDischargingW,
          poll_error: d.pollError,
        })),
        phase,
        decisions: decisions.map((decision) => ({
          device_id: decision.deviceId,
          name: decision.name,
          soc_pct: decision.socPct,
          action: decision.action,
          power_w: decision.powerW,
        })),
        diagnostics: diagnostics
          ? {
              total_charging_w: diagnostics.totalChargingW,
              total_discharging_w: diagnostics.totalDischargingW,
              surplus_w: diagnostics.surplusW,
              charge_eligible_count: diagnostics.chargeEligibleCount,
              charge_cap_w: diagnostics.chargeCapW,
              desired_charge_w: diagnostics.desiredChargeW,
              per_charge_w: diagnostics.perChargeW,
              grid_balance_excluding_marstek_w:
                diagnostics.gridBalanceExcludingMarstekW,
              discharge_target_w: diagnostics.dischargeTargetW,
              discharge_eligible_count: diagnostics.dischargeEligibleCount,
              discharge_cap_w: diagnostics.dischargeCapW,
              desired_discharge_w: diagnostics.desiredDischargeW,
              per_discharge_w: diagnostics.perDischargeW,
            }
          : null,
        last_commands: lastCommands.map((command) => ({
          device_id: command.deviceId,
          action: command.action,
          power_w: command.powerW,
          sent_at: command.sentAt,
          age_ms: command.ageMs,
        })),
        notes,
      };
    },
  );
}
