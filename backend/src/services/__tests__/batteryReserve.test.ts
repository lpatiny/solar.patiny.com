import { expect, test } from 'vitest';

import { usableEnergy } from '../batteryReserve.ts';

test('a Marstek on its 20 % floor reads as empty', () => {
  expect(usableEnergy(20, 5120, 20)).toStrictEqual({
    storedWh: 0,
    capacityWh: 4096,
  });
});

test('a full Marstek holds its whole usable capacity', () => {
  expect(usableEnergy(100, 5120, 20)).toStrictEqual({
    storedWh: 4096,
    capacityWh: 4096,
  });
});

test('a half-charged Marstek counts only the energy above the floor', () => {
  // 60 % of a 5120 Wh pack is 3072 Wh raw, but only 40 points sit above the
  // 20 % floor, so 2048 Wh is actually usable.
  expect(usableEnergy(60, 5120, 20)).toStrictEqual({
    storedWh: 2048,
    capacityWh: 4096,
  });
});

test('the BYD reserve leaves 93 % of the pack usable', () => {
  expect(usableEnergy(100, 11_000, 7)).toStrictEqual({
    storedWh: 10_230,
    capacityWh: 10_230,
  });
});

test('below the floor the stored energy clamps to zero, never negative', () => {
  expect(usableEnergy(5, 5120, 20).storedWh).toBe(0);
  expect(usableEnergy(0, 11_000, 7).storedWh).toBe(0);
});

test('a zero reserve leaves the raw figures untouched', () => {
  expect(usableEnergy(50, 5120, 0)).toStrictEqual({
    storedWh: 2560,
    capacityWh: 5120,
  });
});

test('the full fleet holds 18.4 kWh once every floor is taken out', () => {
  const byd = usableEnergy(100, 11_000, 7);
  const marstek = usableEnergy(100, 5120, 20);
  const fleetWh = byd.storedWh + marstek.storedWh * 2;
  expect(fleetWh).toBe(18_422);
  // It must stay under the 20 kWh the LED wall's 16-LED ring can show.
  expect(fleetWh).toBeLessThan(20_000);
});
