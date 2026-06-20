/* eslint-disable @typescript-eslint/naming-convention -- API and DB fields use snake_case */
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';

export type FastifyTyped = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  FastifyBaseLogger,
  TypeBoxTypeProvider
>;

export interface RealtimeReading {
  timestamp: number;
  production_w: number;
  grid_w: number;
  battery_w: number;
  /** True household load: the Fronius residual plus the Marstek net (see marstek_net_w). */
  consumption_w: number;
  battery_soc: number;
  grid_injection_w: number;
  /**
   * Net Marstek AC power folded into consumption_w (discharge positive, charge
   * negative). null when no Marstek device reports. Raw Fronius load =
   * consumption_w − marstek_net_w.
   */
  marstek_net_w: number | null;
  is_stale: boolean;
  // Modbus connection state
  modbus_status: 'disabled' | 'ok' | 'error';
  modbus_error: string | null;
  // Modbus-enhanced fields (null when Modbus not enabled/reachable)
  ac_power_w: number | null;
  voltage_a_v: number | null;
  voltage_b_v: number | null;
  voltage_c_v: number | null;
  frequency_hz: number | null;
  pv1_power_w: number | null;
  pv2_power_w: number | null;
  battery_charging_w: number | null;
  battery_discharging_w: number | null;
  meter_power_w: number | null;
}
