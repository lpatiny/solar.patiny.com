import type { ManualAction } from './marstekControl.ts';

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

/** A device's identity and current state, as fed to the decision. */
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
 * The intermediate quantities the decision computed this cycle, surfaced so a
 * debug endpoint can explain exactly WHY the loop chose to charge, discharge, or
 * idle — without re-deriving (and risking drifting from) the decision math.
 */
export interface DecisionDiagnostics {
  /** Sum of charge power across all devices right now (W, ≥0). */
  totalChargingW: number;
  /** Sum of discharge power across all devices right now (W, ≥0). */
  totalDischargingW: number;
  /** Exportable solar surplus, BYD-corrected and clamped to production (W). */
  surplusW: number;
  /** The surplus before the production ceiling was applied (W). */
  rawSurplusW: number;
  /** BYD discharge subtracted from the surplus (W, ≥0). */
  bydDischargeW: number;
  /** Production ceiling applied to the surplus (W, ≥0). */
  productionCapW: number;
  /** True when a discharging BYD vetoed charging outright. */
  chargeBlockedByByd: boolean;
  /** Number of devices eligible to charge (SOC known and below the ceiling). */
  chargeEligibleCount: number;
  /** Fleet charge cap (chargeMaxW × eligible count). */
  chargeCapW: number;
  /** Surplus above the injection target, clamped to the charge cap. */
  desiredChargeW: number;
  /** Per-battery charge setpoint candidate (0 when below the charge minimum). */
  perChargeW: number;
  /** Grid balance excluding the Marstek: totalDischarging − totalCharging + import − injection. */
  gridBalanceExcludingMarstekW: number;
  /** Discharge target this cycle (mode-dependent). */
  dischargeTargetW: number;
  /** Number of devices eligible to discharge (SOC known and above the floor). */
  dischargeEligibleCount: number;
  /** Fleet discharge cap (dischargeMaxW × eligible count). */
  dischargeCapW: number;
  /** Target clamped to the discharge cap. */
  desiredDischargeW: number;
  /** Per-battery discharge setpoint candidate (0 when below the discharge minimum). */
  perDischargeW: number;
  /**
   * True when a charge↔discharge reversal was demanded and converted into one
   * stop-all cycle so the whole fleet passes through a common safe state first.
   */
  directionHoldoff: boolean;
}
