import type { ManualAction } from './marstekControl.ts';

/** The last command the loop confirmed-sent to a device. */
export interface CommandSnapshot {
  action: ManualAction;
  powerW: number;
  /** Wall-clock (ms) when the device confirmed the command. */
  sentAt: number;
}

/** A device's latest telemetry sample. */
export interface FlowSample {
  /** Wall-clock (ms) when the values were read successfully. */
  valuesAt: number;
  /** AC power in watts: negative = charging, positive = discharging. */
  acPowerW: number | null;
}

/** What a device is charging and discharging right now, both ≥ 0. */
export interface FleetFlow {
  chargingW: number;
  dischargingW: number;
}

/**
 * Resolve what a Marstek is actually doing, preferring the commanded setpoint
 * over telemetry that predates it.
 *
 * The control loop compensates for the fleet's own flow so its target does not
 * collapse as the batteries ramp. That compensation is only correct if the flow
 * is current — and Marstek telemetry refreshes every 60 s while the loop can run
 * every 30 s, so a reading taken *before* the last command cannot show its
 * effect. Feeding it back anyway makes the loop believe its own command never
 * landed, so it over-corrects, reverses next cycle, and limit-cycles at the loop
 * period. While the telemetry is older than the command, the command is simply
 * the better estimate: we know exactly what we asked for.
 *
 * Trust in the command expires with `trustWindowMs`, which the caller sets to the
 * device's self-expiring countdown: past it the battery has stopped on its own,
 * so the (possibly stale) measurement is authoritative again.
 * @param sample - The latest fresh telemetry, or null when stale/never read.
 * @param command - The last confirmed command, or null when none was sent.
 * @param now - Current wall-clock in ms.
 * @param trustWindowMs - How long a command is assumed to still be in effect.
 * @returns The device's charge and discharge power, both in watts.
 */
export function resolveFleetFlow(
  sample: FlowSample | null,
  command: CommandSnapshot | null,
  now: number,
  trustWindowMs: number,
): FleetFlow {
  const measuredAt = sample?.valuesAt ?? 0;
  // `>=`, not `>`: a reading taken at the same instant the command was sent still
  // predates its effect — the device needs time to act on it.
  if (
    command !== null &&
    command.sentAt >= measuredAt &&
    now - command.sentAt <= trustWindowMs
  ) {
    if (command.action === 'charge') {
      return { chargingW: command.powerW, dischargingW: 0 };
    }
    if (command.action === 'discharge') {
      return { chargingW: 0, dischargingW: command.powerW };
    }
    return { chargingW: 0, dischargingW: 0 };
  }

  const acPowerW = sample?.acPowerW ?? null;
  if (acPowerW === null) return { chargingW: 0, dischargingW: 0 };
  return acPowerW < 0
    ? { chargingW: -acPowerW, dischargingW: 0 }
    : { chargingW: 0, dischargingW: acPowerW };
}
