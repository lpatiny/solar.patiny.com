import { expect, test } from 'vitest';

import { computeUnavailableSensors } from '../sensorAvailability.ts';

test('returns known sensors missing from the live list', () => {
  const known = [
    { id: 'cellar', name: 'Cellar' },
    { id: 'living', name: 'Living' },
    { id: 'florian', name: 'Florian' },
  ];
  const live = [{ id: 'living' }, { id: 'florian' }];
  expect(computeUnavailableSensors(known, live)).toStrictEqual([
    { id: 'cellar', name: 'Cellar' },
  ]);
});

test('returns an empty list when every known sensor is live', () => {
  const known = [{ id: 'a', name: 'A' }];
  expect(computeUnavailableSensors(known, [{ id: 'a' }])).toStrictEqual([]);
});

test('preserves the order of the known list', () => {
  const known = [
    { id: 'b', name: 'B' },
    { id: 'a', name: 'A' },
    { id: 'c', name: 'C' },
  ];
  expect(computeUnavailableSensors(known, [{ id: 'a' }])).toStrictEqual([
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
  ]);
});
