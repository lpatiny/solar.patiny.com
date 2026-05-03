/* eslint-disable camelcase, @typescript-eslint/naming-convention -- DB and Fronius fields use snake_case */
import { db } from '../db/Database.ts';
import type { RealtimeReading } from '../types.ts';

import { fetchPowerFlow } from './fronius.ts';
import { syncRecentDaysFromReadings } from './localStats.ts';
import { closeModbusConnections, readModbusData } from './modbusReader.ts';
import { syncRecentDays } from './solarweb.ts';

interface Logger {
  info: (msg: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 10_000);
const STALE_THRESHOLD_MS = 30_000;
const MODBUS_ENABLED = process.env.MODBUS_ENABLED === 'true';

let currentReading: RealtimeReading | null = null;
let lastPollTime = 0;
let modbusLastError: string | null = null;
let lastValidSoc: number | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let solarWebTimer: ReturnType<typeof setInterval> | null = null;
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

    currentReading = {
      ...rest,
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
      battery_charging_w: modbus?.battery_charging_w ?? null,
      battery_discharging_w: modbus?.battery_discharging_w ?? null,
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
      modbus?.battery_charging_w ?? null,
      modbus?.battery_discharging_w ?? null,
      modbus?.meter_power_w ?? null,
    );
  } catch (error) {
    log.error(error, '[poller] Fronius poll failed');
  }
}

export function startPoller(logger: Logger): void {
  log = logger;
  log.info(
    `[poller] Starting — REST every ${POLL_INTERVAL_MS / 1000}s, Modbus ${MODBUS_ENABLED ? 'enabled' : 'disabled'}`,
  );
  void poll();
  pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
  syncRecentDaysFromReadings();
  void syncRecentDays();
  solarWebTimer = setInterval(
    () => {
      syncRecentDaysFromReadings();
      void syncRecentDays();
    },
    60 * 60 * 1000,
  );
}

export function stopPoller(): void {
  if (pollTimer) clearInterval(pollTimer);
  if (solarWebTimer) clearInterval(solarWebTimer);
  closeModbusConnections();
}
