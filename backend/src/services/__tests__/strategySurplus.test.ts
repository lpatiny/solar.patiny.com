import { expect, test } from 'vitest';

import type { SurplusInputs } from '../strategySurplus.ts';
import { exportableSurplus } from '../strategySurplus.ts';

function inputs(overrides: Partial<SurplusInputs> = {}): SurplusInputs {
  return {
    productionW: 10_000,
    injectionW: 0,
    importW: 0,
    bydW: 0,
    totalChargingW: 0,
    totalDischargingW: 0,
    ...overrides,
  };
}

test('plain export with both batteries idle is the surplus', () => {
  expect(exportableSurplus(inputs({ injectionW: 1200 })).surplusW).toBe(1200);
});

test('the fleet own charging is added back: it had hidden the export', () => {
  // Full absorption: the grid reads 0 because the fleet is storing 1000 W of PV.
  expect(exportableSurplus(inputs({ totalChargingW: 1000 })).surplusW).toBe(
    1000,
  );
});

test('the fleet own discharge is subtracted: it had inflated the export', () => {
  expect(
    exportableSurplus(inputs({ injectionW: 300, totalDischargingW: 400 }))
      .surplusW,
  ).toBe(-100);
});

test('grid import cancels the add-back: night charging is not surplus', () => {
  expect(
    exportableSurplus(inputs({ totalChargingW: 1000, importW: 1000 })).surplusW,
  ).toBe(0);
});

test('a discharging BYD is subtracted and flagged as supplying the house', () => {
  // The 2026-07-26 09:20:19 sample: grid importing 81.1 W, the BYD delivering
  // 1246.1 W, both Marstek drawing 483 W. Before the fix this read as +884.9 W
  // of "solar surplus" on a 399.6 W array.
  const surplus = exportableSurplus(
    inputs({
      productionW: 399.6,
      importW: 81.1,
      bydW: 1246.1,
      totalChargingW: 966,
    }),
  );

  expect(surplus.rawW).toBeCloseTo(-361.2, 6);
  expect(surplus.surplusW).toBeCloseTo(-361.2, 6);
  expect(surplus.bydDischargeW).toBe(1246.1);
  expect(surplus.bydSupplying).toBe(true);
});

test('a charging BYD is not subtracted: it competes for solar, it does not supply', () => {
  const surplus = exportableSurplus(inputs({ injectionW: 800, bydW: -1500 }));

  expect(surplus.surplusW).toBe(800);
  expect(surplus.bydDischargeW).toBe(0);
  expect(surplus.bydSupplying).toBe(false);
});

test('BYD flow below the guard does not veto charging', () => {
  const surplus = exportableSurplus(inputs({ injectionW: 1500, bydW: 40 }));

  expect(surplus.surplusW).toBe(1460);
  expect(surplus.bydSupplying).toBe(false);
});

test('the surplus can never exceed production, however incoherent the meter', () => {
  // The 09:19:59 Fronius snapshot: 1119.9 W of export reported against 364.7 W of
  // PV and a CHARGING BYD — three fields that cannot all be true at one instant.
  const surplus = exportableSurplus(
    inputs({
      productionW: 364.7,
      injectionW: 1119.9,
      bydW: -302.6,
      totalDischargingW: 398,
    }),
  );

  expect(surplus.rawW).toBeCloseTo(721.9, 6);
  expect(surplus.productionCapW).toBe(364.7);
  expect(surplus.surplusW).toBe(364.7);
});

test('the 08:27:26 export spike is clamped to the array output', () => {
  const surplus = exportableSurplus(
    inputs({ productionW: 230.1, injectionW: 1562.3, bydW: 204 }),
  );

  expect(surplus.rawW).toBeCloseTo(1358.3, 6);
  expect(surplus.surplusW).toBe(230.1);
  expect(surplus.bydSupplying).toBe(true);
});

test('a genuine surplus under the production ceiling is untouched', () => {
  const surplus = exportableSurplus(
    inputs({ productionW: 4000, injectionW: 3200 }),
  );

  expect(surplus.rawW).toBe(3200);
  expect(surplus.surplusW).toBe(3200);
});

test('negative production is treated as a zero ceiling', () => {
  expect(
    exportableSurplus(inputs({ productionW: -5, injectionW: 900 })).surplusW,
  ).toBe(0);
});
