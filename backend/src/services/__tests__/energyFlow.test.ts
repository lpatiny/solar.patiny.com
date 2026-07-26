import { expect, test } from 'vitest';

import { computeEnergyFlow } from '../energyFlow.ts';

test('sunny surplus: solar covers the house, charges the battery, exports the rest', () => {
  const flow = computeEnergyFlow({
    productionW: 5000,
    gridW: -1500,
    batteryW: -2000,
  });
  expect(flow.consumptionW).toBe(1500);
  expect(flow.solarToHomeW).toBe(1500);
  expect(flow.solarToBatteryW).toBe(2000);
  expect(flow.solarToGridW).toBe(1500);
  expect(flow.gridExportW).toBe(1500);
  expect(flow.batteryToHomeW).toBe(0);
  expect(flow.gridToHomeW).toBe(0);
  expect(flow.gridToBatteryW).toBe(0);
});

test('night: battery covers most of the load, the grid covers the rest', () => {
  const flow = computeEnergyFlow({
    productionW: 0,
    gridW: 100,
    batteryW: 400,
  });
  expect(flow.consumptionW).toBe(500);
  expect(flow.batteryToHomeW).toBe(400);
  expect(flow.gridToHomeW).toBe(100);
  expect(flow.gridImportW).toBe(100);
  expect(flow.solarToHomeW).toBe(0);
  expect(flow.batteryToGridW).toBe(0);
});

test('forced night charge: the grid feeds both the house and the battery', () => {
  const flow = computeEnergyFlow({
    productionW: 0,
    gridW: 2500,
    batteryW: -2000,
  });
  expect(flow.consumptionW).toBe(500);
  expect(flow.gridToHomeW).toBe(500);
  expect(flow.gridToBatteryW).toBe(2000);
  expect(flow.batteryChargeW).toBe(2000);
  expect(flow.gridToHomeW + flow.gridToBatteryW).toBe(flow.gridImportW);
});

test('battery discharging into the grid is reported as a battery → grid flow', () => {
  const flow = computeEnergyFlow({
    productionW: 100,
    gridW: -300,
    batteryW: 500,
  });
  expect(flow.consumptionW).toBe(300);
  expect(flow.solarToHomeW).toBe(100);
  expect(flow.batteryToHomeW).toBe(200);
  expect(flow.batteryToGridW).toBe(300);
  expect(flow.solarToGridW).toBe(0);
  expect(flow.batteryToHomeW + flow.batteryToGridW).toBe(
    flow.batteryDischargeW,
  );
});

test('charging a Marstek is never counted as household consumption', () => {
  // Solar 3 kW, a Marstek charging at 1 kW, a real house load of 500 W. The
  // Fronius meter cannot see the plug-in battery, so its own P_Load reads
  // 1500 W — the load plus the charging. Folding the Marstek net power into the
  // battery term (charge negative) has to bring consumption back down to 500 W
  // and book the 1 kW as a charge, not as load.
  const flow = computeEnergyFlow({
    productionW: 3000,
    gridW: -1500,
    batteryW: -1000,
  });
  expect(flow.consumptionW).toBe(500);
  expect(flow.batteryChargeW).toBe(1000);
  expect(flow.solarToBatteryW).toBe(1000);
  expect(flow.solarToHomeW).toBe(500);
  expect(flow.solarToGridW).toBe(1500);
});

test('discharging a Marstek is never double-counted as consumption either', () => {
  // The mirror case: a Marstek discharging 800 W behind the meter makes the
  // Fronius under-report the load by 800 W, so the true load is 1300 W and the
  // battery covers most of it.
  const flow = computeEnergyFlow({
    productionW: 0,
    gridW: 500,
    batteryW: 800,
  });
  expect(flow.consumptionW).toBe(1300);
  expect(flow.batteryToHomeW).toBe(800);
  expect(flow.gridToHomeW).toBe(500);
});

test('partial cloud: solar covers part of the load, the grid tops it up', () => {
  const flow = computeEnergyFlow({
    productionW: 800,
    gridW: 450,
    batteryW: 0,
  });
  expect(flow.consumptionW).toBe(1250);
  expect(flow.solarToHomeW).toBe(800);
  expect(flow.gridToHomeW).toBe(450);
  expect(flow.solarToGridW).toBe(0);
  expect(flow.batteryChargeW).toBe(0);
  expect(flow.batteryDischargeW).toBe(0);
});

test('every source and sink total is exactly covered by its flows', () => {
  const cases: Array<[number, number, number]> = [
    [5000, -1500, -2000],
    [0, 100, 400],
    [0, 2500, -2000],
    [100, -300, 500],
    [3200, -3200, 0],
    [0, 0, 0],
  ];
  for (const [productionW, gridW, batteryW] of cases) {
    const flow = computeEnergyFlow({ productionW, gridW, batteryW });
    expect(
      flow.solarToHomeW + flow.solarToBatteryW + flow.solarToGridW,
    ).toBeCloseTo(flow.productionW, 9);
    expect(flow.batteryToHomeW + flow.batteryToGridW).toBeCloseTo(
      flow.batteryDischargeW,
      9,
    );
    expect(flow.gridToHomeW + flow.gridToBatteryW).toBeCloseTo(
      flow.gridImportW,
      9,
    );
    expect(
      flow.solarToHomeW + flow.batteryToHomeW + flow.gridToHomeW,
    ).toBeCloseTo(flow.consumptionW, 9);
    expect(flow.solarToBatteryW + flow.gridToBatteryW).toBeCloseTo(
      flow.batteryChargeW,
      9,
    );
    expect(flow.solarToGridW + flow.batteryToGridW).toBeCloseTo(
      flow.gridExportW,
      9,
    );
  }
});
