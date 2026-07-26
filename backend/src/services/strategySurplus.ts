/**
 * Below this the BYD's flow is treated as measurement noise rather than a real
 * discharge, so a battery hovering around zero does not veto charging (W).
 */
export const BYD_DISCHARGE_GUARD_W = 50;

/** The meter snapshot an exportable surplus is derived from. */
export interface SurplusInputs {
  /** PV production (W, ≥0). */
  productionW: number;
  /** Grid export (W, ≥0). */
  injectionW: number;
  /** Grid import (W, ≥0). */
  importW: number;
  /** BYD power (W): positive = discharging, negative = charging. */
  bydW: number;
  /** Total Marstek charge power right now (W, ≥0). */
  totalChargingW: number;
  /** Total Marstek discharge power right now (W, ≥0). */
  totalDischargingW: number;
}

/** An exportable surplus and the terms that bounded it. */
export interface Surplus {
  /** Surplus from the meter balance alone, before the production ceiling (W). */
  rawW: number;
  /** BYD discharge subtracted from the balance (W, ≥0). */
  bydDischargeW: number;
  /** The physical ceiling applied to the balance: PV production (W, ≥0). */
  productionCapW: number;
  /** Exportable surplus: the balance clamped to the production ceiling (W). */
  surplusW: number;
  /**
   * True when the BYD is discharging above {@link BYD_DISCHARGE_GUARD_W}, so the
   * house is in deficit and no Marstek charge may be commanded at all.
   */
  bydSupplying: boolean;
}

/**
 * The solar power that would leave for the grid if BOTH battery systems stopped
 * — the only power the Marstek fleet may legitimately store.
 *
 * The Fronius smart meter sits at the grid connection point and measures the PV
 * (`production`), the BYD (`byd`) and the grid; the Marstek sit BEHIND it, so it
 * reads their charging as extra house load. Its power balance is therefore
 * `production + byd + import = load + (charging − discharging) + injection`,
 * and the exportable surplus `production − load` reduces to
 * `injection + charging − discharging − import − byd`.
 *
 * Every term is an add-back of something that hides the true surplus from the
 * meter: the fleet's own charging had lowered the visible injection, its
 * discharge had inflated it, grid import means the house is short, and a
 * DISCHARGING BYD means the house is short too — whatever the fleet is drawing is
 * coming out of the BYD, not out of the sun. Omitting the BYD term is what lets a
 * battery-to-battery transfer justify itself: the BYD silently covers the fleet's
 * draw, the grid stays at zero, and the fleet's own charge power reads back as
 * "solar surplus" cycle after cycle.
 *
 * A BYD that is CHARGING is not subtracted: it is competing for the same solar,
 * not supplying the fleet, and treating its draw as available surplus would let a
 * single incoherent meter sample manufacture power that no panel produced.
 *
 * The balance is finally clamped to the PV production, which is an exact physical
 * bound (`surplus = production − load` and the house load is never negative). The
 * Fronius API assembles `P_Grid`, `P_Akku` and `P_PV` from sources sampled at
 * slightly different instants, so a fast load step yields snapshots that export
 * more than the array can possibly produce; the ceiling rejects them without any
 * tunable threshold.
 * @param inputs - the meter snapshot and the fleet's own flows
 * @returns the exportable surplus and the terms that bounded it
 */
export function exportableSurplus(inputs: SurplusInputs): Surplus {
  const bydDischargeW = Math.max(inputs.bydW, 0);
  const rawW =
    inputs.injectionW +
    inputs.totalChargingW -
    inputs.totalDischargingW -
    inputs.importW -
    bydDischargeW;
  const productionCapW = Math.max(inputs.productionW, 0);
  return {
    rawW,
    bydDischargeW,
    productionCapW,
    surplusW: Math.min(rawW, productionCapW),
    bydSupplying: bydDischargeW > BYD_DISCHARGE_GUARD_W,
  };
}
