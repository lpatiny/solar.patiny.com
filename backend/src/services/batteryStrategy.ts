import { db } from '../db/Database.ts';

import { getLatest } from './batteryPoller.ts';
import type { ManualAction } from './marstekControl.ts';
import { setMarstekUdpManual } from './marstekControl.ts';
import { getCurrentReading } from './poller.ts';
import type { StrategyConfig } from './strategyConfig.ts';
import { readStrategyConfig } from './strategyConfig.ts';

interface Logger {
  info: (msg: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

/** Don't re-issue a charge setpoint unless it moves by more than this (W). */
const SETPOINT_DEADBAND_W = 50;
/** Minimum meaningful charge command; below it the battery is simply stopped. */
export const MIN_CHARGE_W = 50;
/** Minimum meaningful discharge command; below it the battery is simply stopped. */
export const MIN_DISCHARGE_W = 50;
/** Self-expiring countdown for a discharge command (s); the loop refreshes it. */
const DISCHARGE_CD_S = 600;
/** Refresh a held discharge command once it is older than this (ms). */
const DISCHARGE_REFRESH_MS = 240_000;

type Phase = 'charge' | 'discharge' | 'idle' | 'off' | 'stale';

/** What the loop decided for one device this cycle. */
export interface DeviceDecision {
  deviceId: number;
  name: string;
  socPct: number | null;
  action: ManualAction;
  powerW: number;
  sent: boolean;
}

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
let lastEnabled = false;
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

function chargingNow(deviceId: number): number {
  const ac = getLatest(deviceId)?.values?.ac_power_w ?? null;
  return ac !== null && ac < 0 ? -ac : 0;
}

function dischargingNow(deviceId: number): number {
  const ac = getLatest(deviceId)?.values?.ac_power_w ?? null;
  return ac !== null && ac > 0 ? ac : 0;
}

function socOf(deviceId: number): number | null {
  return getLatest(deviceId)?.values?.soc_pct ?? null;
}

/** A device's identity and current state, as fed to {@link decide}. */
export interface DeviceState {
  id: number;
  name: string;
  /** Current state of charge (%), or null if unknown. */
  soc: number | null;
  /** Charge power the device is currently drawing (W, ≥0). */
  chargingW: number;
  /** Discharge power the device is currently delivering (W, ≥0). */
  dischargingW: number;
}

/**
 * Decide each enabled Marstek device's charge/discharge action for this cycle.
 * Charging takes priority: it holds grid injection at the target by storing only
 * the surplus above it (capped per battery). When there is no surplus to store,
 * the loop discharges to cover house load — capped per battery — down to the
 * floor.
 *
 * Cover-consumption mode (`config.dischargeCoverConsumption`, the Marstek-priority
 * behavior) makes the Marstek batteries supply the house load before the BYD does.
 * The Fronius meter cannot see the Marstek as a source, so a Marstek discharge
 * looks like reduced import: the meter reports `consumptionW = trueLoad −
 * marstekDischarge`. The true load is therefore reconstructed as `consumptionW +
 * totalDischarging`, and PV production is subtracted so the batteries cover only
 * the deficit and never export the panels. There is deliberately NO grid-balance
 * clamp: Marstek alone covers at most the load, so it can never feed the grid by
 * itself — only the BYD can, transiently, until it backs off, which is exactly how
 * Marstek takes priority and the BYD empties only for what Marstek cannot cover
 * (load above the per-battery cap, or once Marstek hits its floor).
 *
 * The conservative net-grid mode (flag off) instead only offsets net grid import
 * (`totalDischarging + import − injection`), so any other source covering the load
 * — the BYD — wins. Pure function of its inputs so it can be unit-tested.
 * @param config - the resolved strategy configuration
 * @param devices - the enabled Marstek devices with their current state
 * @param injectionW - current grid injection / export (W, ≥0)
 * @param importW - current grid import (W, ≥0)
 * @param consumptionW - Fronius-reported house consumption (W); equals the true
 * house load minus the Marstek discharge the meter cannot see. Only used in
 * cover-consumption mode.
 * @param productionW - current PV production (W); subtracted in cover-consumption
 * mode so only the post-PV deficit is covered.
 * @returns the phase and per-device decisions
 */
export function decide(
  config: StrategyConfig,
  devices: DeviceState[],
  injectionW: number,
  importW: number,
  consumptionW = 0,
  productionW = 0,
): { phase: Phase; decisions: DeviceDecision[] } {
  const chargeEligible = devices.filter(
    (device) => device.soc !== null && device.soc < config.chargeCeilingPct,
  );
  let totalCharging = 0;
  let totalDischarging = 0;
  for (const device of devices) {
    totalCharging += device.chargingW;
    totalDischarging += device.dischargingW;
  }

  // Charge from solar surplus (priority). Add back what is already being charged
  // to reconstruct the true exportable surplus before the batteries absorbed it.
  const surplus = injectionW + totalCharging;
  const chargeCap = config.chargeMaxW * chargeEligible.length;
  const desiredCharge = Math.max(
    0,
    Math.min(surplus - config.injectTargetW, chargeCap),
  );
  const perCharge =
    chargeEligible.length > 0
      ? Math.min(
          config.chargeMaxW,
          Math.round(desiredCharge / chargeEligible.length),
        )
      : 0;
  if (perCharge >= MIN_CHARGE_W) {
    const decisions = devices.map<DeviceDecision>((device) => {
      const canCharge =
        device.soc !== null && device.soc < config.chargeCeilingPct;
      return {
        deviceId: device.id,
        name: device.name,
        socPct: device.soc,
        action: canCharge ? 'charge' : 'stop',
        powerW: canCharge ? perCharge : 0,
        sent: false,
      };
    });
    return { phase: 'charge', decisions };
  }

  // Otherwise cover the house load. In cover-consumption (Marstek-priority) mode
  // the target is the reconstructed post-PV deficit: trueLoad − PV, where
  // trueLoad = consumptionW + the Marstek discharge the meter cannot see. Marstek
  // alone never exceeds the load, so it cannot export by itself; the BYD empties
  // only for what Marstek cannot cover. In net-grid mode the target is just the
  // net grid import (plus what the batteries already supply), so the BYD wins.
  const dischargeEligible = devices.filter(
    (device) => device.soc !== null && device.soc > config.dischargeFloorPct,
  );
  const target = config.dischargeCoverConsumption
    ? consumptionW + totalDischarging - productionW
    : totalDischarging + importW - injectionW;
  const dischargeCap = config.dischargeMaxW * dischargeEligible.length;
  const desiredDischarge = Math.max(0, Math.min(target, dischargeCap));
  const perDischarge =
    dischargeEligible.length > 0
      ? Math.min(
          config.dischargeMaxW,
          Math.round(desiredDischarge / dischargeEligible.length),
        )
      : 0;
  const discharging = perDischarge >= MIN_DISCHARGE_W;

  const decisions = devices.map<DeviceDecision>((device) => {
    const canDischarge =
      device.soc !== null &&
      device.soc > config.dischargeFloorPct &&
      discharging;
    return {
      deviceId: device.id,
      name: device.name,
      socPct: device.soc,
      action: canDischarge ? 'discharge' : 'stop',
      powerW: canDischarge ? perDischarge : 0,
      sent: false,
    };
  });
  return { phase: discharging ? 'discharge' : 'idle', decisions };
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
  await setMarstekUdpManual(
    { host: device.host, port: device.port },
    {
      action: decision.action,
      powerW: decision.powerW,
      durationS: decision.action === 'discharge' ? DISCHARGE_CD_S : undefined,
    },
  );
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
  if (!config.enabled) {
    const wasEnabled = lastEnabled;
    lastEnabled = false;
    if (wasEnabled) {
      await releaseControl().catch((error: unknown) =>
        log.error(error, '[strategy] failed to release control on disable'),
      );
      log.info('[strategy] disabled — released battery control');
    }
    status = { ...status, enabled: false, phase: 'off', error: null };
    return;
  }
  lastEnabled = true;

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
    Math.max(reading.consumption_w, 0),
    Math.max(reading.production_w, 0),
  );

  const byId = new Map(devices.map((d) => [d.id, d]));
  await Promise.allSettled(
    decisions.map((decision) => {
      const device = byId.get(decision.deviceId);
      return device ? apply(device, decision, now) : Promise.resolve();
    }),
  );

  status = {
    enabled: true,
    phase,
    timestamp: Math.floor(now / 1000),
    productionW: reading.production_w,
    gridInjectionW: reading.grid_injection_w,
    devices: decisions,
    error: null,
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
    `[strategy] Starting — ${config.enabled ? 'enabled' : 'disabled'}, every ${config.intervalMs / 1000}s`,
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
