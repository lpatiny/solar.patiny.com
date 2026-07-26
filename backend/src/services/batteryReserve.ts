import { db } from '../db/Database.ts';

/**
 * The reserve floors: the bottom slice of each pack that must never be
 * discharged. Everything that reports a battery level — the config route, the
 * auto strategy's discharge floor and the energy-flow levels — reads them from
 * here, so a change lands everywhere at once.
 */

/** Settings key for the Fronius BYD reserve. */
export const BYD_RESERVE_KEY = 'byd_reserve_pct';
/** Settings key for the per-battery Marstek reserve. */
export const MARSTEK_RESERVE_KEY = 'marstek_reserve_pct';

/** Reserve floor of the BYD pack, in percent. */
export const BYD_RESERVE_DEFAULT = 7;
/**
 * Reserve floor of each Marstek pack, in percent. The Venus E firmware caps its
 * depth of discharge at 88 % (`DOD.SET` accepts 30–88), so it stops on its own at
 * 12 % SOC at the very deepest; 20 % leaves a margin above that hard floor.
 */
export const MARSTEK_RESERVE_DEFAULT = 20;

/**
 * Current BYD reserve floor.
 * @returns The reserve in percent.
 */
export function getBydReservePct(): number {
  return readPct(BYD_RESERVE_KEY, BYD_RESERVE_DEFAULT);
}

/**
 * Current Marstek reserve floor, applied to every Marstek pack.
 * @returns The reserve in percent.
 */
export function getMarstekReservePct(): number {
  return readPct(MARSTEK_RESERVE_KEY, MARSTEK_RESERVE_DEFAULT);
}

/** A pack's energy and capacity once its reserve floor is taken out. */
export interface UsableEnergy {
  /** Energy stored above the floor, in Wh — zero once the pack is "empty". */
  storedWh: number;
  /** Capacity above the floor, in Wh. */
  capacityWh: number;
}

/**
 * Re-express a pack over only its usable range, so a battery sitting exactly on
 * its reserve floor reads as empty rather than as a permanently-lit remainder.
 * Below the floor the stored energy clamps to zero instead of going negative.
 * @param socPct - Raw state of charge in percent.
 * @param capacityWh - Nominal capacity in Wh.
 * @param reservePct - The floor that must never be discharged, in percent.
 * @returns The stored energy and capacity above the floor.
 */
export function usableEnergy(
  socPct: number,
  capacityWh: number,
  reservePct: number,
): UsableEnergy {
  const reserve = Math.min(Math.max(reservePct, 0), 99);
  const span = 100 - reserve;
  return {
    storedWh: Math.max(((socPct - reserve) / 100) * capacityWh, 0),
    capacityWh: (capacityWh * span) / 100,
  };
}

function readPct(key: string, fallback: number): number {
  const raw = db.getSetting(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}
