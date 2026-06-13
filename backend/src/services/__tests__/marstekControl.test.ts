/* eslint-disable camelcase -- Open API wire fields are snake_case */
import type { Socket } from 'node:dgram';
import { createSocket } from 'node:dgram';

import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';

import {
  MAX_DISCHARGE_SECONDS,
  setMarstekUdpManual,
  setMarstekUdpSchedule,
  weekSetFromDays,
} from '../marstekControl.ts';
import {
  MAX_CHARGE_POWER_W,
  MAX_DISCHARGE_POWER_W,
  MAX_SCHEDULE_SLOTS,
} from '../marstekRegisters.ts';
import { _setUdpTiming } from '../marstekUdpTransport.ts';

// Every ES.SetMode params object the fake device received, in arrival order.
let setModeCalls: Array<Record<string, unknown>>;
let device: Socket;
let port: number;

beforeAll(async () => {
  _setUdpTiming({ minIntervalMs: 5, timeoutMs: 1000 });
  device = createSocket('udp4');
  device.on('message', (msg, rinfo) => {
    const request = JSON.parse(msg.toString());
    if (request.method === 'ES.SetMode') setModeCalls.push(request.params);
    device.send(
      JSON.stringify({
        id: request.id,
        src: 'VenusE-test',
        result: { id: 0, set_result: true },
      }),
      rinfo.port,
      rinfo.address,
    );
  });
  await new Promise<void>((resolve) => {
    device.bind(0, '127.0.0.1', () => {
      port = device.address().port;
      resolve();
    });
  });
});

beforeEach(() => {
  setModeCalls = [];
});

afterAll(() => {
  device.close();
});

test('weekSetFromDays maps weekdays to the bitmask, empty means all', () => {
  expect(weekSetFromDays(['Mon', 'Wed', 'Fri'])).toBe(21);
  expect(weekSetFromDays(['Sun'])).toBe(64);
  expect(weekSetFromDays([])).toBe(127);
  expect(
    weekSetFromDays(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']),
  ).toBe(127);
});

test('discharge commands Passive mode with a positive power and countdown', async () => {
  const ok = await setMarstekUdpManual(
    { host: '127.0.0.1', port },
    { action: 'discharge', powerW: 600, durationS: 1800 },
  );

  expect(ok).toBe(true);
  expect(setModeCalls).toStrictEqual([
    {
      id: 0,
      config: { mode: 'Passive', passive_cfg: { power: 600, cd_time: 1800 } },
    },
  ]);
});

test('stop commands a disabled full-day Manual slot', async () => {
  const ok = await setMarstekUdpManual(
    { host: '127.0.0.1', port },
    { action: 'stop' },
  );

  expect(ok).toBe(true);
  expect(setModeCalls).toStrictEqual([
    {
      id: 0,
      config: {
        mode: 'Manual',
        manual_cfg: {
          time_num: 0,
          start_time: '00:00',
          end_time: '23:59',
          week_set: 127,
          power: 0,
          enable: 0,
        },
      },
    },
  ]);
});

test('schedule pushes one Manual slot per entry with signed power and week_set', async () => {
  const results = await setMarstekUdpSchedule({ host: '127.0.0.1', port }, [
    {
      startTime: '02:00',
      endTime: '06:00',
      days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      action: 'charge',
      powerW: 800,
    },
    {
      startTime: '18:00',
      endTime: '22:00',
      days: [],
      action: 'discharge',
      powerW: 500,
    },
  ]);

  expect(results).toStrictEqual([true, true]);
  expect(setModeCalls).toStrictEqual([
    {
      id: 0,
      config: {
        mode: 'Manual',
        manual_cfg: {
          time_num: 0,
          start_time: '02:00',
          end_time: '06:00',
          week_set: 31,
          power: -800,
          enable: 1,
        },
      },
    },
    {
      id: 0,
      config: {
        mode: 'Manual',
        manual_cfg: {
          time_num: 1,
          start_time: '18:00',
          end_time: '22:00',
          week_set: 127,
          power: 500,
          enable: 1,
        },
      },
    },
  ]);
});

test('schedule rejects a malformed time before sending anything', async () => {
  await expect(
    setMarstekUdpSchedule({ host: '127.0.0.1', port }, [
      {
        startTime: '2:00',
        endTime: '06:00',
        days: [],
        action: 'charge',
        powerW: 800,
      },
    ]),
  ).rejects.toThrow('slot 0: start/end must be "HH:MM" (24 h)');
});

test('schedule rejects more than the slot limit', async () => {
  const slots = Array.from({ length: MAX_SCHEDULE_SLOTS + 1 }, () => ({
    startTime: '00:00',
    endTime: '01:00',
    days: [],
    action: 'charge' as const,
    powerW: 100,
  }));

  await expect(
    setMarstekUdpSchedule({ host: '127.0.0.1', port }, slots.slice()),
  ).rejects.toThrow(`a schedule may not exceed ${MAX_SCHEDULE_SLOTS} slots`);
});

test('rejects a discharge power above the hard cap', async () => {
  await expect(
    setMarstekUdpManual(
      { host: '127.0.0.1', port },
      { action: 'discharge', powerW: MAX_DISCHARGE_POWER_W + 1 },
    ),
  ).rejects.toThrow(
    `power must be an integer between 0 and ${MAX_DISCHARGE_POWER_W} W`,
  );
});

test('rejects a discharge duration above the ceiling', async () => {
  await expect(
    setMarstekUdpManual(
      { host: '127.0.0.1', port },
      {
        action: 'discharge',
        powerW: 500,
        durationS: MAX_DISCHARGE_SECONDS + 1,
      },
    ),
  ).rejects.toThrow(
    `discharge duration must be an integer between 1 and ${MAX_DISCHARGE_SECONDS} s`,
  );
});

test('rejects a charge power above the hard cap', async () => {
  await expect(
    setMarstekUdpManual(
      { host: '127.0.0.1', port },
      { action: 'charge', powerW: MAX_CHARGE_POWER_W + 1 },
    ),
  ).rejects.toThrow(
    `power must be an integer between 0 and ${MAX_CHARGE_POWER_W} W`,
  );
});
