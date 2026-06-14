import { expect, test } from 'vitest';

import type { DeviceState } from '../batteryStrategy.ts';
import { decide } from '../batteryStrategy.ts';
import type { StrategyConfig } from '../strategyConfig.ts';

const config: StrategyConfig = {
  mode: 'auto',
  injectTargetW: 500,
  chargeMaxW: 500,
  chargeCeilingPct: 100,
  dischargeMaxW: 400,
  dischargeMode: 'cover',
  dischargeFloorPct: 20,
  intervalMs: 30_000,
};

const forceConfig: StrategyConfig = { ...config, dischargeMode: 'force' };

function devices(...states: Array<Partial<DeviceState>>): DeviceState[] {
  return states.map((state, index) => ({
    id: index + 1,
    name: `battery ${index + 1}`,
    soc: 50,
    chargingW: 0,
    dischargingW: 0,
    ...state,
  }));
}

// --- Charge (solar surplus), priority in both discharge modes ---

test('injection below the charge target keeps both batteries idle', () => {
  const { phase, decisions } = decide(config, devices({}, {}), 400, 0);

  expect(phase).toBe('idle');
  expect(decisions.map((d) => d.action)).toStrictEqual(['stop', 'stop']);
  expect(decisions.map((d) => d.powerW)).toStrictEqual([0, 0]);
});

test('large surplus charges both batteries at the per-battery cap', () => {
  // surplus = injection 2600 - target 500 = 2100, capped at 2*500 = 1000; 500 each.
  const { phase, decisions } = decide(config, devices({}, {}), 2600, 0);

  expect(phase).toBe('charge');
  expect(decisions.map((d) => d.powerW)).toStrictEqual([500, 500]);
});

test('moderate surplus is split so injection settles at the target', () => {
  const { decisions } = decide(config, devices({}, {}), 900, 0);

  expect(decisions.map((d) => d.powerW)).toStrictEqual([200, 200]);
});

test('surplus is reconstructed from injection plus current charging', () => {
  // Both already charging 500 => injection 0 but true surplus 1000; 500-500 split.
  const { decisions } = decide(
    config,
    devices({ chargingW: 500 }, { chargingW: 500 }),
    0,
    0,
  );

  expect(decisions.map((d) => d.powerW)).toStrictEqual([250, 250]);
});

test('a full battery is excluded from charging; the other takes its cap', () => {
  const { decisions } = decide(
    config,
    devices({ soc: 100 }, { soc: 60 }),
    2000,
    0,
  );

  expect(decisions[0]).toMatchObject({ action: 'stop', powerW: 0 });
  expect(decisions[1]).toMatchObject({ action: 'charge', powerW: 500 });
});

test('charge takes priority even in force discharge mode', () => {
  const { phase, decisions } = decide(forceConfig, devices({}, {}), 2600, 0);

  expect(phase).toBe('charge');
  expect(decisions.map((d) => d.powerW)).toStrictEqual([500, 500]);
});

// --- Cover mode: cover the house load, never export ---

test('cover: discharges to cover consumption with a balanced grid', () => {
  // The BYD is covering the house (grid balanced), but the inverter still reports
  // 500 W of consumption; cover the full load, 250 each.
  const { phase, decisions } = decide(
    config,
    devices({ soc: 80 }, { soc: 80 }),
    0,
    0,
    500,
  );

  expect(phase).toBe('discharge');
  expect(decisions.map((d) => d.powerW)).toStrictEqual([250, 250]);
});

test('cover: is capped at the per-battery maximum', () => {
  const { decisions } = decide(
    config,
    devices({ soc: 80 }, { soc: 80 }),
    0,
    0,
    2000,
  );

  expect(decisions.map((d) => d.powerW)).toStrictEqual([400, 400]);
});

test('cover: covers the metered load minus solar, ignoring current discharge', () => {
  // The meter reports the true house load directly, so the target must NOT add the
  // Marstek's own discharge (no double-count, no battery-to-battery transfer).
  // Load 639, solar 399 => deficit 240, 120 each — even though the batteries are
  // momentarily discharging far more (242 each).
  const { phase, decisions } = decide(
    config,
    devices({ soc: 80, dischargingW: 242 }, { soc: 80, dischargingW: 242 }),
    0,
    0,
    639,
    399,
  );

  expect(phase).toBe('discharge');
  expect(decisions.map((d) => d.powerW)).toStrictEqual([120, 120]);
});

