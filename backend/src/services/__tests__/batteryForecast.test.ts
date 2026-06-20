import { expect, test } from 'vitest';

import type {
  BatteryForecastDevice,
  BatteryForecastParams,
  ForecastEnergySlot,
} from '../batteryForecast.ts';
import { simulateBatteryForecast } from '../batteryForecast.ts';

const params: BatteryForecastParams = {
  injectTargetW: 500,
  chargeMaxW: 500,
  chargeCeilingPct: 100,
  dischargeMaxW: 400,
  dischargeFloorPct: 20,
  perBatteryCapacityKwh: 5,
};

function slot(
  index: number,
  predictedProductionKwh: number,
  typicalConsumptionKwh: number,
): ForecastEnergySlot {
  const timestamp = index * 3 * 3600;
  return {
    timestamp,
    endTimestamp: timestamp + 3 * 3600,
    predictedProductionKwh,
    typicalConsumptionKwh,
  };
}

function batteries(...socs: Array<number | null>): BatteryForecastDevice[] {
  return socs.map((socPct, index) => ({
    id: index + 1,
    name: `battery ${index + 1}`,
    socPct,
  }));
}

test('a large surplus charges every battery at the per-battery cap', () => {
  // surplus = (6 - 0.6) kWh over 3 h = 1800 W; minus 500 target = 1300,
  // capped at 2 * 500 = 1000; split 500 each (at the per-battery cap).
  const series = simulateBatteryForecast(
    [slot(0, 6, 0.6)],
    batteries(50, 50),
    params,
  );

  expect(series.map((s) => s.slots[0]?.chargeW)).toStrictEqual([500, 500]);
});

test('a moderate surplus is split so injection settles at the target', () => {
  // surplus = (3 - 0.6) kWh over 3 h = 800 W; minus 500 = 300; split 150 each.
  const series = simulateBatteryForecast(
    [slot(0, 3, 0.6)],
    batteries(50, 50),
    params,
  );

  expect(series.map((s) => s.slots[0]?.chargeW)).toStrictEqual([150, 150]);
});

test('a tiny surplus below the minimum charge keeps every battery stopped', () => {
  // surplus = (2 - 0.6) kWh over 3 h ≈ 373 W; below the 500 target → 0.
  const series = simulateBatteryForecast(
    [slot(0, 2, 0.6)],
    batteries(50, 50),
    params,
  );

  expect(series.map((s) => s.slots[0]?.chargeW)).toStrictEqual([0, 0]);
});

test('a full battery is excluded and the other absorbs up to its own cap', () => {
  const series = simulateBatteryForecast(
    [slot(0, 6, 0.6)],
    batteries(100, 60),
    params,
  );

  expect(series[0]?.slots[0]?.chargeW).toBe(0);
  expect(series[1]?.slots[0]?.chargeW).toBe(500);
});

test('SOC advances across slots and charging stops once the ceiling is reached', () => {
  // 5 kWh battery at 90% has 0.5 kWh headroom. A 500 W cap over 3 h would add
  // 1.5 kWh, so the first slot is capped by capacity and the battery fills.
  const series = simulateBatteryForecast(
    [slot(0, 6, 0.6), slot(1, 6, 0.6)],
    batteries(90),
    params,
  );

  const first = series[0]?.slots[0];

  expect(first?.socEndPct).toBe(100);
  // ~0.5 kWh over 3 h ≈ 167 W, below the 500 W cap.
  expect(first?.chargeW).toBe(167);
  // Now full → excluded from the second slot.
  expect(series[0]?.slots[1]?.chargeW).toBe(0);
});

test('a battery with unknown SOC is never charged', () => {
  const series = simulateBatteryForecast(
    [slot(0, 6, 0.6)],
    batteries(null),
    params,
  );

  expect(series[0]?.slots[0]?.chargeW).toBe(0);
});

test('a post-solar deficit discharges every battery to cover it', () => {
  // No production, 0.6 kWh consumed over 3 h = 200 W deficit; split 100 each
  // (negative = discharging). 0.3 kWh each over 3 h drops a 5 kWh battery 6 points.
  const series = simulateBatteryForecast(
    [slot(0, 0, 0.6)],
    batteries(50, 50),
    params,
  );

  expect(series.map((s) => s.slots[0]?.chargeW)).toStrictEqual([-100, -100]);
  expect(series.map((s) => s.slots[0]?.socEndPct)).toStrictEqual([44, 44]);
});

test('a battery at the discharge floor is excluded; the other covers the deficit', () => {
  // deficit = 200 W; battery 1 is at the floor (20%) so only battery 2 discharges,
  // taking the whole 200 W → SOC 50 → 38 (0.6 kWh of a 5 kWh pack).
  const series = simulateBatteryForecast(
    [slot(0, 0, 0.6)],
    batteries(20, 50),
    params,
  );

  expect(series[0]?.slots[0]?.chargeW).toBe(0);
  expect(series[1]?.slots[0]?.chargeW).toBe(-200);
  expect(series[1]?.slots[0]?.socEndPct).toBe(38);
});

test('a deficit with every battery at the floor leaves them idle', () => {
  const series = simulateBatteryForecast(
    [slot(0, 0, 0.6)],
    batteries(20, 20),
    params,
  );

  expect(series.map((s) => s.slots[0]?.chargeW)).toStrictEqual([0, 0]);
});
