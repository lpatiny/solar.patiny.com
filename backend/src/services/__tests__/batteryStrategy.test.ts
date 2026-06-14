import { expect, test } from 'vitest';

import type { StrategyConfig } from '../strategyConfig.ts';
import type { DeviceState } from '../strategyDecide.ts';
import { decide } from '../strategyDecide.ts';

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

// decide(config, devices, injectionW, importW, bydW)

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
  const { decisions } = decide(
    config,
    devices({ chargingW: 500 }, { chargingW: 500 }),
    0,
    0,
  );

  expect(decisions.map((d) => d.powerW)).toStrictEqual([250, 250]);
});

test('charge takes priority even in force discharge mode', () => {
  const { phase, decisions } = decide(forceConfig, devices({}, {}), 2600, 0);

  expect(phase).toBe('charge');
  expect(decisions.map((d) => d.powerW)).toStrictEqual([500, 500]);
});

// --- Cover mode: cover the post-solar house deficit from the power balance ---
// target = bydW + totalDischarging + importW - injectionW

test('cover: grid import with no BYD discharges to cover the deficit', () => {
  // deficit = byd 0 + dis 0 + import 240 - inject 0 = 240; 120 each.
  const { phase, decisions } = decide(
    config,
    devices({ soc: 80 }, { soc: 80 }),
    0,
    240,
    0,
  );

  expect(phase).toBe('discharge');
  expect(decisions.map((d) => d.powerW)).toStrictEqual([120, 120]);
});

test('cover: never feeds the BYD charging (no battery-to-battery transfer)', () => {
  // The screenshot case: BYD charging 278, Marstek already discharging 242 each,
  // 34 W import. deficit = -278 + 484 + 34 - 0 = 240 => 120 each, NOT 484.
  const { phase, decisions } = decide(
    config,
    devices({ soc: 79, dischargingW: 242 }, { soc: 87, dischargingW: 242 }),
    0,
    34,
    -278,
  );

  expect(phase).toBe('discharge');
  expect(decisions.map((d) => d.powerW)).toStrictEqual([120, 120]);
});

test('cover: target is stable against the Marstek own discharge (no oscillation)', () => {
  // Already covering the load: discharging 120 each (240), grid balanced, BYD idle.
  // The grid reads 0, but the deficit reconstructs to 0 + 240 + 0 - 0 = 240, so it
  // HOLDS at 120 each instead of collapsing to idle and re-triggering.
  const { phase, decisions } = decide(
    config,
    devices({ soc: 80, dischargingW: 120 }, { soc: 80, dischargingW: 120 }),
    0,
    0,
    0,
  );

  expect(phase).toBe('discharge');
  expect(decisions.map((d) => d.powerW)).toStrictEqual([120, 120]);
});

test('cover: a charging BYD with no real deficit leaves the Marstek idle', () => {
  // BYD charging 300, nothing else: deficit = -300 + 0 + 0 - 0 = -300 => idle.
  // The Marstek must NOT discharge to feed the BYD.
  const { phase, decisions } = decide(
    config,
    devices({ soc: 80 }, { soc: 80 }),
    0,
    0,
    -300,
  );

  expect(phase).toBe('idle');
  expect(decisions.map((d) => d.action)).toStrictEqual(['stop', 'stop']);
});

test('cover: takes over a discharging BYD (Marstek priority)', () => {
  // BYD discharging 200 to cover the load; deficit = 200 + 0 + 0 - 0 = 200, so the
  // Marstek discharges 100 each to take the load over (the BYD then backs off).
  const { decisions } = decide(
    config,
    devices({ soc: 80 }, { soc: 80 }),
    0,
    0,
    200,
  );

  expect(decisions.map((d) => d.powerW)).toStrictEqual([100, 100]);
});

test('cover: is capped at the per-battery maximum', () => {
  const { decisions } = decide(
    config,
    devices({ soc: 80 }, { soc: 80 }),
    0,
    2000,
    0,
  );

  expect(decisions.map((d) => d.powerW)).toStrictEqual([400, 400]);
});

test('cover: solar exporting (no deficit) leaves the batteries idle', () => {
  // Exporting 100, no import, BYD idle: deficit = 0 + 0 + 0 - 100 = -100 => idle.
  const { phase } = decide(
    config,
    devices({ soc: 80 }, { soc: 80 }),
    100,
    0,
    0,
  );

  expect(phase).toBe('idle');
});

test('cover: a battery at or below the floor stops discharging', () => {
  const { decisions } = decide(
    config,
    devices({ soc: 20 }, { soc: 21 }),
    0,
    600,
    0,
  );

  expect(decisions[0]).toMatchObject({ action: 'stop', powerW: 0 });
  expect(decisions[1]).toMatchObject({ action: 'discharge', powerW: 400 });
});

// --- Force mode: discharge at the rate, exporting up to the injection limit ---
// target = totalDischarging + importW - injectionW + injectTargetW

test('force: balanced grid discharges up to the injection limit', () => {
  // target = 0 + 0 - 0 + 500 = 500; 250 each.
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
  // target = 0 + 600 - 0 + 500 = 1100, capped at 2*400 = 800; 400 each.
  const { decisions } = decide(
    forceConfig,
    devices({ soc: 80 }, { soc: 80 }),
    0,
    600,
  );

  expect(decisions.map((d) => d.powerW)).toStrictEqual([400, 400]);
});

test('force: already exporting under the limit tops up to the limit', () => {
  // injection 300 (< limit); target = 0 + 0 - 300 + 500 = 200; 100 each.
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
  // Discharging 250 each (500), exporting exactly the 500 limit:
  // target = 500 + 0 - 500 + 500 = 500; stays 250 each.
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

  const covering = decide(config, devices({ soc: null }), 0, 600, 0);
  expect(covering.decisions[0]).toMatchObject({ action: 'stop' });

  const forcing = decide(forceConfig, devices({ soc: null }), 0, 600);
  expect(forcing.decisions[0]).toMatchObject({ action: 'stop' });
});
