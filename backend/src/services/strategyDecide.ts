import type { StrategyConfig } from './strategyConfig.ts';
import { exportableSurplus } from './strategySurplus.ts';
import type {
  DecisionDiagnostics,
  DeviceDecision,
  DeviceState,
  Phase,
} from './strategyTypes.ts';

/** Minimum meaningful charge command; below it the battery is simply stopped. */
export const MIN_CHARGE_W = 50;
/** Minimum meaningful discharge command; below it the battery is simply stopped. */
export const MIN_DISCHARGE_W = 50;

export type {
  DecisionDiagnostics,
  DeviceDecision,
  DeviceState,
  Phase,
} from './strategyTypes.ts';

/**
 * Decide each enabled Marstek device's charge/discharge action for this cycle.
 * Charging takes priority: it holds grid injection at the target by storing only
 * the exportable solar surplus above it (capped per battery), as derived by
 * {@link exportableSurplus} — so neither grid import nor a discharging BYD can be
 * mistaken for solar. When there is no surplus to store, the loop discharges to
 * cover house load — capped per battery — down to the floor.
 *
 * Discharge has two modes (`config.dischargeMode`). `cover` (the default) covers
 * only the house load not already met by solar, from the power balance
 * `bydW + totalDischarging + import − injection`: the grid term and the Marstek's
 * own discharge cancel, so the target is the true post-solar house deficit —
 * stable as the Marstek ramps (no oscillation), and with the BYD's flow
 * subtracted so the Marstek never covers the BYD's charging. `force` discharges
 * at {@link StrategyConfig.dischargeMaxW} per battery, throttled so grid injection
 * never exceeds {@link StrategyConfig.injectTargetW}. Charging wins in both modes,
 * so the whole strategy honors a single grid-injection ceiling.
 *
 * Both branches read the SAME power balance and therefore can never disagree
 * about where the power comes from: in `cover`, the discharge target is exactly
 * the negated surplus plus the BYD's own flow. Each compensates the fleet's own
 * flows symmetrically, so one battery's flow is never misread as solar surplus
 * (or house deficit) for the other to absorb — without which a fleet briefly
 * split across phases self-sustains a battery-to-battery transfer.
 *
 * A charge↔discharge reversal never happens in one step: when the math demands
 * the opposite direction of `previousPhase`, this cycle returns `idle` (stop all)
 * and the reversal proceeds next cycle, so a fast flip can never leave one device
 * charging while the other discharges — and the stop also clears the persistent
 * Manual charge slot before any Passive discharge starts. Pure function of its
 * inputs so it can be unit-tested.
 * @param config - the resolved strategy configuration
 * @param devices - the enabled Marstek devices with their current state
 * @param injectionW - current grid injection / export (W, ≥0)
 * @param importW - current grid import (W, ≥0)
 * @param bydW - current BYD (Fronius) battery power (W): positive = discharging,
 * negative = charging. Used in `cover` to derive the true post-solar house deficit
 * from the power balance, so the Marstek covers only the house — never the BYD's
 * charging — independently of whether the meter sees the Marstek.
 * @param previousPhase - the phase the loop executed last cycle; a charge↔discharge
 * reversal against it is held for one stop-all cycle. Defaults to `idle` (no holdoff).
 * @param productionW - current PV production (W), the physical ceiling on the
 * surplus. Defaults to no ceiling, for callers with no inverter reading.
 * @returns the phase and per-device decisions
 */
export function decide(
  config: StrategyConfig,
  devices: DeviceState[],
  injectionW: number,
  importW: number,
  bydW = 0,
  previousPhase: Phase = 'idle',
  productionW = Number.POSITIVE_INFINITY,
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

  // Charge from solar surplus (priority). A discharging BYD vetoes charging
  // outright: the house is already in deficit, so every watt the fleet stores
  // would come out of the BYD.
  const surplus = exportableSurplus({
    productionW,
    injectionW,
    importW,
    bydW,
    totalChargingW: totalCharging,
    totalDischargingW: totalDischarging,
  });
  const chargeCap = config.chargeMaxW * chargeEligible.length;
  const desiredCharge = surplus.bydSupplying
    ? 0
    : Math.max(0, Math.min(surplus.surplusW - config.injectTargetW, chargeCap));
  const perCharge =
    chargeEligible.length > 0
      ? Math.min(
          config.chargeMaxW,
          Math.round(desiredCharge / chargeEligible.length),
        )
      : 0;

  // Discharge math. The grid balance excluding the Marstek
  // (totalDischarging − totalCharging + import − injection) is what the grid would
  // carry if the Marstek stopped — it is stable against the Marstek's own
  // discharge, so the target never collapses as the Marstek ramps (no
  // oscillation), and it subtracts the Marstek's own charging so a device stuck
  // charging (a missed command) never reads as house deficit for the others to
  // cover. In `cover` mode we add the BYD power so the target becomes exactly the
  // post-solar HOUSE deficit: bydW cancels the BYD's own flow, so the Marstek
  // covers the house and never the BYD's charging (no battery-to-battery
  // transfer). In `force` mode we add the injection limit instead, so the fleet
  // exports up to that limit. Computed unconditionally (even when charging wins)
  // so diagnostics are complete.
  const dischargeEligible = devices.filter(
    (device) => device.soc !== null && device.soc > config.dischargeFloorPct,
  );
  const gridBalanceExcludingMarstek =
    totalDischarging - totalCharging + importW - injectionW;
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

  // A direct charge↔discharge reversal is converted into one stop-all cycle: the
  // fleet always passes through a common stopped state, so a fast flip can never
  // split it (one device still in the old phase, the other already in the new).
  const wantCharge = perCharge >= MIN_CHARGE_W;
  const wantDischarge = !wantCharge && perDischarge >= MIN_DISCHARGE_W;
  const directionHoldoff =
    (wantCharge && previousPhase === 'discharge') ||
    (wantDischarge && previousPhase === 'charge');

  const diagnostics: DecisionDiagnostics = {
    totalChargingW: totalCharging,
    totalDischargingW: totalDischarging,
    surplusW: surplus.surplusW,
    rawSurplusW: surplus.rawW,
    bydDischargeW: surplus.bydDischargeW,
    productionCapW: surplus.productionCapW,
    chargeBlockedByByd: surplus.bydSupplying,
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
    directionHoldoff,
  };

  if (wantCharge && !directionHoldoff) {
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

  const discharging = wantDischarge && !directionHoldoff;
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
