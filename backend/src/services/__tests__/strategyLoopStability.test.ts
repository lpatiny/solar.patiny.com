import { expect, test } from 'vitest';

import type { CommandSnapshot } from '../fleetFlow.ts';
import { resolveFleetFlow } from '../fleetFlow.ts';
import type { StrategyConfig } from '../strategyConfig.ts';
import { decide } from '../strategyDecide.ts';

/**
 * Closed-loop simulation of the control loop against a simple plant, reproducing
 * the cadence mismatch seen in production: the loop runs every 30 s while Marstek
 * telemetry only refreshes every 60 s.
 *
 * The plant: a constant house load and solar production, a Marstek fleet that
 * reaches its commanded setpoint by the next cycle, and a BYD that instantly
 * takes up the slack — which is what holds the grid near zero and couples the two
 * controllers to each other.
 */

const BASE_CONFIG: StrategyConfig = {
  mode: 'auto',
  injectTargetW: 700,
  chargeMaxW: 700,
  chargeCeilingPct: 100,
  dischargeMaxW: 1000,
  dischargeMode: 'cover',
  dischargeFloorPct: 20,
  intervalMs: 30_000,
};

const LOOP_MS = 30_000;
const TELEMETRY_MS = 60_000;
const TRUST_MS = 150_000;
const HOUSE_LOAD_W = 900;
const SOLAR_W = 300;
/** The house deficit the fleet should settle on: 900 W load − 300 W solar. */
const DEFICIT_W = HOUSE_LOAD_W - SOLAR_W;

interface SimOptions {
  /** Compensate the fleet's own flow from the last command, not just telemetry. */
  useCommandedFlow: boolean;
  /** Per-battery discharge cap. */
  dischargeMaxW?: number;
}

function simulate({ useCommandedFlow, dischargeMaxW }: SimOptions): number[] {
  const config: StrategyConfig = {
    ...BASE_CONFIG,
    dischargeMaxW: dischargeMaxW ?? BASE_CONFIG.dischargeMaxW,
  };
  let now = 0;
  let sample = { valuesAt: 0, acPowerW: 0 };
  let command: CommandSnapshot | null = null;
  const setpoints: number[] = [];

  for (let cycle = 0; cycle < 16; cycle++) {
    // The fleet reaches the setpoint it was last given; telemetry only refreshes
    // every other cycle, so half the decisions run on a pre-command reading.
    const actualFleetW = command?.action === 'discharge' ? command.powerW : 0;
    if (now % TELEMETRY_MS === 0) {
      sample = { valuesAt: now, acPowerW: actualFleetW };
    }
    const bydW = HOUSE_LOAD_W - SOLAR_W - actualFleetW;

    const { decisions } = decide(
      config,
      [
        {
          id: 1,
          name: 'Marstek 1',
          soc: 80,
          ...resolveFleetFlow(
            sample,
            useCommandedFlow ? command : null,
            now,
            TRUST_MS,
          ),
        },
      ],
      0,
      0,
      bydW,
      'discharge',
    );

    const decision = decisions[0];
    if (!decision) throw new Error('expected one decision');
    setpoints.push(decision.powerW);
    command = { action: decision.action, powerW: decision.powerW, sentAt: now };
    now += LOOP_MS;
  }
  return setpoints;
}

/** Largest change between consecutive setpoints, ignoring the initial ramp. */
function maxSwing(setpoints: number[]): number {
  let swing = 0;
  for (let i = 4; i < setpoints.length; i++) {
    swing = Math.max(
      swing,
      Math.abs((setpoints[i] ?? 0) - (setpoints[i - 1] ?? 0)),
    );
  }
  return swing;
}

test('measured-only compensation limit-cycles when telemetry lags the loop', () => {
  // The production bug: reading the fleet's own flow from telemetry that predates
  // the last command makes the loop believe the command never landed, so it
  // slams the setpoint between the full deficit and zero every cycle.
  const setpoints = simulate({ useCommandedFlow: false });
  expect(maxSwing(setpoints)).toBe(DEFICIT_W);
  expect(setpoints.slice(-4)).toStrictEqual([DEFICIT_W, 0, DEFICIT_W, 0]);
});

test('commanded compensation settles on the house deficit and holds it', () => {
  const setpoints = simulate({ useCommandedFlow: true });
  expect(maxSwing(setpoints)).toBe(0);
  expect(setpoints.slice(-4)).toStrictEqual([
    DEFICIT_W,
    DEFICIT_W,
    DEFICIT_W,
    DEFICIT_W,
  ]);
});

test('a saturated fleet hides the fault, which is why nights looked stable', () => {
  // With the cap below the deficit the loop is pinned at the cap and cannot hunt,
  // so the lag never shows. Only once solar lifts the target into the regulating
  // range — below the cap — does the oscillation appear. Same inputs as the first
  // test, just a cap the deficit cannot reach.
  const setpoints = simulate({ useCommandedFlow: false, dischargeMaxW: 400 });
  expect(maxSwing(setpoints)).toBe(0);
  expect(setpoints.at(-1)).toBe(400);
});
