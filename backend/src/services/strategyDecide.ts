import type { ManualAction } from './marstekControl.ts';
import type { StrategyConfig } from './strategyConfig.ts';

/** Minimum meaningful charge command; below it the battery is simply stopped. */
export const MIN_CHARGE_W = 50;
/** Minimum meaningful discharge command; below it the battery is simply stopped. */
export const MIN_DISCHARGE_W = 50;

/** The control phase the loop resolved this cycle. */
export type Phase = 'charge' | 'discharge' | 'idle' | 'off' | 'stale';

/** What the loop decided for one device this cycle. */
export interface DeviceDecision {
  deviceId: number;
  name: string;
  socPct: number | null;
  action: ManualAction;
  powerW: number;
  sent: boolean;
}

/**
 * The intermediate quantities {@link decide} computed this cycle, surfaced so a
 * debug endpoint can explain exactly WHY the loop chose to charge, discharge, or
 * idle — without re-deriving (and risking drifting from) the decision math.
 */
export interface DecisionDiagnostics {
  /** Sum of charge power across all devices right now (W, ≥0). */
  totalChargingW: number;
  /** Sum of discharge power across all devices right now (W, ≥0). */
  totalDischargingW: number;
  /** Reconstructed exportable solar surplus: injection + totalCharging − import. */
  surplusW: number;
  /** Number of devices eligible to charge (SOC known and below the ceiling). */
  chargeEligibleCount: number;
  /** Fleet charge cap (chargeMaxW × eligible count). */
  chargeCapW: number;
  /** Surplus above the injection target, clamped to the charge cap. */
  desiredChargeW: number;
  /** Per-battery charge setpoint candidate (0 if below {@link MIN_CHARGE_W}). */
  perChargeW: number;
  /** Grid balance excluding the Marstek: totalDischarging + import − injection. */
  gridBalanceExcludingMarstekW: number;
  /** Discharge target this cycle (mode-dependent). */
  dischargeTargetW: number;
  /** Number of devices eligible to discharge (SOC known and above the floor). */
  dischargeEligibleCount: number;
  /** Fleet discharge cap (dischargeMaxW × eligible count). */
  dischargeCapW: number;
  /** Target clamped to the discharge cap. */
  desiredDischargeW: number;
  /** Per-battery discharge setpoint candidate (0 if below {@link MIN_DISCHARGE_W}). */
  perDischargeW: number;
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
 * the exportable solar surplus above it (capped per battery). The surplus is the
 * grid export plus what the batteries already charge, MINUS any grid import — so
 * grid-sourced charging is never mistaken for surplus. When there is no surplus to
 * store, the loop discharges to cover house load — capped per battery — down to
 * the floor.
 *
 * Discharge has two modes (`config.dischargeMode`):
 *
 * `cover` (the default) covers only the house load not already met by solar,
 * derived from the power balance: `bydW + totalDischarging + import − injection`.
 * The grid term and the Marstek's own discharge cancel, so the target is the true
 * post-solar house deficit — stable as the Marstek ramps (no oscillation) and with
 * the BYD's flow subtracted, so the Marstek never covers the BYD's charging (no
 * battery-to-battery transfer). It needs no consumption reading, so it is immune to
 * whether the meter sees the Marstek as a source.
 *
 * `force` discharges at {@link StrategyConfig.dischargeMaxW} per battery but
 * throttled so grid injection never exceeds the injection limit
 * ({@link StrategyConfig.injectTargetW}): the target is the grid balance excluding
 * the Marstek (`totalDischarging + import − injection`) plus that limit, so the
 * fleet deliberately exports up to the limit and no further. Charging from a large
 * solar surplus still takes priority in both modes, so the whole strategy honors a
 * single grid-injection ceiling. Pure function of its inputs so it can be unit-tested.
 * @param config - the resolved strategy configuration
 * @param devices - the enabled Marstek devices with their current state
 * @param injectionW - current grid injection / export (W, ≥0)
 * @param importW - current grid import (W, ≥0)
 * @param bydW - current BYD (Fronius) battery power (W): positive = discharging,
 * negative = charging. Used in `cover` to derive the true post-solar house deficit
 * from the power balance, so the Marstek covers only the house — never the BYD's
 * charging — independently of whether the meter sees the Marstek.
 * @returns the phase and per-device decisions
 */
export function decide(
  config: StrategyConfig,
  devices: DeviceState[],
  injectionW: number,
  importW: number,
  bydW = 0,
): {
  phase: Phase;
  decisions: DeviceDecision[];
  diagnostics: DecisionDiagnostics;
} {
  const chargeEligible = devices.filter(
    (device) => device.soc !== null && device.soc < config.chargeCeilingPct,
  );
  let totalCharging = 0;
  let totalDischarging = 0;
  for (const device of devices) {
    totalCharging += device.chargingW;
    totalDischarging += device.dischargingW;
  }

  // Charge from solar surplus (priority). Reconstruct the true exportable surplus:
  // add back what the batteries are already charging (it had reduced the visible
  // injection), then subtract any grid import. When the house is importing there
  // is no solar surplus to store, so grid-sourced charging must never be counted
  // as surplus — otherwise at night the batteries keep charging from the grid and
  // the loop never reaches the discharge branch (a self-perpetuating latch).
  const surplus = injectionW + totalCharging - importW;
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

  // Discharge math. The grid balance excluding the Marstek
  // (totalDischarging + import − injection) is what the grid would carry if the
  // Marstek stopped — it is stable against the Marstek's own discharge, so the
  // target never collapses as the Marstek ramps (no oscillation). In `cover` mode
  // we add the BYD power so the target becomes exactly the post-solar HOUSE
  // deficit: bydW cancels the BYD's own flow, so the Marstek covers the house and
  // never the BYD's charging (no battery-to-battery transfer). In `force` mode we
  // add the injection limit instead, so the fleet exports up to that limit.
  // Computed unconditionally (even when charging wins) so diagnostics are complete.
  const dischargeEligible = devices.filter(
    (device) => device.soc !== null && device.soc > config.dischargeFloorPct,
  );
  const gridBalanceExcludingMarstek = totalDischarging + importW - injectionW;
  const target =
    config.dischargeMode === 'force'
      ? gridBalanceExcludingMarstek + config.injectTargetW
      : gridBalanceExcludingMarstek + bydW;
  const dischargeCap = config.dischargeMaxW * dischargeEligible.length;
  const desiredDischarge = Math.max(0, Math.min(target, dischargeCap));
  const perDischarge =
    dischargeEligible.length > 0
      ? Math.min(
          config.dischargeMaxW,
          Math.round(desiredDischarge / dischargeEligible.length),
        )
      : 0;

  const diagnostics: DecisionDiagnostics = {
    totalChargingW: totalCharging,
    totalDischargingW: totalDischarging,
    surplusW: surplus,
    chargeEligibleCount: chargeEligible.length,
    chargeCapW: chargeCap,
    desiredChargeW: desiredCharge,
    perChargeW: perCharge,
    gridBalanceExcludingMarstekW: gridBalanceExcludingMarstek,
    dischargeTargetW: target,
    dischargeEligibleCount: dischargeEligible.length,
    dischargeCapW: dischargeCap,
    desiredDischargeW: desiredDischarge,
    perDischargeW: perDischarge,
  };

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
    return { phase: 'charge', decisions, diagnostics };
  }

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
  return { phase: discharging ? 'discharge' : 'idle', decisions, diagnostics };
}
