/** Hard safety ceiling for the charge power (W); mirrors the backend cap. */
export const MAX_CHARGE_POWER_W = 1000;

/** Hard safety ceiling for the discharge power (W); mirrors the backend cap. */
export const MAX_DISCHARGE_POWER_W = 1000;

/** Maximum number of schedule slots the device will accept; mirrors the backend. */
export const MAX_SCHEDULE_SLOTS = 10;

/** The seven weekdays in `week_set` bit order. */
export const WEEKDAYS = [
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun',
] as const;

/** A weekday accepted by the schedule API. */
export type Weekday = (typeof WEEKDAYS)[number];

/** Outcome of a control POST: success flag plus a human-readable message. */
export interface PostResult {
  ok: boolean;
  text: string;
}

/** One schedule slot as edited in the UI (camelCase; mapped to the API shape). */
export interface ScheduleSlotInput {
  startTime: string;
  endTime: string;
  days: Weekday[];
  action: 'charge' | 'discharge';
  powerW: number;
}

/**
 * Push a day/hour schedule to a device, mapping the UI slots to the API's
 * snake_case body. The device does not report its current schedule, so this is
 * write-only.
 * @param deviceId - the device to program
 * @param slots - the schedule slots to push
 * @returns the normalized result
 */
export function postSchedule(
  deviceId: number,
  slots: ScheduleSlotInput[],
): Promise<PostResult> {
  /* eslint-disable camelcase -- the schedule API body uses snake_case keys */
  const body = {
    slots: slots.map((slot) => ({
      start_time: slot.startTime,
      end_time: slot.endTime,
      days: slot.days,
      action: slot.action,
      power_w: slot.powerW,
    })),
  };
  /* eslint-enable camelcase */
  const count = `${slots.length} slot${slots.length === 1 ? '' : 's'}`;
  return postControl(
    `/api/devices/${deviceId}/schedule`,
    body,
    `Schedule pushed (${count}).`,
  );
}

/**
 * POST a JSON body to a control endpoint and normalize the result to a
 * {@link PostResult}. Never throws — network/parse failures map to `ok: false`.
 * @param url - the endpoint to call
 * @param body - the JSON request body
 * @param successText - message to show when the request succeeds
 * @returns the normalized result
 */
export async function postControl(
  url: string,
  body: unknown,
  successText: string,
): Promise<PostResult> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    if (response.ok) return { ok: true, text: successText };
    return { ok: false, text: data?.error ?? 'Request failed.' };
  } catch (error) {
    return {
      ok: false,
      text: error instanceof Error ? error.message : String(error),
    };
  }
}
