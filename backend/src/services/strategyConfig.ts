import { db } from '../db/Database.ts';

/**
 * Setting key for the per-battery Marstek reserve (minimum SOC), owned by the
 * Battery Reserve config section. The strategy reuses it as the discharge floor
 * instead of keeping a duplicate of its own.
 */
const MARSTEK_RESERVE_KEY = 'marstek_reserve_pct';
const MARSTEK_RESERVE_DEFAULT = 5;

/**
 * Tunable parameters of the autonomous Marstek control strategy. This strategy
 * drives only the Marstek Venus E batteries; the BYD battery is not controllable
 * and will have its own strategy.
 */
export interface StrategyConfig {
  /**
   * Whether the control loop actively commands the batteries.
   * @default false
   */
  enabled: boolean;
  /**
   * Grid injection level (W) the loop tolerates; only the surplus above this is
   * stored. The original "do not inject more than this".
   * @default 500
   */
  injectTargetW: number;
  /**
   * Per-battery charge ceiling (W). A battery is never charged faster than this.
   * @default 500
   */
  chargeMaxW: number;
  /**
   * Stop charging a battery once its SOC reaches this percentage.
   * @default 100
   */
  chargeCeilingPct: number;
  /**
   * Per-battery discharge ceiling (W). The loop discharges to cover house load
   * (grid import), load-following, but never faster than this per battery — so
   * the fleet covers at most `dischargeMaxW × battery count` (e.g. 400 W each =
   * 800 W with two batteries).
   * @default 400
   */
  dischargeMaxW: number;
  /**
   * Drive discharge from total house consumption instead of net grid import.
   * When `false` (default) the loop only discharges to offset grid import, so any
   * grid injection stops it. When `true` it discharges to cover the full house
   * load — capped per battery — even while PV is still exporting to the grid.
   * @default false
   */
  dischargeCoverConsumption: boolean;
  /**
   * Stop discharging a battery once its SOC falls to this percentage. Sourced
   * from the shared Marstek reserve (`marstek_reserve_pct`), not a strategy
   * setting of its own.
   * @default 5
   */
  dischargeFloorPct: number;
  /**
   * Control-loop cycle period (ms).
   * @default 30000
   */
  intervalMs: number;
}

/** Setting key for each {@link StrategyConfig} field. */
const KEYS = {
  enabled: 'strategy_enabled',
  injectTargetW: 'strategy_inject_target_w',
  chargeMaxW: 'strategy_charge_max_w',
  chargeCeilingPct: 'strategy_charge_ceiling_pct',
  dischargeMaxW: 'strategy_discharge_max_w',
  dischargeCoverConsumption: 'strategy_discharge_cover_consumption',
  intervalMs: 'strategy_interval_ms',
} as const;

const DEFAULTS = {
  enabled: false,
  injectTargetW: 500,
  chargeMaxW: 500,
  chargeCeilingPct: 100,
  dischargeMaxW: 400,
  dischargeCoverConsumption: false,
  intervalMs: 30_000,
} as const;

function num(key: string, fallback: number): number {
  const raw = db.getSetting(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Read the current strategy configuration from the settings table, falling back
 * to {@link DEFAULTS} for any unset key.
 * @returns the resolved configuration
 */
export function readStrategyConfig(): StrategyConfig {
  return {
    enabled: (db.getSetting(KEYS.enabled) ?? '0') === '1',
    injectTargetW: num(KEYS.injectTargetW, DEFAULTS.injectTargetW),
    chargeMaxW: num(KEYS.chargeMaxW, DEFAULTS.chargeMaxW),
    chargeCeilingPct: num(KEYS.chargeCeilingPct, DEFAULTS.chargeCeilingPct),
    dischargeMaxW: num(KEYS.dischargeMaxW, DEFAULTS.dischargeMaxW),
    dischargeCoverConsumption:
      (db.getSetting(KEYS.dischargeCoverConsumption) ?? '0') === '1',
    dischargeFloorPct: num(MARSTEK_RESERVE_KEY, MARSTEK_RESERVE_DEFAULT),
    intervalMs: num(KEYS.intervalMs, DEFAULTS.intervalMs),
  };
}

/** A partial strategy update, one optional field per setting. */
export type StrategyConfigUpdate = Partial<StrategyConfig>;

/**
 * Persist the provided strategy fields to the settings table. Omitted fields are
 * left unchanged.
 * @param update - the fields to write
 */
export function writeStrategyConfig(update: StrategyConfigUpdate): void {
  if (update.enabled !== undefined) {
    db.upsertSetting(KEYS.enabled, update.enabled ? '1' : '0');
  }
  if (update.injectTargetW !== undefined) {
    db.upsertSetting(KEYS.injectTargetW, String(update.injectTargetW));
  }
  if (update.chargeMaxW !== undefined) {
    db.upsertSetting(KEYS.chargeMaxW, String(update.chargeMaxW));
  }
  if (update.chargeCeilingPct !== undefined) {
    db.upsertSetting(KEYS.chargeCeilingPct, String(update.chargeCeilingPct));
  }
  if (update.dischargeMaxW !== undefined) {
    db.upsertSetting(KEYS.dischargeMaxW, String(update.dischargeMaxW));
  }
  if (update.dischargeCoverConsumption !== undefined) {
    db.upsertSetting(
      KEYS.dischargeCoverConsumption,
      update.dischargeCoverConsumption ? '1' : '0',
    );
  }
  if (update.intervalMs !== undefined) {
    db.upsertSetting(KEYS.intervalMs, String(update.intervalMs));
  }
}
