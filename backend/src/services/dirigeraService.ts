/* eslint-disable camelcase, @typescript-eslint/naming-convention -- API/JSON fields use snake_case */
import { Agent, request } from 'undici';

import { db } from '../db/Database.ts';
import { computeUnavailableSensors } from './sensorAvailability.ts';

const DIRIGERA_HOST = process.env.DIRIGERA_HOST ?? '';
const DIRIGERA_TOKEN = process.env.DIRIGERA_TOKEN ?? '';
const POLL_INTERVAL_MS = Number(
  process.env.DIRIGERA_POLL_INTERVAL_MS ?? 60_000,
);
// How often a sample is written to history, independent of the (faster) live
// refresh. Defaults to 5 minutes.
const PERSIST_INTERVAL_MS = Number(
  process.env.DIRIGERA_PERSIST_INTERVAL_MS ?? 5 * 60_000,
);
const STALE_THRESHOLD_MS = 5 * 60_000;

// The DIRIGERA hub serves its local API over HTTPS with a self-signed
// certificate, so certificate verification must be disabled for this host. The
// dispatcher is scoped to the DIRIGERA requests only — it never affects the
// global fetch used for Fronius / SolarWeb / MeteoSwiss.
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

interface DirigeraAttributes {
  customName?: string;
  currentTemperature?: number | null;
  currentRH?: number | null;
  currentCO2?: number | null;
  currentPM25?: number | null;
}

interface DirigeraDevice {
  id: string;
  isReachable?: boolean;
  attributes?: DirigeraAttributes;
  room?: { name?: string } | null;
}

export interface TemperatureSensor {
  id: string;
  name: string;
  temperature_c: number;
  humidity_pct: number | null;
  co2_ppm: number | null;
  pm25_ugm3: number | null;
}

export interface TemperatureSnapshot {
  /** Unix seconds of the last successful poll (0 if never polled). */
  timestamp: number;
  is_stale: boolean;
  configured: boolean;
  sensors: TemperatureSensor[];
  /**
   * Known sensors (present in history) that the latest poll did not report as
   * reachable — offline or out of Thread range. Surfaced so the UI can show
   * them as "not available" instead of silently dropping the tile.
   */
  unavailable_sensors: Array<{ id: string; name: string }>;
}

interface Logger {
  info: (msg: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

let latestSensors: TemperatureSensor[] = [];
let lastPollAt = 0;
let lastPersistedAt = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let log: Logger = {
  info: (msg) => process.stdout.write(`${msg}\n`),
  error: (obj, msg) => process.stderr.write(`${msg ?? String(obj)}\n`),
};

/** Whether the DIRIGERA hub host and access token are both configured. */
export function isConfigured(): boolean {
  return DIRIGERA_HOST !== '' && DIRIGERA_TOKEN !== '';
}

function sensorName(device: DirigeraDevice): string {
  const custom = device.attributes?.customName?.trim();
  if (custom) return custom;
  const room = device.room?.name?.trim();
  if (room) return room;
  return device.id;
}

function numeric(value: number | null | undefined): number | null {
  return typeof value === 'number' ? value : null;
}

function extractTemperatures(devices: DirigeraDevice[]): TemperatureSensor[] {
  const sensors: TemperatureSensor[] = [];
  for (const device of devices) {
    // An offline sensor lingers in /v1/devices with isReachable=false and stale
    // attributes — treat it as absent so it surfaces as unavailable instead.
    if (device.isReachable === false) continue;
    const temperature = device.attributes?.currentTemperature;
    if (typeof temperature !== 'number') continue;
    sensors.push({
      id: device.id,
      name: sensorName(device),
      temperature_c: temperature,
      humidity_pct: numeric(device.attributes?.currentRH),
      co2_ppm: numeric(device.attributes?.currentCO2),
      pm25_ugm3: numeric(device.attributes?.currentPM25),
    });
  }
  sensors.sort((a, b) => a.name.localeCompare(b.name));
  return sensors;
}

async function fetchDevices(): Promise<DirigeraDevice[]> {
  // Use undici's own request (not the global fetch) so the Agent dispatcher
  // types stay consistent and to avoid the self-signed cert being verified.
  const { statusCode, body } = await request(
    `https://${DIRIGERA_HOST}:8443/v1/devices`,
    {
      dispatcher: insecureAgent,
      headers: { authorization: `Bearer ${DIRIGERA_TOKEN}` },
    },
  );
  if (statusCode !== 200) {
    await body.dump();
    throw new Error(`DIRIGERA API error: ${statusCode}`);
  }
  return (await body.json()) as DirigeraDevice[];
}

/**
 * Latest cached temperature readings, served from memory.
 * @returns the temperature snapshot, with `is_stale` true when the last
 * successful poll is older than the stale threshold (or never happened).
 */
export function getTemperatures(): TemperatureSnapshot {
  return {
    timestamp: Math.floor(lastPollAt / 1000),
    is_stale: lastPollAt === 0 || Date.now() - lastPollAt > STALE_THRESHOLD_MS,
    configured: isConfigured(),
    sensors: latestSensors,
    unavailable_sensors: computeUnavailableSensors(
      db.listTemperatureSensors(),
      latestSensors,
    ),
  };
}

async function poll(): Promise<void> {
  try {
    const devices = await fetchDevices();
    latestSensors = extractTemperatures(devices);
    lastPollAt = Date.now();

    if (
      latestSensors.length > 0 &&
      lastPollAt - lastPersistedAt >= PERSIST_INTERVAL_MS
    ) {
      db.recordTemperatures(Math.floor(lastPollAt / 1000), latestSensors);
      lastPersistedAt = lastPollAt;
    }
  } catch (error) {
    log.error(error, '[dirigera] poll failed');
  }
}

/**
 * Start polling the DIRIGERA hub for temperature sensors. No-op (with a log
 * line) when the host/token are not configured.
 * @param logger - logger for poll errors
 */
export function startDirigeraPolling(logger: Logger): void {
  log = logger;
  if (!isConfigured()) {
    log.info(
      '[dirigera] DIRIGERA_HOST/DIRIGERA_TOKEN not set — temperature polling disabled',
    );
    return;
  }
  log.info(
    `[dirigera] Starting — polling temperatures every ${POLL_INTERVAL_MS / 1000}s`,
  );
  void poll();
  pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
}

/** Stop the DIRIGERA polling timer. */
export function stopDirigeraPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
