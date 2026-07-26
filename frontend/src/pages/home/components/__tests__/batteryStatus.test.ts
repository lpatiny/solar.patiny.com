import { expect, test } from 'vitest';

import { usableBattery, usableScaleHelp } from '../batteryStatus.ts';

test('a pack sitting on its reserve floor reads as empty', () => {
  expect(usableBattery(20, 5.12, 20)).toStrictEqual({
    soc: 0,
    capacityKwh: 4.096,
  });
});

test('the displayed percentage is the charge above the floor', () => {
  // The Marstek card read 6 % while the pack itself was at 25 %.
  const usable = usableBattery(25, 5.12, 20);
  expect(usable.soc).toBeCloseTo(6.25, 10);
  expect(usable.capacityKwh).toBeCloseTo(4.096, 10);
});

test('the help text quotes both the floor and the pack’s own reading', () => {
  expect(usableScaleHelp(25, 5.12, 20)).toBe(
    'Usable charge only: 0 % is the 20 % reserve floor, which is never ' +
      'discharged, and 100 % is full. The pack itself reads 25 % (1.28 of ' +
      '5.12 kWh).',
  );
});

test('the help text drops the energy when no capacity is known', () => {
  expect(usableScaleHelp(48, null, 7)).toBe(
    'Usable charge only: 0 % is the 7 % reserve floor, which is never ' +
      'discharged, and 100 % is full. The pack itself reads 48 %.',
  );
});

test('the help text keeps only the scale when the SOC is unknown', () => {
  expect(usableScaleHelp(null, 5.12, 20)).toBe(
    'Usable charge only: 0 % is the 20 % reserve floor, which is never ' +
      'discharged, and 100 % is full.',
  );
});
