import { db } from '../db/Database.ts';

import {
  LIVE_STALE_MS,
  getLatest,
  getPollFailures,
  nextPollDelay,
} from './batteryPoller.ts';
import type { LastCommandInfo } from './batteryStrategy.ts';
import { getLastCommands } from './batteryStrategy.ts';
import { getCurrentReading } from './poller.ts';
import type { StrategyConfig, StrategyMode } from './strategyConfig.ts';
import { readStrategyConfig } from './strategyConfig.ts';
import type { DeviceDecision, Phase } from './strategyDecide.ts';
import { decide } from './strategyDecide.ts';

/** One device's live telemetry, with freshness, exactly as the loop sees it. */
export interface DeviceDebug {
  id: number;
  name: string;
  host: string;
  port: number;
  /** Live AC power (W): negative = charging, positive = discharging; null if none. */
  acPowerW: number | null;
  /** Raw SOC from the latest snapshot (%), regardless of freshness. */
  rawSocPct: number | null;
  /** Wall-clock (ms) of the last SUCCESSFUL read; 0 = never read. */
  valuesAt: number;
  /** Age of that read (ms); null if never read. */
  ageMs: number | null;
  /** Whether telemetry is fresh enough for the strategy to act on. */
  fresh: boolean;
  /** SOC the strategy actually used this cycle (null when stale → device ignored). */
  usedSocPct: number | null;
  /** Charge power the strategy attributed to the device (W, ≥0). */
  usedChargingW: number;
  /** Discharge power the strategy attributed to the device (W, ≥0). */
  usedDischargingW: number;
  /** Last error from polling this device, if any. */
  pollError: string | null;
  /** Consecutive failed polls (0 = healthy); drives the poll backoff. */
  pollFailures: number;
  /** Delay (ms) until the next poll — grows while the device keeps failing. */
  nextPollMs: number;
}

/** The live inverter inputs the decision used (or would have used). */
export interface ReadingDebug {
  present: boolean;
  isStale: boolean;
  productionW: number | null;
  consumptionW: number | null;
  gridW: number | null;
  gridInjectionW: number | null;
  importW: number | null;
  bydBatteryW: number | null;
  marstekNetW: number | null;
}

/** A full, apply-nothing snapshot of the live strategy decision, for debugging. */
export interface StrategyDebug {
  now: number;
  mode: StrategyMode;
  config: StrategyConfig;
  reading: ReadingDebug;
  devices: DeviceDebug[];
  phase: Phase | null;
  decisions: DeviceDecision[];
  diagnostics: ReturnType<typeof decide>['diagnostics'] | null;
  lastCommands: LastCommandInfo[];
  /** Plain-language reasons the fleet is not charging/discharging right now. */
  notes: string[];
}

/**
 * Build the per-device live telemetry view, gating each value on freshness with
 * the exact same {@link LIVE_STALE_MS} window the control loop applies — so the
 * `used*` fields are precisely what {@link decide} is fed.
 */
function deviceDebugs(now: number): DeviceDebug[] {
  const marstek = db
    .listDevices()
    .filter((d) => d.enabled && d.type === 'marstek');
  return marstek.map((d) => {
    const entry = getLatest(d.id);
    const ageMs = entry && entry.valuesAt > 0 ? now - entry.valuesAt : null;
    const fresh = ageMs !== null && ageMs <= LIVE_STALE_MS;
    const ac = fresh ? (entry?.values?.ac_power_w ?? null) : null;
    return {
      id: d.id,
      name: d.name,
      host: d.host,
      port: d.port,
      acPowerW: entry?.values?.ac_power_w ?? null,
      rawSocPct: entry?.values?.soc_pct ?? null,
      valuesAt: entry?.valuesAt ?? 0,
      ageMs,
      fresh,
      usedSocPct: fresh ? (entry?.values?.soc_pct ?? null) : null,
      usedChargingW: ac !== null && ac < 0 ? -ac : 0,
      usedDischargingW: ac !== null && ac > 0 ? ac : 0,
      pollError: entry?.error ?? null,
      pollFailures: getPollFailures(d.id),
      nextPollMs: nextPollDelay(d.id),
    };
  });
}

/**
 * Recompute the strategy decision against the current live inputs WITHOUT sending
 * any command — the exact inputs and math {@link runCycle} would use, plus
 * per-device telemetry freshness and the last confirmed commands. This is the
 * single source of truth for "why is the battery not charging?": it answers it
 * from the same data the loop acts on, so the debug view can never drift from the
 * real decision.
 * @returns a full apply-nothing snapshot of the live decision
 */
export function getStrategyDebug(): StrategyDebug {
  const now = Date.now();
  const config = readStrategyConfig();
  const reading = getCurrentReading();
  const devices = deviceDebugs(now);
  const readingMissing = !reading || reading.is_stale;

  const notes: string[] = [];
  if (config.mode !== 'auto') {
    notes.push(
      `strategy mode is '${config.mode}', not 'auto' — the loop sends no commands; the batteries follow their own firmware (self-consumption).`,
    );
  }
  if (readingMissing) {
    notes.push(
      `inverter reading is ${reading ? 'stale' : 'missing'} — the loop holds and sends nothing this cycle.`,
    );
  }
  const stale = devices.filter((d) => !d.fresh);
  if (stale.length > 0) {
    notes.push(
      `stale telemetry, device(s) ignored: ${stale
        .map(
          (d) =>
            `${d.name} (${d.ageMs === null ? 'never read' : `${Math.round(d.ageMs / 1000)}s old`})`,
        )
        .join(', ')}`,
    );
  }

  const readingDebug: ReadingDebug = {
    present: Boolean(reading),
    isStale: reading?.is_stale ?? true,
    productionW: reading?.production_w ?? null,
    consumptionW: reading?.consumption_w ?? null,
    gridW: reading?.grid_w ?? null,
    gridInjectionW: reading?.grid_injection_w ?? null,
    importW: reading ? Math.max(reading.grid_w, 0) : null,
    bydBatteryW: reading?.battery_w ?? null,
    marstekNetW: reading?.marstek_net_w ?? null,
  };

  if (readingMissing || !reading) {
    return {
      now,
      mode: config.mode,
      config,
      reading: readingDebug,
      devices,
      phase: null,
      decisions: [],
      diagnostics: null,
      lastCommands: getLastCommands(),
      notes,
    };
  }

  const importW = Math.max(reading.grid_w, 0);
  const { phase, decisions, diagnostics } = decide(
    config,
    devices.map((d) => ({
      id: d.id,
      name: d.name,
      soc: d.usedSocPct,
      chargingW: d.usedChargingW,
      dischargingW: d.usedDischargingW,
    })),
    reading.grid_injection_w,
    importW,
    reading.battery_w,
  );

  if (phase !== 'charge' && diagnostics.surplusW <= config.injectTargetW) {
    notes.push(
      `no exportable surplus above the inject target: surplus=${Math.round(diagnostics.surplusW)}W ≤ injectTarget=${config.injectTargetW}W, so charging does not trigger.`,
    );
  }
  if (phase === 'charge' && diagnostics.chargeEligibleCount === 0) {
    notes.push(
      'all devices are at or above the charge ceiling (or have unknown SOC), so none can charge.',
    );
  }

  return {
    now,
    mode: config.mode,
    config,
    reading: readingDebug,
    devices,
    phase,
    decisions,
    diagnostics,
    lastCommands: getLastCommands(),
    notes,
  };
}
