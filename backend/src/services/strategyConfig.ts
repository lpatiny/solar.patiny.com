import { db } from '../db/Database.ts';

/**
 * Setting key for the per-battery Marstek reserve (minimum SOC), owned by the
 * Battery Reserve config section. The strategy reuses it as the discharge floor
 * instead of keeping a duplicate of its own.
 */
const MARSTEK_RESERVE_KEY = 'marstek_reserve_pct';
const MARSTEK_RESERVE_DEFAULT = 5;

/**
 * How the Marstek batteries are driven:
 * - `off`: control disabled — the loop releases the batteries and leaves them to
 *   their own firmware behavior, commanding nothing.
 * - `auto`: the autonomous strategy loop charges and discharges them.
 * - `manual`: the loop is off; the operator commands the batteries directly.
 */
export type StrategyMode = 'off' | 'auto' | 'manual';

/**
 * How the Marstek batteries discharge in automatic mode:
 * - `cover`: cover the house consumption only (Marstek first, never exporting).
 * - `force`: discharge at the configured rate per battery, throttled so grid
 *   injection never exceeds the injection limit (`injectTargetW`) — so it may
 *   deliberately export to the grid, up to that limit.
 */
export type DischargeMode = 'cover' | 'force';

/**
 * Tunable parameters of the autonomous Marstek control strategy. This strategy
 * drives only the Marstek Venus E batteries; the BYD battery is not controllable
 * and will have its own strategy.
 */
export interface StrategyConfig {
  /**
   * How the batteries are driven (off / auto / manual).
   * @default 'off'
   */
  mode: StrategyMode;
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
   * Per-battery discharge power (W). In `cover` mode it is the ceiling on
   * load-following; in `force` mode it is the rate each battery is driven at
   * (still throttled by the injection limit). The fleet does at most
   * `dischargeMaxW × battery count` (e.g. 400 W each = 800 W with two batteries).
   * @default 400
   */
  dischargeMaxW: number;
  /**
   * Discharge behavior: `cover` discharges only to cover the house consumption
   * (Marstek first, never exporting); `force` discharges at {@link dischargeMaxW}
   * per battery, throttled so grid injection stays at or below {@link injectTargetW}
   * — so it deliberately exports to the grid, up to that limit.
   * @default 'cover'
   */
  dischargeMode: DischargeMode;
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
  mode: 'strategy_mode',
  injectTargetW: 'strategy_inject_target_w',
  chargeMaxW: 'strategy_charge_max_w',
  chargeCeilingPct: 'strategy_charge_ceiling_pct',
  dischargeMaxW: 'strategy_discharge_max_w',
  dischargeMode: 'strategy_discharge_mode',
  intervalMs: 'strategy_interval_ms',
} as const;

/** Legacy boolean enabled flag, replaced by {@link KEYS.mode}. */
const LEGACY_ENABLED_KEY = 'strategy_enabled';

const DEFAULTS = {
  injectTargetW: 500,
  chargeMaxW: 500,
  chargeCeilingPct: 100,
  dischargeMaxW: 400,
  intervalMs: 30_000,
} as const;

function num(key: string, fallback: number): number {
  const raw = db.getSetting(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Resolve the control mode, falling back to the legacy boolean `strategy_enabled`
 * flag (and then `off`) when the `strategy_mode` setting is not yet set.
 * @returns the control mode
 */
function readMode(): StrategyMode {
  const raw = db.getSetting(KEYS.mode);
  if (raw === 'off' || raw === 'auto' || raw === 'manual') return raw;
  const legacy = db.getSetting(LEGACY_ENABLED_KEY);
  if (legacy === '1') return 'auto';
  if (legacy === '0') return 'manual';
  return 'off';
}

/**
 * Resolve the discharge mode, defaulting to `cover`. The legacy boolean
 * `strategy_discharge_cover_consumption` maps `'0'` (offset-import) to `force`,
 * anything else to `cover`.
 * @returns the discharge mode
 */
function readDischargeMode(): DischargeMode {
  const raw = db.getSetting(KEYS.dischargeMode);
  if (raw === 'cover' || raw === 'force') return raw;
  const legacy = db.getSetting('strategy_discharge_cover_consumption');
  if (legacy === '0') return 'force';
  return 'cover';
}

/**
 * Read the current strategy configuration from the settings table, falling back
 * to {@link DEFAULTS} for any unset key.
 * @returns the resolved configuration
 */
export function readStrategyConfig(): StrategyConfig {
  return {
    mode: readMode(),
    injectTargetW: num(KEYS.injectTargetW, DEFAULTS.injectTargetW),
    chargeMaxW: num(KEYS.chargeMaxW, DEFAULTS.chargeMaxW),
    chargeCeilingPct: num(KEYS.chargeCeilingPct, DEFAULTS.chargeCeilingPct),
    dischargeMaxW: num(KEYS.dischargeMaxW, DEFAULTS.dischargeMaxW),
    dischargeMode: readDischargeMode(),
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
  if (update.mode !== undefined) {
    db.upsertSetting(KEYS.mode, update.mode);
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
  if (update.dischargeMode !== undefined) {
    db.upsertSetting(KEYS.dischargeMode, update.dischargeMode);
  }
  if (update.intervalMs !== undefined) {
    db.upsertSetting(KEYS.intervalMs, String(update.intervalMs));
  }
}