test('cover: solar covering the whole house leaves the batteries idle', () => {
  // Load 400, solar 600 => no deficit to cover (and no surplus left to charge).
  const { phase } = decide(
    config,
    devices({ soc: 80 }, { soc: 80 }),
    0,
    0,
    400,
    600,
  );

  expect(phase).toBe('idle');
});

test('cover: subtracts PV so only the post-solar deficit is covered', () => {
  // consumption 500, PV 200 => deficit 300, split 150 each (no PV export).
  const { decisions } = decide(
    config,
    devices({ soc: 80 }, { soc: 80 }),
    0,
    0,
    500,
    200,
  );

  expect(decisions.map((d) => d.powerW)).toStrictEqual([150, 150]);
});

test('cover: a battery at or below the floor stops discharging', () => {
  // Only battery 2 (soc 21 > floor 20) is eligible; cap = 1*400.
  const { decisions } = decide(
    config,
    devices({ soc: 20 }, { soc: 21 }),
    0,
    0,
    600,
  );

  expect(decisions[0]).toMatchObject({ action: 'stop', powerW: 0 });
  expect(decisions[1]).toMatchObject({ action: 'discharge', powerW: 400 });
});

test('cover: nothing to cover is idle', () => {
  const { phase } = decide(config, devices({ soc: 80 }, { soc: 80 }), 0, 0, 0);

  expect(phase).toBe('idle');
});

// --- Force mode: discharge at the rate, exporting up to the injection limit ---

test('force: balanced grid discharges up to the injection limit', () => {
  // target = (discharging 0 + import 0 - injection 0) + limit 500 = 500; 250 each.
  const { phase, decisions } = decide(
    forceConfig,
    devices({ soc: 80 }, { soc: 80 }),
    0,
    0,
  );

  expect(phase).toBe('discharge');
  expect(decisions.map((d) => d.powerW)).toStrictEqual([250, 250]);
});

test('force: covers import and exports up to the limit, capped at the rate', () => {
  // target = (0 + import 600 - 0) + 500 = 1100, capped at 2*400 = 800; 400 each.
  const { decisions } = decide(
    forceConfig,
    devices({ soc: 80 }, { soc: 80 }),
    0,
    600,
  );

  expect(decisions.map((d) => d.powerW)).toStrictEqual([400, 400]);
});

test('force: already exporting under the limit tops up to the limit', () => {
  // injection 300 (< limit, no charge); target = (0 + 0 - 300) + 500 = 200; 100 each.
  const { phase, decisions } = decide(
    forceConfig,
    devices({ soc: 80 }, { soc: 80 }),
    300,
    0,
  );

  expect(phase).toBe('discharge');
  expect(decisions.map((d) => d.powerW)).toStrictEqual([100, 100]);
});

test('force: holds steady at the injection limit (stable fixed point)', () => {
  // Already discharging 250 each (500) and exporting exactly the 500 limit:
  // target = (500 + 0 - 500) + 500 = 500; stays 250 each.
  const { decisions } = decide(
    forceConfig,
    devices({ soc: 80, dischargingW: 250 }, { soc: 80, dischargingW: 250 }),
    500,
    0,
  );

  expect(decisions.map((d) => d.powerW)).toStrictEqual([250, 250]);
});

test('force: is capped at the per-battery rate', () => {
  const { decisions } = decide(
    forceConfig,
    devices({ soc: 80 }, { soc: 80 }),
    0,
    2000,
  );

  expect(decisions.map((d) => d.powerW)).toStrictEqual([400, 400]);
});

test('force: a battery at or below the floor stops discharging', () => {
  const { decisions } = decide(
    forceConfig,
    devices({ soc: 20 }, { soc: 21 }),
    0,
    600,
  );

  expect(decisions[0]).toMatchObject({ action: 'stop', powerW: 0 });
  expect(decisions[1]).toMatchObject({ action: 'discharge', powerW: 400 });
});

// --- Fail safe ---

test('unknown SOC stops charging and stops discharging', () => {
  const charging = decide(config, devices({ soc: null }), 3000, 0);

  expect(charging.decisions[0]).toMatchObject({ action: 'stop' });

  const covering = decide(config, devices({ soc: null }), 0, 0, 600);

  expect(covering.decisions[0]).toMatchObject({ action: 'stop' });

  const forcing = decide(forceConfig, devices({ soc: null }), 0, 600);

  expect(forcing.decisions[0]).toMatchObject({ action: 'stop' });
});
