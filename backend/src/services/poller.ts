/* eslint-disable camelcase, @typescript-eslint/naming-convention -- DB and Fronius fields use snake_case */
import { db } from '../db/Database.ts';
import type { RealtimeReading } from '../types.ts';

import { getFreshLatest } from './batteryPoller.ts';
import { fetchPowerFlow } from './fronius.ts';
import { fetchStationReadings } from './meteoStationService.ts';
import { closeModbusConnections, readModbusData } from './modbusReader.ts';
import { syncRecentDays } from './solarweb.ts';
import { scrapeAllHistory, scrapeRecentDays } from './solarwebScraper.ts';
import { syncWeatherHistory, syncWeatherRecent } from './weatherSyncService.ts';

interface Logger {
  info: (msg: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5_000);
const STALE_THRESHOLD_MS = 30_000;
const MODBUS_ENABLED = process.env.MODBUS_ENABLED === 'true';
const WEATHER_INTERVAL_MS = 10 * 60 * 1000;

let currentReading: RealtimeReading | null = null;
let lastPollTime = 0;
let modbusLastError: string | null = null;
let lastValidSoc: number | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let solarWebTimer: ReturnType<typeof setInterval> | null = null;
let weatherTimer: ReturnType<typeof setInterval> | null = null;
let log: Logger = {
  info: (msg) => process.stdout.write(`${msg}\n`),
  error: (obj, msg) => process.stderr.write(`${msg ?? String(obj)}\n`),
};

export function getCurrentReading(): RealtimeReading | null {
  if (!currentReading) return null;
  const isStale = Date.now() - lastPollTime > STALE_THRESHOLD_MS;
  const modbus_status: RealtimeReading['modbus_status'] = !MODBUS_ENABLED
    ? 'disabled'
    : modbusLastError
      ? 'error'
      : 'ok';
  return {
    ...currentReading,
    is_stale: isStale,
    modbus_status,
    modbus_error: modbusLastError,
  };
}

/**
 * Sum the live Marstek AC power across enabled Marstek devices (discharge
 * positive, charge negative). Only FRESH telemetry is included — a device whose
 * last successful read has aged out is skipped, so an offline Marstek's stale
 * last-known power can never corrupt consumption_w. Returns null when no Marstek
 * device has a fresh reading, leaving consumption untouched.
 */
function sumMarstekNetW(): number | null {
  const devices = db
    .listDevices()
    .filter((device) => device.enabled && device.type === 'marstek');
  let sum: number | null = null;
  for (const device of devices) {
    const ac = getFreshLatest(device.id)?.values?.ac_power_w ?? null;
    if (ac !== null) sum = (sum ?? 0) + ac;
  }
  return sum;
}

async function poll(): Promise<void> {
  try {
    const [rest, modbus] = await Promise.all([
      fetchPowerFlow(),
      MODBUS_ENABLED
        ? readModbusData().catch((error: unknown) => {
            const msg = error instanceof Error ? error.message : String(error);
            modbusLastError = msg;
            log.error(error, `[poller] Modbus read failed: ${msg}`);
            return null;
          })
        : Promise.resolve(null),
    ]);

    if (modbus !== null) modbusLastError = null;

    const grid_injection_w = rest.grid_w < 0 ? -rest.grid_w : 0;
    const battery_soc = modbus?.battery_soc ?? rest.battery_soc;
    if (battery_soc !== null) lastValidSoc = battery_soc;

    // P_Akku: positive = discharging, negative = charging
    const battery_charging_w =
      modbus?.battery_charging_w ?? (rest.battery_w < 0 ? -rest.battery_w : 0);
    const battery_discharging_w =
      modbus?.battery_discharging_w ?? Math.max(rest.battery_w, 0);

    // The Fronius meter cannot see the plug-in Marstek, so its consumption_w is
    // wrong by exactly their net power: charging inflates it, discharging deflates
    // it. Fold in the live Marstek AC power (discharge positive) to recover the
    // true household load. null when no Marstek reports.
    const marstek_net_w = sumMarstekNetW();
    const true_consumption_w = rest.consumption_w + (marstek_net_w ?? 0);

    currentReading = {
      ...rest,
      consumption_w: true_consumption_w,
      marstek_net_w,
      battery_soc: lastValidSoc ?? 0,
      grid_injection_w,
      is_stale: false,
      modbus_status: !MODBUS_ENABLED ? 'disabled' : modbus ? 'ok' : 'error',
      modbus_error: modbusLastError,
      ac_power_w: modbus?.ac_power_w ?? null,
      voltage_a_v: modbus?.voltage_a_v ?? null,
      voltage_b_v: modbus?.voltage_b_v ?? null,
      voltage_c_v: modbus?.voltage_c_v ?? null,
      frequency_hz: modbus?.frequency_hz ?? null,
      pv1_power_w: modbus?.pv1_power_w ?? null,
      pv2_power_w: modbus?.pv2_power_w ?? null,
      battery_charging_w,
      battery_discharging_w,
      meter_power_w: modbus?.meter_power_w ?? null,
    };

    lastPollTime = Date.now();

    db.insertReading(
      rest.timestamp,
      rest.production_w,
      rest.grid_w,
      rest.battery_w,
      rest.consumption_w,
      battery_soc ?? 0,
      modbus?.ac_power_w ?? null,
      modbus?.voltage_a_v ?? null,
      modbus?.voltage_b_v ?? null,
      modbus?.voltage_c_v ?? null,
      modbus?.frequency_hz ?? null,
      modbus?.pv1_power_w ?? null,
      modbus?.pv2_power_w ?? null,
      battery_charging_w,
      battery_discharging_w,
      modbus?.meter_power_w ?? null,
      marstek_net_w,
    );
  } catch (error) {
    log.error(error, '[poller] Fronius poll failed');
  }
}

async function pollWeather(): Promise<void> {
  try {
    const readings = await fetchStationReadings();
    if (readings.length > 0) {
      db.upsertWeatherReadings(readings);
    }
  } catch (error) {
    log.error(error, '[poller] Weather poll failed');
  }
}

export function startPoller(logger: Logger): void {
  log = logger;
  log.info(
    `[poller] Starting — REST every ${POLL_INTERVAL_MS / 1000}s, Modbus ${MODBUS_ENABLED ? 'enabled' : 'disabled'}`,
  );
  void poll();
  pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
  void syncRecentDays();
  void scrapeRecentDays();
  // Fill any gaps left by downtime; scrapeAllHistory skips complete days so this is cheap
  void scrapeAllHistory();
  solarWebTimer = setInterval(
    () => {
      void syncRecentDays();
      void scrapeRecentDays();
    },
    60 * 60 * 1000,
  );
  void pollWeather();
  weatherTimer = setInterval(() => void pollWeather(), WEATHER_INTERVAL_MS);
  // Backfill all historical decades on startup, then sync recent window hourly to fill gaps
  void syncWeatherHistory();
  setInterval(() => void syncWeatherRecent(), 60 * 60 * 1000);
}

export function stopPoller(): void {
  if (pollTimer) clearInterval(pollTimer);
  if (solarWebTimer) clearInterval(solarWebTimer);
  if (weatherTimer) clearInterval(weatherTimer);
  closeModbusConnections();
}
