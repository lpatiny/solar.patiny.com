import type { ConfigData } from '../../HomePage.tsx';

/**
 * Persist a partial configuration update via `PATCH /api/config`.
 * Throws when the request fails so callers can surface the error.
 * @param update - The config fields to change, keyed by their snake_case backend names.
 * @returns The full, updated configuration returned by the backend.
 */
export async function patchConfig(
  update: Record<string, unknown>,
): Promise<ConfigData> {
  const res = await fetch('/api/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ConfigData;
}
