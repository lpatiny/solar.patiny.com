import { expect, test } from 'vitest';

import { withTimeout } from '../withTimeout.ts';

test('resolves with the value when the promise settles before the timeout', async () => {
  await expect(
    withTimeout(Promise.resolve(42), 1000, 'too slow'),
  ).resolves.toBe(42);
});

test('propagates the original rejection when it settles before the timeout', async () => {
  await expect(
    withTimeout(Promise.reject(new Error('boom')), 1000, 'too slow'),
  ).rejects.toThrow('boom');
});

test('rejects with the timeout message when the promise is too slow', async () => {
  const never = new Promise<number>(() => {
    // never settles — exercises the timeout branch
  });
  await expect(withTimeout(never, 10, 'queue saturated')).rejects.toThrow(
    'queue saturated',
  );
});
