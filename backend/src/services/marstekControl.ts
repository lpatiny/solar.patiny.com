/* eslint-disable camelcase, @typescript-eslint/naming-convention -- Open API wire fields are snake_case */
import type { Weekday } from './marstekRegisters.ts';
import {
  MAX_CHARGE_POWER_W,
  MAX_DISCHARGE_POWER_W,
  MAX_SCHEDULE_SLOTS,
  WEEKDAY_BIT,
  WEEK_SET_ALL,
} from './marstekRegisters.ts';
import type { UdpDeviceAddress } from './marstekUdpTransport.ts';
import { rpc } from './marstekUdpTransport.ts';

interface SetModeResult {
  id: number;
  set_result: boolean;
}

/** Default self-expiring countdown for a Passive (discharge) command, seconds. */
export const DEFAULT_DISCHARGE_SECONDS = 3600;

/** Hard ceiling on a Passive countdown (24 h), seconds. */
export const MAX_DISCHARGE_SECONDS = 86_400;

const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** What an immediate manual command does to the battery. */
export type ManualAction = 'charge' | 'discharge' | 'stop';

/** One day/hour schedule slot pushed to the device's Manual-mode slot table. */
export interface ScheduleSlot {
  /** Window start, "HH:MM" (24 h). */
  startTime: string;
  /** Window end, "HH:MM" (24 h). */
  endTime: string;
  /** Days the window is active. Empty means every day. */
  days: Weekday[];
  /** What the slot does. */
  action: 'charge' | 'discharge';
  /** Magnitude in watts (always positive); the sign is derived from `action`. */
  powerW: number;
  /**
   * Whether the slot is active.
   * @default true
   */
  enable?: boolean;
}

/**
 * Translate a list of weekdays into the Manual-mode `week_set` bitmask. An empty
 * list maps to every day ({@link WEEK_SET_ALL}).
 * @param days - the active weekdays
 * @returns the `week_set` byte
 */
export function weekSetFromDays(days: Weekday[]): number {
  if (days.length === 0) return WEEK_SET_ALL;
  let mask = 0;
  for (const day of days) mask |= WEEKDAY_BIT[day];
  return mask;
}

/**
 * Issue an immediate manual command. Charging uses Manual mode with a NEGATIVE
 * power over a full-day window (it holds until changed). Discharging uses
 * Passive mode with a POSITIVE power and a self-expiring countdown (`cd_time`),
 * because this firmware rejects a charge command in Passive and a discharge in
 * Manual is not reliable. `stop` returns to a disabled full-day Manual slot.
 * @param address - device host and UDP port
 * @param options - the command
 * @param options.action - charge, discharge, or stop
 * @param options.powerW - magnitude in watts (ignored for `stop`)
 * @param options.durationS - discharge countdown in seconds. Defaults to {@link DEFAULT_DISCHARGE_SECONDS}.
 * @returns whether the device confirmed the change (`set_result`)
 */
export async function setMarstekUdpManual(
  address: UdpDeviceAddress,
  options: { action: ManualAction; powerW?: number; durationS?: number },
): Promise<boolean> {
  const { action } = options;

  if (action === 'discharge') {
    const powerW = requireInteger(options.powerW ?? 0, MAX_DISCHARGE_POWER_W);
    const durationS = options.durationS ?? DEFAULT_DISCHARGE_SECONDS;
    if (
      !Number.isInteger(durationS) ||
      durationS < 1 ||
      durationS > MAX_DISCHARGE_SECONDS
    ) {
      throw new Error(
        `discharge duration must be an integer between 1 and ${MAX_DISCHARGE_SECONDS} s`,
      );
    }
    const result = await rpc<SetModeResult>(address, 'ES.SetMode', {
      id: 0,
      config: {
        mode: 'Passive',
        passive_cfg: { power: powerW, cd_time: durationS },
      },
    });
    return result.set_result;
  }

  const powerW =
    action === 'stop'
      ? 0
      : requireInteger(options.powerW ?? 0, MAX_CHARGE_POWER_W);
  return sendManualSlot(address, {
    time_num: 0,
    start_time: '00:00',
    end_time: '23:59',
    week_set: WEEK_SET_ALL,
    power: -powerW,
    enable: action === 'charge' && powerW > 0 ? 1 : 0,
  });
}

/**
 * Force the battery to charge at the given power (watts), capped at
 * {@link MAX_CHARGE_POWER_W}; 0 stops forced charging. Thin wrapper over
 * {@link setMarstekUdpManual} kept for the existing `/charge-power` route.
 * @param address - device host and UDP port
 * @param powerW - charge power in watts (0 to {@link MAX_CHARGE_POWER_W})
 * @returns whether the device confirmed the change (`set_result`)
 */
export async function setMarstekUdpChargePower(
  address: UdpDeviceAddress,
  powerW: number,
): Promise<boolean> {
  return setMarstekUdpManual(address, {
    action: powerW > 0 ? 'charge' : 'stop',
    powerW,
  });
}

/**
 * Push a day/hour charge & discharge schedule to the device's Manual-mode slot
 * table. Each slot becomes one `ES.SetMode` Manual call (slot index = array
 * position), sent through the paced per-device queue. Charge slots carry a
 * negative power, discharge slots a positive one.
 * @param address - device host and UDP port
 * @param slots - the schedule slots (at most {@link MAX_SCHEDULE_SLOTS})
 * @returns the per-slot confirmation flags, in input order
 */
export async function setMarstekUdpSchedule(
  address: UdpDeviceAddress,
  slots: ScheduleSlot[],
): Promise<boolean[]> {
  if (slots.length > MAX_SCHEDULE_SLOTS) {
    throw new Error(`a schedule may not exceed ${MAX_SCHEDULE_SLOTS} slots`);
  }
  const results: boolean[] = [];
  for (const [index, slot] of slots.entries()) {
    const max =
      slot.action === 'charge' ? MAX_CHARGE_POWER_W : MAX_DISCHARGE_POWER_W;
    const magnitude = requireInteger(slot.powerW, max);
    if (!TIME_RE.test(slot.startTime) || !TIME_RE.test(slot.endTime)) {
      throw new Error(`slot ${index}: start/end must be "HH:MM" (24 h)`);
    }
    // eslint-disable-next-line no-await-in-loop -- the ESP32 accepts one paced command at a time
    const ok = await sendManualSlot(address, {
      time_num: index,
      start_time: slot.startTime,
      end_time: slot.endTime,
      week_set: weekSetFromDays(slot.days),
      power: slot.action === 'charge' ? -magnitude : magnitude,
      enable: (slot.enable ?? true) ? 1 : 0,
    });
    results.push(ok);
  }
  return results;
}

function requireInteger(value: number, max: number): number {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`power must be an integer between 0 and ${max} W`);
  }
  return value;
}

async function sendManualSlot(
  address: UdpDeviceAddress,
  manual_cfg: {
    time_num: number;
    start_time: string;
    end_time: string;
    week_set: number;
    power: number;
    enable: number;
  },
): Promise<boolean> {
  const result = await rpc<SetModeResult>(address, 'ES.SetMode', {
    id: 0,
    config: { mode: 'Manual', manual_cfg },
  });
  return result.set_result;
}
