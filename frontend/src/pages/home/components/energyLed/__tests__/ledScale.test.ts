import { expect, test } from 'vitest';

import { fluxCells } from '../ledLayout.ts';
import {
  ENERGY_SCALE,
  POWER_SCALE,
  centerCell,
  fluxStepSeconds,
  formatWh,
  fullThreshold,
  ledLevels,
  ringCell,
  stackedLedLevels,
} from '../ledScale.ts';

test('power below one ring unit only lights the centre', () => {
  expect(ledLevels(320, POWER_SCALE)).toStrictEqual({
    ring: 0,
    center: 6,
    saturated: false,
  });
});

test('power splits into ring units and a centre remainder', () => {
  // 2 350 W = 4 ring LEDs (2 000 W) + 7 centre LEDs (350 W).
  expect(ledLevels(2350, POWER_SCALE)).toStrictEqual({
    ring: 4,
    center: 7,
    saturated: false,
  });
});

test('a full ring is exactly 8 kW and does not saturate', () => {
  expect(ledLevels(8000, POWER_SCALE)).toStrictEqual({
    ring: 16,
    center: 0,
    saturated: false,
  });
});

test('past a full ring the square saturates', () => {
  expect(ledLevels(8500, POWER_SCALE)).toStrictEqual({
    ring: 16,
    center: 9,
    saturated: true,
  });
});

test('battery energy uses 1 kWh per ring LED and 100 Wh per centre LED', () => {
  // 12 400 Wh = 12 ring LEDs (12 kWh) + 4 centre LEDs (400 Wh).
  expect(ledLevels(12_400, ENERGY_SCALE)).toStrictEqual({
    ring: 12,
    center: 4,
    saturated: false,
  });
  // 7 000 Wh = 7 ring LEDs, nothing left for the centre.
  expect(ledLevels(7000, ENERGY_SCALE)).toStrictEqual({
    ring: 7,
    center: 0,
    saturated: false,
  });
});

test('the battery square only saturates within 1 % of usable capacity', () => {
  const full = fullThreshold(18_422);
  // Empty means sitting on the reserve floors, which the API already subtracts.
  expect(ledLevels(0, ENERGY_SCALE, full)).toStrictEqual({
    ring: 0,
    center: 0,
    saturated: false,
  });
  // 17 500 Wh runs out of LEDs — ring and centre both max out — but 95 % of the
  // fleet is not full, so the square must not claim to be.
  expect(ledLevels(17_500, ENERGY_SCALE, full)).toStrictEqual({
    ring: 16,
    center: 9,
    saturated: false,
  });
  // 18 422 Wh usable (see batteryReserve.test.ts) is full, and so is 1 % below.
  expect(ledLevels(18_422, ENERGY_SCALE, full)).toStrictEqual({
    ring: 16,
    center: 9,
    saturated: true,
  });
  expect(ledLevels(18_238, ENERGY_SCALE, full)?.saturated).toBe(true);
  expect(ledLevels(18_200, ENERGY_SCALE, full)?.saturated).toBe(false);
});

test('an unknown capacity leaves the battery square unable to read full', () => {
  expect(fullThreshold(0)).toBeUndefined();
  // With no threshold it falls back to the power squares' rule: past a full ring.
  expect(ledLevels(18_422, ENERGY_SCALE)).toStrictEqual({
    ring: 16,
    center: 9,
    saturated: true,
  });
});

test('the battery ring is filled by the BYD first and the Marstek after it', () => {
  // 10 230 Wh in the BYD plus 1 178 Wh of Marstek: 11 ring LEDs in all, the
  // first 10 of them the BYD's, and the 408 Wh remainder is Marstek.
  expect(stackedLedLevels(10_230, 1178, ENERGY_SCALE)).toStrictEqual({
    ring: 11,
    center: 4,
    saturated: false,
    lowerRing: 10,
    upperCenter: true,
  });
});

test('an empty Marstek fleet leaves the whole battery square in the BYD green', () => {
  expect(stackedLedLevels(6300, 0, ENERGY_SCALE)).toStrictEqual({
    ring: 6,
    center: 3,
    saturated: false,
    lowerRing: 6,
    upperCenter: false,
  });
});

test('an empty BYD leaves the boundary at zero, so the ring is all Marstek', () => {
  expect(stackedLedLevels(0, 4300, ENERGY_SCALE)).toStrictEqual({
    ring: 4,
    center: 3,
    saturated: false,
    lowerRing: 0,
    upperCenter: true,
  });
});

test('the stacked total lights exactly the same LEDs as the plain level', () => {
  const stacked = stackedLedLevels(10_230, 1178, ENERGY_SCALE);
  const plain = ledLevels(11_408, ENERGY_SCALE);
  expect(stacked.ring).toBe(plain.ring);
  expect(stacked.center).toBe(plain.center);
});

test('a negative value lights nothing', () => {
  expect(ledLevels(-500, POWER_SCALE)).toStrictEqual({
    ring: 0,
    center: 0,
    saturated: false,
  });
});

test('the ring walks the perimeter clockwise from the top-left corner', () => {
  expect(ringCell(0)).toStrictEqual({ row: 0, column: 0 });
  expect(ringCell(4)).toStrictEqual({ row: 0, column: 4 });
  expect(ringCell(8)).toStrictEqual({ row: 4, column: 4 });
  expect(ringCell(12)).toStrictEqual({ row: 4, column: 0 });
  expect(ringCell(15)).toStrictEqual({ row: 1, column: 0 });
});

test('the centre fills the 3x3 block row by row', () => {
  expect(centerCell(0)).toStrictEqual({ row: 1, column: 1 });
  expect(centerCell(4)).toStrictEqual({ row: 2, column: 2 });
  expect(centerCell(8)).toStrictEqual({ row: 3, column: 3 });
});

test('flux dots march faster as the power grows, within the panel limits', () => {
  expect(fluxStepSeconds(0)).toBe(1);
  expect(fluxStepSeconds(200)).toBe(1);
  expect(fluxStepSeconds(1000)).toBe(0.4);
  expect(fluxStepSeconds(4000)).toBe(0.1);
  expect(fluxStepSeconds(20_000)).toBe(0.08);
});

test('a flux track is six evenly spaced LEDs from one square to the other', () => {
  expect(
    fluxCells({ from: { row: 5, column: 5 }, to: { row: 11, column: 11 } }),
  ).toStrictEqual([
    { row: 5, column: 5 },
    { row: 6, column: 6 },
    { row: 7, column: 7 },
    { row: 8, column: 8 },
    { row: 9, column: 9 },
    { row: 10, column: 10 },
  ]);
});

test('the battery/grid anti-diagonal never collides with the solar diagonal', () => {
  const diagonal = fluxCells({
    from: { row: 5, column: 5 },
    to: { row: 11, column: 11 },
  });
  const antiDiagonal = fluxCells({
    from: { row: 5, column: 10 },
    to: { row: 11, column: 4 },
  });
  const taken = new Set(diagonal.map((c) => `${c.row}:${c.column}`));
  for (const cell of antiDiagonal) {
    expect(taken.has(`${cell.row}:${cell.column}`)).toBe(false);
  }
});

test('energy formatting switches to kWh above 1000 Wh', () => {
  expect(formatWh(740)).toBe('740 Wh');
  expect(formatWh(12_400)).toBe('12.4 kWh');
});
