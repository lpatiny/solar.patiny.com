import { expect, test } from 'vitest';

import type { DeviceState } from '../batteryStrategy.ts';
import { decide } from '../batteryStrategy.ts';
import type { StrategyConfig } from '../strategyConfig.ts';

const config: StrategyConfig = {
  enabled: true,
  injectTargetW: 500,
  chargeMaxW: 500,
  chargeCeilingPct: 100,
  dischargeMaxW: 400,
  dischargeCoverConsumption: false,
  dischargeFloorPct: 20,
  intervalMs: 30_000,
};

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

test('injection below target with no import keeps both batteries idle', () => {
  const { phase, decisions } = decide(config, devices({}, {}), 400, 0);

  expect(phase).toBe('idle');
  expect(decisions.map((d) => d.action)).toStrictEqual(['stop', 'stop']);
  expect(decisions.map((d) => d.powerW)).toStrictEqual([0, 0]);
});

test('large surplus charges both batteries at the per-battery cap', () => {
  // surplus = injection 2600 + already charging 0 = 2600; minus target 500 =
  // 2100, capped at 2*500 = 1000; split = 500 each.
  const { phase, decisions } = decide(config, devices({}, {}), 2600, 0);

  expect(phase).toBe('charge');
  expect(decisions.map((d) => d.action)).toStrictEqual(['charge', 'charge']);
  expect(decisions.map((d) => d.powerW)).toStrictEqual([500, 500]);
});

test('moderate surplus is split so injection settles at the target', () => {
  // surplus 900 - target 500 = 400, split 200 each.
  const { decisions } = decide(config, devices({}, {}), 900, 0);

  expect(decisions.map((d) => d.powerW)).toStrictEqual([200, 200]);
});

test('surplus is reconstructed from injection plus current charging', () => {
  // Both already charging 500 each => injection 0 but true surplus = 1000.
  // 1000 - 500 target = 500 desired total, split 250 each.
  const { decisions } = decide(
    config,
    devices({ chargingW: 500 }, { chargingW: 500 }),
    0,
    0,
  );

  expect(decisions.map((d) => d.powerW)).toStrictEqual([250, 250]);
});

test('a full battery is excluded; the other absorbs up to its own cap', () => {
  // Only battery 2 eligible; cap = 1*500. surplus 2000 - 500 = 1500 capped 500.
  const { decisions } = decide(
    config,
    devices({ soc: 100 }, { soc: 60 }),
    2000,
    0,
  );

  expect(decisions[0]).toMatchObject({ action: 'stop', powerW: 0 });
  expect(decisions[1]).toMatchObject({ action: 'charge', powerW: 500 });
});

test('tiny surplus below the minimum charge stops instead of dribbling', () => {
  // surplus 540 - 500 = 40 total, split 20 each, below MIN_CHARGE_W (50).
  const { phase, decisions } = decide(config, devices({}, {}), 540, 0);

  expect(phase).toBe('idle');
  expect(decisions.map((d) => d.action)).toStrictEqual(['stop', 'stop']);
});

test('grid import discharges both batteries to cover the load', () => {
  // import 600, no export => deficit 600, split 300 each (below the 400 cap).
  const { phase, decisions } = decide(
    config,
    devices({ soc: 80 }, { soc: 55 }),
    0,
    600,
  );

  expect(phase).toBe('discharge');
  expect(decisions.map((d) => d.action)).toStrictEqual([
    'discharge',
    'discharge',
  ]);
  expect(decisions.map((d) => d.powerW)).toStrictEqual([300, 300]);
});

test('discharge is capped at the per-battery maximum', () => {
  // import 1200 => deficit 1200, capped at 2*400 = 800, split 400 each.
  const { decisions } = decide(
    config,
    devices({ soc: 80 }, { soc: 55 }),
    0,
    1200,
  );

  expect(decisions.map((d) => d.powerW)).toStrictEqual([400, 400]);
});

test('deficit is reconstructed from import plus current discharging', () => {
  // Batteries already cover the load (import 0) by discharging 300 each; the
  // true deficit is 600, so they hold at 300 each instead of dropping to idle.
  const { phase, decisions } = decide(
    config,
    devices({ soc: 80, dischargingW: 300 }, { soc: 80, dischargingW: 300 }),
    0,
    0,
  );

  expect(phase).toBe('discharge');
  expect(decisions.map((d) => d.powerW)).toStrictEqual([300, 300]);
});

