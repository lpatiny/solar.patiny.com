import { db } from '../db/Database.ts';
import { withTimeout } from '../utils/withTimeout.ts';

import { LIVE_STALE_MS, getLatest } from './batteryPoller.ts';
import type { ManualAction } from './marstekControl.ts';
import { setMarstekUdpManual } from './marstekControl.ts';
import type { MarstekValues } from './marstekRegisters.ts';
import { getCurrentReading } from './poller.ts';
import type { StrategyMode } from './strategyConfig.ts';
import { readStrategyConfig } from './strategyConfig.ts';
import type { DeviceDecision, Phase } from './strategyDecide.ts';
import { decide } from './strategyDecide.ts';

interface Logger {
  info: (msg: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

/** Don't re-issue a charge setpoint unless it moves by more than this (W). */
const SETPOINT_DEADBAND_W = 50;
/**
 * Self-expiring countdown for a discharge command (s). This is the fail-safe: if
 * the loop ever stops delivering commands (process down, UDP queue saturated),
 * the battery STOPS discharging this many seconds after the last command instead
 * of dumping into the BYD/grid. Must comfortably exceed {@link DISCHARGE_REFRESH_MS}
 * plus a missed cycle and the {@link APPLY_TIMEOUT_MS} write latency, so a healthy
 * loop always renews it before it expires.
 */
const DISCHARGE_CD_S = 150;
/** Refresh a held discharge command once it is older than this (ms). */
const DISCHARGE_REFRESH_MS = 60_000;
/**
 * Abandon a command write that cannot drain within this window (ms). The
 * per-device UDP queue paces requests ≥10s apart, so a healthy write lands in
 * ≤~14s; anything beyond this means the queue is saturated. Abandoning keeps the
 * control loop period bounded (and its status fresh) instead of letting it grow
 * to the full backlog depth — the un-confirmed write is simply retried next cycle.
 */
const APPLY_TIMEOUT_MS = 20_000;

/** In-memory snapshot of the most recent control cycle, for the API/UI. */
export interface StrategyStatus {
  enabled: boolean;
  phase: Phase;
  timestamp: number;
  productionW: number | null;
  gridInjectionW: number | null;
  devices: DeviceDecision[];
  error: string | null;
}

interface CommandState {
  action: ManualAction;
  powerW: number;
  sentAt: number;
}

const lastCommand = new Map<number, CommandState>();
let timer: ReturnType<typeof setTimeout> | null = null;
let lastMode: StrategyMode = 'off';
let status: StrategyStatus = {
  enabled: false,
  phase: 'off',
  timestamp: 0,
  productionW: null,
  gridInjectionW: null,
  devices: [],
  error: null,
};
let log: Logger = {
  info: (msg) => process.stdout.write(`${msg}\n`),
  error: (obj, msg) => process.stderr.write(`${msg ?? String(obj)}\n`),
};

/**
 * The device's most recent snapshot, but only if it was read recently enough to
 * act on. Stale telemetry (a string of failed polls) returns null so the strategy
 * treats the device as unknown rather than steering it blind on old numbers.
 */
function freshValues(deviceId: number): MarstekValues | null {
  const entry = getLatest(deviceId);
  if (!entry || entry.valuesAt === 0) return null;
  if (Date.now() - entry.valuesAt > LIVE_STALE_MS) return null;
  return entry.values;
}

function chargingNow(deviceId: number): number {
  const ac = freshValues(deviceId)?.ac_power_w ?? null;
  return ac !== null && ac < 0 ? -ac : 0;
}

function dischargingNow(deviceId: number): number {
  const ac = freshValues(deviceId)?.ac_power_w ?? null;
  return ac !== null && ac > 0 ? ac : 0;
}

function socOf(deviceId: number): number | null {
  return freshValues(deviceId)?.soc_pct ?? null;
}

function shouldSend(decision: DeviceDecision, now: number): boolean {
  const prev = lastCommand.get(decision.deviceId);
  if (prev?.action !== decision.action) return true;
  if (decision.action === 'discharge') {
    return (
      Math.abs(decision.powerW - prev.powerW) > SETPOINT_DEADBAND_W ||
      now - prev.sentAt > DISCHARGE_REFRESH_MS
    );
  }
  if (decision.action === 'charge') {
    return Math.abs(decision.powerW - prev.powerW) > SETPOINT_DEADBAND_W;
  }
  return false;
}

async function apply(
  device: { id: number; host: string; port: number },
  decision: DeviceDecision,
  now: number,
): Promise<void> {
  if (!shouldSend(decision, now)) return;
  const confirmed = await setMarstekUdpManual(
    { host: device.host, port: device.port },
    {
      action: decision.action,
      powerW: decision.powerW,
      durationS: decision.action === 'discharge' ? DISCHARGE_CD_S : undefined,
    },
  );
  if (!confirmed) {
    // The device did not confirm the change (set_result=false). Leave lastCommand
    // untouched so the deadband does not suppress an immediate retry next cycle,
    // and surface the rejection instead of reporting a phantom success.
    throw new Error(
      `device ${device.id} rejected ${decision.action} ${decision.powerW}W`,
    );
  }
  lastCommand.set(device.id, {
    action: decision.action,
    powerW: decision.powerW,
    sentAt: now,
  });
  decision.sent = true;
}

async function releaseControl(): Promise<void> {
  const devices = db
    .listDevices()
    .filter((d) => d.enabled && d.type === 'marstek');
  await Promise.allSettled(
    devices.map((device) =>
      setMarstekUdpManual(
        { host: device.host, port: device.port },
        { action: 'stop' },
      ),
    ),
  );
  lastCommand.clear();
}

async function runCycle(): Promise<void> {
  const config = readStrategyConfig();
  if (config.mode !== 'auto') {
    // Not auto-controlling. Release the batteries (send stop once) when leaving
    // auto, or when entering 'off' from manual — so a forced setpoint never
    // lingers. In 'manual' the operator owns the batteries, so otherwise leave
    // them untouched.
    const leavingAuto = lastMode === 'auto';
    const enteringOff = config.mode === 'off' && lastMode !== 'off';
    lastMode = config.mode;
    if (leavingAuto || enteringOff) {
      await releaseControl().catch((error: unknown) =>
        log.error(error, '[strategy] failed to release control'),
      );
      log.info(`[strategy] ${config.mode} — released battery control`);
    }
    status = { ...status, enabled: false, phase: 'off', error: null };
    return;
  }
  lastMode = 'auto';

  const reading = getCurrentReading();
  const now = Date.now();
  if (!reading || reading.is_stale) {
    status = {
      enabled: true,
      phase: 'stale',
      timestamp: Math.floor(now / 1000),
      productionW: reading?.production_w ?? null,
      gridInjectionW: reading?.grid_injection_w ?? null,
      devices: [],
      error: 'no fresh inverter reading',
    };
    return;
  }

  const devices = db
    .listDevices()
    .filter((d) => d.enabled && d.type === 'marstek');
  const withState = devices.map((d) => ({
    id: d.id,
    name: d.name,
    soc: socOf(d.id),
    chargingW: chargingNow(d.id),
    dischargingW: dischargingNow(d.id),
  }));
  const importW = Math.max(reading.grid_w, 0);
  const { phase, decisions } = decide(
    config,
    withState,
    reading.grid_injection_w,
    importW,
    reading.battery_w,
  );

  if (phase === 'charge' || phase === 'discharge') {
    const marstekDischarge = withState.reduce((s, d) => s + d.dischargingW, 0);
    const commanded = decisions.map((d) => d.powerW).join('+');
    log.info(
      `[strategy] ${phase}/${config.dischargeMode} pv=${Math.round(reading.production_w)}W ` +
        `grid=+${Math.round(importW)}/-${Math.round(reading.grid_injection_w)}W ` +
        `byd=${Math.round(reading.battery_w)}W marstekDis=${Math.round(marstekDischarge)}W ` +
        `cons=${Math.round(reading.consumption_w)}W -> ${commanded}W`,
    );
  }

  const byId = new Map(devices.map((d) => [d.id, d]));
  const outcomes = await Promise.allSettled(
    decisions.map((decision) => {
      const device = byId.get(decision.deviceId);
      if (!device) return Promise.resolve();
      // Bound how long a single command write can block the cycle: a saturated
      // UDP queue must not stretch the loop period (and stale its status) to the
      // backlog depth. A timed-out write leaves lastCommand untouched, so it is
      // retried next cycle once the queue drains.
      return withTimeout(
        apply(device, decision, now),
        APPLY_TIMEOUT_MS,
        `device ${decision.deviceId} command write timed out (UDP queue saturated)`,
      );
    }),
  );
  const notes = outcomes
    .filter((outcome) => outcome.status === 'rejected')
    .map((outcome) => String(outcome.reason));
  if (notes.length > 0) {
    log.error(notes.join('; '), '[strategy] command(s) not applied');
  }
  // A device with unknown SOC was dropped from charge/discharge eligibility; make
  // that visible so a silent non-action is diagnosable rather than a bare 'idle'.
  const unknownSoc = withState.filter((d) => d.soc === null);
  if (unknownSoc.length > 0) {
    notes.push(
      `stale/unknown telemetry: ${unknownSoc.map((d) => d.name).join(', ')}`,
    );
  }

  status = {
    enabled: true,
    phase,
    timestamp: Math.floor(now / 1000),
    productionW: reading.production_w,
    gridInjectionW: reading.grid_injection_w,
    devices: decisions,
    error: notes.length > 0 ? notes.join('; ') : null,
  };
}

function scheduleNext(intervalMs: number): void {
  timer = setTimeout(() => {
    void runCycle()
      .catch((error: unknown) => {
        log.error(error, '[strategy] control cycle failed');
        status = { ...status, error: String(error) };
      })
      .finally(() => scheduleNext(readStrategyConfig().intervalMs));
  }, intervalMs);
}

/**
 * Start the autonomous battery control loop. It reschedules itself after each
 * cycle, picking up interval changes from the settings table.
 * @param logger - logger for cycle errors
 */
export function startBatteryStrategy(logger: Logger): void {
  log = logger;
  const config = readStrategyConfig();
  log.info(
    `[strategy] Starting — mode ${config.mode}, every ${config.intervalMs / 1000}s`,
  );
  scheduleNext(config.intervalMs);
}

/** Stop the control loop. */
export function stopBatteryStrategy(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

/**
 * The most recent control-cycle snapshot, for the API and UI.
 * @returns the latest strategy status
 */
export function getStrategyStatus(): StrategyStatus {
  return status;
}
