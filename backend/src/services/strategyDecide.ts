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

  // Otherwise discharge. The grid balance excluding the Marstek
  // (totalDischarging + import − injection) is what the grid would carry if the
  // Marstek stopped — it is stable against the Marstek's own discharge, so the
  // target never collapses as the Marstek ramps (no oscillation). In `cover` mode
  // we add the BYD power so the target becomes exactly the post-solar HOUSE
  // deficit: bydW cancels the BYD's own flow, so the Marstek covers the house and
  // never the BYD's charging (no battery-to-battery transfer). In `force` mode we
  // add the injection limit instead, so the fleet exports up to that limit.
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