test('a battery at or below the discharge floor stops discharging', () => {
  // Only battery 2 (soc 21 > floor 20) is eligible; cap = 1*400.
  const { decisions } = decide(
    config,
    devices({ soc: 20 }, { soc: 21 }),
    0,
    600,
  );

  expect(decisions[0]).toMatchObject({ action: 'stop', powerW: 0 });
  expect(decisions[1]).toMatchObject({ action: 'discharge', powerW: 400 });
});

test('export below the charge target with no import keeps batteries idle', () => {
  const { phase, decisions } = decide(
    config,
    devices({ soc: 80 }, { soc: 80 }),
    400,
    0,
  );

  expect(phase).toBe('idle');
  expect(decisions.map((d) => d.action)).toStrictEqual(['stop', 'stop']);
});

test('no import and no surplus is idle', () => {
  const { phase } = decide(config, devices({ soc: 80 }, { soc: 80 }), 0, 0);

  expect(phase).toBe('idle');
});

const consumptionConfig: StrategyConfig = {
  ...config,
  dischargeCoverConsumption: true,
};

test('cover-consumption discharges to cover the load with a balanced grid', () => {
  // Grid balanced (the BYD battery is covering the house), so net-grid mode sees
  // nothing — but the inverter still reports 500 W of consumption; split 250 each.
  const { phase, decisions } = decide(
    consumptionConfig,
    devices({ soc: 80 }, { soc: 80 }),
    0,
    0,
    500,
  );

  expect(phase).toBe('discharge');
  expect(decisions.map((d) => d.powerW)).toStrictEqual([250, 250]);
});

test('net-grid mode stays idle when the grid is balanced (BYD covers load)', () => {
  // Same 500 W consumption, but with no grid import net-grid mode does nothing —
  // this is the standby the cover-consumption toggle is meant to fix.
  const { phase, decisions } = decide(
    config,
    devices({ soc: 80 }, { soc: 80 }),
    0,
    0,
    500,
  );

  expect(phase).toBe('idle');
  expect(decisions.map((d) => d.action)).toStrictEqual(['stop', 'stop']);
});

test('with no BYD or solar both modes discharge to cover the consumption', () => {
  // No PV, no BYD: 600 W grid import == 600 W consumption, so the two modes
  // agree and both discharge 300 each.
  const off = decide(config, devices({ soc: 80 }, { soc: 80 }), 0, 600, 600);
  const on = decide(
    consumptionConfig,
    devices({ soc: 80 }, { soc: 80 }),
    0,
    600,
    600,
  );

  expect(off.decisions.map((d) => d.powerW)).toStrictEqual([300, 300]);
  expect(on.decisions.map((d) => d.powerW)).toStrictEqual([300, 300]);
});

test('cover-consumption is still capped at the per-battery maximum', () => {
  // Consumption 2000 W, capped at 2*400 = 800, 400 each.
  const { decisions } = decide(
    consumptionConfig,
    devices({ soc: 80 }, { soc: 80 }),
    0,
    0,
    2000,
  );

  expect(decisions.map((d) => d.powerW)).toStrictEqual([400, 400]);
});

test('cover-consumption load is reconstructed from current discharging', () => {
  // The Marstek already discharges 100 each (200 W), so the inverter under-reports
  // consumption as 300 W; the true load is 300 + 200 = 500, so they hold 250 each
  // rather than winding down.
  const { phase, decisions } = decide(
    consumptionConfig,
    devices({ soc: 80, dischargingW: 100 }, { soc: 80, dischargingW: 100 }),
    0,
    0,
    300,
  );

  expect(phase).toBe('discharge');
  expect(decisions.map((d) => d.powerW)).toStrictEqual([250, 250]);
});

test('unknown SOC stops charging and stops discharging (fail safe)', () => {
  const charging = decide(config, devices({ soc: null }), 3000, 0);

  expect(charging.decisions[0]).toMatchObject({ action: 'stop' });

  const discharging = decide(config, devices({ soc: null }), 0, 600);

  expect(discharging.decisions[0]).toMatchObject({ action: 'stop' });
});
