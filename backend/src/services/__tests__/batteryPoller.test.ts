/* eslint-disable camelcase -- LiveEntry mirrors DB rows and uses snake_case device_id */
import { expect, test } from 'vitest';

import type { LiveEntry } from '../batteryPoller.ts';
import {
  _setLatest,
  getFreshLatest,
  isDeviceFresh,
  liveAgeMs,
} from '../batteryPoller.ts';
import { getStaleMs } from '../marstekPollCadence.ts';

function entry(overrides: Partial<LiveEntry>): LiveEntry {
  return {
    device_id: 1,
    timestamp: Math.floor(Date.now() / 1000),
    values: null,
    control: [],
    error: null,
    valuesAt: Date.now(),
    ...overrides,
  };
}

test('a never-read device is stale (valuesAt 0)', () => {
  _setLatest(10, entry({ device_id: 10, valuesAt: 0 }));

  expect(liveAgeMs(10)).toBe(null);
  expect(isDeviceFresh(10)).toBe(false);
  expect(getFreshLatest(10)).toBe(null);
});

test('a recently-read device is fresh', () => {
  const fresh = entry({ device_id: 11, valuesAt: Date.now() - 1000 });
  _setLatest(11, fresh);

  expect(isDeviceFresh(11)).toBe(true);
  expect(getFreshLatest(11)).toBe(fresh);
});

test('a device past the staleness window is stale', () => {
  _setLatest(
    12,
    entry({ device_id: 12, valuesAt: Date.now() - getStaleMs() * 2 }),
  );

  expect(isDeviceFresh(12)).toBe(false);
  expect(getFreshLatest(12)).toBe(null);
});

test('a recent failed ATTEMPT does not refresh: stale is measured from last SUCCESS', () => {
  // The regression: timestamp (last attempt) is recent, but valuesAt (last
  // success) is hours old — the device must read as stale, not fresh.
  _setLatest(
    13,
    entry({
      device_id: 13,
      timestamp: Math.floor(Date.now() / 1000),
      valuesAt: Date.now() - getStaleMs() * 10,
    }),
  );

  expect(isDeviceFresh(13)).toBe(false);
  expect(getFreshLatest(13)).toBe(null);
});
