/* eslint-disable camelcase -- battery fields use snake_case */
import { expect, test } from 'vitest';

import type { RegisterMap } from '../marstekRegisters.ts';
import {
  decodeBatteryValues,
  decodeControlParams,
} from '../marstekRegisters.ts';

// Raw register values captured from the live Marstek Venus E 3.0.
const liveRegisters: RegisterMap = {
  32100: 5354,
  32101: 13,
  32102: 0,
  32103: 0,
  32104: 53,
  32105: 5120,
  32200: 2329,
  32201: 2329,
  32202: 65535,
  32203: 64739,
  33000: 0,
  33001: 1573,
  33002: 0,
  33003: 1222,
  33004: 0,
  33005: 0,
  33006: 0,
  33007: 0,
  35000: 271,
  35001: 275,
  35100: 2,
  35110: 576,
  35111: 1000,
  35112: 1000,
  43000: 0,
};

test('decodeBatteryValues scales registers to physical units', () => {
  expect(decodeBatteryValues(liveRegisters)).toStrictEqual({
    voltage_v: 53.54,
    current_a: 0.13,
    power_w: 0,
    soc_pct: 53,
    energy_kwh: 5.12,
    ac_power_w: -797, // int32 across 32202/32203; verified negative = charging
    total_charge_kwh: 15.73,
    total_discharge_kwh: 12.22,
    daily_charge_kwh: 0,
    daily_discharge_kwh: 0,
    internal_temp_c: 27.1,
    mos_temp_c: 27.5,
    inverter_state: 2,
  });
});

test('missing register blocks decode to null', () => {
  expect(decodeBatteryValues({})).toStrictEqual({
    voltage_v: null,
    current_a: null,
    power_w: null,
    soc_pct: null,
    energy_kwh: null,
    ac_power_w: null,
    total_charge_kwh: null,
    total_discharge_kwh: null,
    daily_charge_kwh: null,
    daily_discharge_kwh: null,
    internal_temp_c: null,
    mos_temp_c: null,
    inverter_state: null,
  });
});

test('negative battery current decodes as a signed value', () => {
  // 65486 = -50 as int16 → -0.5 A
  expect(decodeBatteryValues({ 32101: 65_486 }).current_a).toBe(-0.5);
});

test('decodeControlParams exposes the controllable parameters with current values', () => {
  const params = decodeControlParams(liveRegisters);
  const byKey = new Map(params.map((p) => [p.key, p]));

  expect(byKey.get('forceMode')?.options).toHaveLength(3);
  expect(byKey.get('chargeToSoc')?.value).toBe(53);
  expect(byKey.get('chargeCurrentLimit')?.value).toBe(100); // 1000 * 0.1 A
  expect(byKey.get('userWorkMode')?.value).toBe(0);
});
