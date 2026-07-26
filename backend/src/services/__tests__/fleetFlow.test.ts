import { expect, test } from 'vitest';

import { resolveFleetFlow } from '../fleetFlow.ts';

const TRUST_MS = 150_000;
const NOW = 1_000_000;

test('telemetry newer than the command is authoritative', () => {
  expect(
    resolveFleetFlow(
      { valuesAt: NOW - 5000, acPowerW: 380 },
      { action: 'discharge', powerW: 400, sentAt: NOW - 30_000 },
      NOW,
      TRUST_MS,
    ),
  ).toStrictEqual({ chargingW: 0, dischargingW: 380 });
});

test('a command newer than the telemetry wins, because the reading cannot show it yet', () => {
  // The 60 s telemetry was taken before we commanded 400 W: reporting the old
  // 145 W would make the loop believe its command never landed.
  expect(
    resolveFleetFlow(
      { valuesAt: NOW - 51_000, acPowerW: 145 },
      { action: 'discharge', powerW: 400, sentAt: NOW - 30_000 },
      NOW,
      TRUST_MS,
    ),
  ).toStrictEqual({ chargingW: 0, dischargingW: 400 });
});

test('a charge command maps to charge power', () => {
  expect(
    resolveFleetFlow(
      { valuesAt: NOW - 51_000, acPowerW: 0 },
      { action: 'charge', powerW: 700, sentAt: NOW - 10_000 },
      NOW,
      TRUST_MS,
    ),
  ).toStrictEqual({ chargingW: 700, dischargingW: 0 });
});

test('a stop command means no flow at all', () => {
  expect(
    resolveFleetFlow(
      { valuesAt: NOW - 51_000, acPowerW: 300 },
      { action: 'stop', powerW: 0, sentAt: NOW - 10_000 },
      NOW,
      TRUST_MS,
    ),
  ).toStrictEqual({ chargingW: 0, dischargingW: 0 });
});

test('trust in a command expires with the discharge countdown', () => {
  // Past the countdown the battery has stopped on its own, so the old reading
  // is authoritative again even though it predates the command.
  expect(
    resolveFleetFlow(
      { valuesAt: NOW - 200_000, acPowerW: 90 },
      { action: 'discharge', powerW: 400, sentAt: NOW - 160_000 },
      NOW,
      TRUST_MS,
    ),
  ).toStrictEqual({ chargingW: 0, dischargingW: 90 });
});

test('a live command still counts while the device is unreachable', () => {
  // Stale telemetry arrives as null; without the command the loop would read the
  // fleet as idle and re-cover load the batteries are already supplying.
  expect(
    resolveFleetFlow(
      null,
      { action: 'discharge', powerW: 400, sentAt: NOW - 20_000 },
      NOW,
      TRUST_MS,
    ),
  ).toStrictEqual({ chargingW: 0, dischargingW: 400 });
});

test('no command and no telemetry means no assumed flow', () => {
  expect(resolveFleetFlow(null, null, NOW, TRUST_MS)).toStrictEqual({
    chargingW: 0,
    dischargingW: 0,
  });
});

test('negative AC power reads as charging', () => {
  expect(
    resolveFleetFlow({ valuesAt: NOW, acPowerW: -260 }, null, NOW, TRUST_MS),
  ).toStrictEqual({ chargingW: 260, dischargingW: 0 });
});
