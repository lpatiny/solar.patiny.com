import { db } from '../db/Database.ts';

/** Settings-table key for the live Marstek poll interval (ms). */
export const POLL_INTERVAL_SETTING = 'marstek_poll_interval_ms';

/**
 * Default live poll interval (ms) when the setting is unset. Each Marstek is
 * queried over UDP this often. The Marstek Open API floor is ≤1 query/10s per
 * device, and that whole budget is shared with the strategy loop's command
 * writes (both go through the same per-device UDP queue). A slower cadence frees
 * more admission slots for command writes and is gentler on the ESP32 (which can
 * crash under too-frequent queries); SOC changes slowly enough that a minute-
 * scale display cadence is imperceptible. Tunable live via {@link POLL_INTERVAL_SETTING}.
 */
export const DEFAULT_POLL_INTERVAL_MS = 60_000;

/**
 * Floor for the configurable poll interval (ms). Keeps reads comfortably above
 * the 10s hardware floor and preserves a free admission slot for command writes,
 * so the setting can never be turned down to a rate that starves command writes
 * or breaches the API limit.
 */
export const MIN_POLL_INTERVAL_MS = 20_000;

/**
 * Cap on the per-device poll backoff (ms). A device that keeps failing is polled
 * no faster than this — so an unresponsive/crashed Marstek (or a struggling
 * ESP32 that our polling rate itself knocks over) is left alone instead of being
 * hammered with reads plus failure-triggered discovery. The first successful poll
 * resets the cadence back to the configured interval.
 */
export const MAX_POLL_BACKOFF_MS = 5 * 60_000;

/**
 * The effective live poll interval (ms): the configured value, clamped up to
 * {@link MIN_POLL_INTERVAL_MS}, falling back to {@link DEFAULT_POLL_INTERVAL_MS}.
 * Read fresh each cycle so a settings change takes effect without a restart.
 * @returns the poll interval in ms
 */
export function getPollIntervalMs(): number {
  const raw = db.getSetting(POLL_INTERVAL_SETTING);
  const value = raw === null ? DEFAULT_POLL_INTERVAL_MS : Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_POLL_INTERVAL_MS;
  return Math.max(MIN_POLL_INTERVAL_MS, value);
}

/**
 * Telemetry older than this (ms) is treated as stale: the control strategy must
 * not act on it (it would drive a battery blind, e.g. discharging past its
 * floor). Four configured intervals — long enough to ride out a transient, short
 * enough that an arbitrarily old SOC never keeps a device eligible.
 * @returns the staleness threshold in ms
 */
export function getStaleMs(): number {
  return 4 * getPollIntervalMs();
}

/**
 * The poll delay (ms) for a given consecutive-failure count: the base cadence
 * when healthy, doubling per failure, capped at {@link MAX_POLL_BACKOFF_MS}.
 * Pure, so it is unit-tested directly.
 * @param failures - consecutive failed polls (0 = healthy)
 * @param baseMs - the configured base poll interval (ms)
 * @returns the delay in ms until the next poll
 */
export function pollDelayForFailures(failures: number, baseMs: number): number {
  if (failures <= 0) return baseMs;
  return Math.min(baseMs * 2 ** failures, MAX_POLL_BACKOFF_MS);
}
