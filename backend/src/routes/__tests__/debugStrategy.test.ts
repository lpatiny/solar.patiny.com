import { expect, test } from 'vitest';

import { buildApp } from '../../app.ts';

test('GET /api/debug/strategy returns the live decision snapshot', async () => {
  const app = await buildApp();
  const response = await app.inject({
    method: 'GET',
    url: '/api/debug/strategy',
  });

  expect(response.statusCode).toBe(200);
  const body = response.json();
  // No poller runs in the test, so there is no fresh inverter reading: the
  // snapshot must report that plainly rather than fabricating a decision.
  expect(body.reading.present).toBe(false);
  expect(body.phase).toBe(null);
  expect(body.diagnostics).toBe(null);
  expect(body.config.mode).toBe(body.mode);
  expect(Array.isArray(body.devices)).toBe(true);
  expect(body.notes).toContain(
    'inverter reading is missing — the loop holds and sends nothing this cycle.',
  );

  await app.close();
});
