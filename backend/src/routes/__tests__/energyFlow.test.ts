import { expect, test } from 'vitest';

import { buildApp } from '../../app.ts';

// No poller runs in the test process, so there is no reading to serve. That is
// enough to prove both routes are registered and their schemas compile — a
// malformed TypeBox schema throws at registration, not at request time.

test('GET /api/energy-flow is registered and reports no reading yet', async () => {
  const app = await buildApp();
  const response = await app.inject({ method: 'GET', url: '/api/energy-flow' });

  expect(response.statusCode).toBe(503);
  expect(response.json()).toStrictEqual({
    error: 'No data yet — check Fronius connectivity',
  });

  await app.close();
});

test('GET /api/energy-flow/compact is registered and reports no reading yet', async () => {
  const app = await buildApp();
  const response = await app.inject({
    method: 'GET',
    url: '/api/energy-flow/compact',
  });

  expect(response.statusCode).toBe(503);
  expect(response.json()).toStrictEqual({
    error: 'No data yet — check Fronius connectivity',
  });

  await app.close();
});
