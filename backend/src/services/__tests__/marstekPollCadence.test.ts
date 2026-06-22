import { expect, test } from 'vitest';

import {
  MAX_POLL_BACKOFF_MS,
  pollDelayForFailures,
} from '../marstekPollCadence.ts';

const BASE = 60_000;

test('a healthy device polls at the base cadence', () => {
  expect(pollDelayForFailures(0, BASE)).toBe(BASE);
  expect(pollDelayForFailures(-1, BASE)).toBe(BASE);
});

test('consecutive failures double the poll delay', () => {
  expect(pollDelayForFailures(1, BASE)).toBe(120_000);
  expect(pollDelayForFailures(2, BASE)).toBe(240_000);
});

test('the backoff is capped so a dead device is left alone', () => {
  // 60s * 2^3 = 480s would exceed the 5 min cap.
  expect(pollDelayForFailures(3, BASE)).toBe(MAX_POLL_BACKOFF_MS);
  expect(pollDelayForFailures(10, BASE)).toBe(MAX_POLL_BACKOFF_MS);
});

test('the backoff base scales with the configured interval', () => {
  expect(pollDelayForFailures(0, 30_000)).toBe(30_000);
  expect(pollDelayForFailures(1, 30_000)).toBe(60_000);
});
