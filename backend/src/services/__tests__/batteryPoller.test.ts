import { expect, test } from 'vitest';

import {
  LIVE_REFRESH_MS,
  MAX_POLL_BACKOFF_MS,
  pollDelayForFailures,
} from '../batteryPoller.ts';

test('a healthy device polls at the base cadence', () => {
  expect(pollDelayForFailures(0)).toBe(LIVE_REFRESH_MS);
  expect(pollDelayForFailures(-1)).toBe(LIVE_REFRESH_MS);
});

test('consecutive failures double the poll delay', () => {
  expect(pollDelayForFailures(1)).toBe(40_000);
  expect(pollDelayForFailures(2)).toBe(80_000);
  expect(pollDelayForFailures(3)).toBe(160_000);
});

test('the backoff is capped so a dead device is left alone', () => {
  // 20s * 2^4 = 320s would exceed the 5 min cap.
  expect(pollDelayForFailures(4)).toBe(MAX_POLL_BACKOFF_MS);
  expect(pollDelayForFailures(10)).toBe(MAX_POLL_BACKOFF_MS);
});
