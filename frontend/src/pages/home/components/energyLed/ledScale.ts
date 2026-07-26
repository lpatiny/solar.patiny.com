/**
 * Value → LED mapping for the energy wall, mirroring the physical panel
 * firmware (hackuarium/esp32-c3, `src/pixels/meteo/froniusDisplay.cpp`). Each
 * quantity is one 5×5 square: the 16 LEDs *around* it each stand for a coarse
 * unit, and the 3×3 block *inside* it carries the remainder in fine units.
 */

/** LEDs on the perimeter ("around") of one square. */
export const RING_LED_COUNT = 16;
/** LEDs in the 3×3 centre ("inside") of one square. */
export const CENTER_LED_COUNT = 9;
/** Side of one square, in LEDs. */
export const SQUARE_SIDE = 5;

/** What one ring LED and one centre LED are worth. */
export interface LedScale {
  /** Value one lit ring LED (around) stands for. */
  ringUnit: number;
  /** Value one lit centre LED (inside) stands for. */
  centerUnit: number;
}

/** Solar, consumption and grid squares: 500 W around, 50 W inside. */
export const POWER_SCALE: LedScale = { ringUnit: 500, centerUnit: 50 };
/**
 * The battery square holds energy: 1.25 kWh around, 125 Wh inside. A full ring
 * is 20 kWh, sized so the ~21.3 kWh fleet reads across almost the whole ring.
 */
export const ENERGY_SCALE: LedScale = { ringUnit: 1250, centerUnit: 125 };

/** How many ring and centre LEDs to light in one square. */
export interface LedLevels {
  /** Lit ring LEDs, clockwise from the top-left corner (0–16). */
  ring: number;
  /** Lit centre LEDs, row-major in the 3×3 block (0–9). */
  center: number;
  /** True when the value exceeds the full ring, so the whole square lights up. */
  saturated: boolean;
}

/**
 * Split a value into lit ring and centre LEDs, exactly as `paintSquare` does on
 * the panel: `ring = floor(value / ringUnit)` and the remainder fills the centre
 * in `centerUnit` steps. Past a full ring the square saturates and lights
 * completely, which is the panel's "off the scale" signal.
 * @param value - The quantity to display (W for power, Wh for energy).
 * @param scale - What one ring LED and one centre LED are worth.
 * @returns The lit-LED counts and whether the square is saturated.
 */
export function ledLevels(value: number, scale: LedScale): LedLevels {
  const safe = Math.max(value, 0);
  const ring = Math.floor(safe / scale.ringUnit);
  if (ring > RING_LED_COUNT) {
    return { ring: RING_LED_COUNT, center: CENTER_LED_COUNT, saturated: true };
  }
  const remainder = safe - ring * scale.ringUnit;
  const center = Math.min(
    Math.floor(remainder / scale.centerUnit),
    CENTER_LED_COUNT,
  );
  return { ring, center, saturated: false };
}

/** How a square shared by two stacked sources splits between them. */
export interface StackedLedLevels extends LedLevels {
  /** Ring LEDs owned by the lower source; the rest belong to the upper one. */
  lowerRing: number;
  /** True when the centre remainder belongs to the upper source. */
  upperCenter: boolean;
}

/**
 * Split a square between two sources stacked in order: the lower one fills the
 * ring first and the upper one continues where it stops, so the boundary shows
 * how the total is shared. The lit-LED counts come from the total exactly as in
 * {@link ledLevels}; only the colour boundary is added. The centre sits at the
 * top of the stack, so it belongs to the upper source as soon as that source
 * holds at least one centre unit.
 * @param lowerValue - Amount contributed by the source drawn first.
 * @param upperValue - Amount contributed by the source stacked on top.
 * @param scale - What one ring LED and one centre LED are worth.
 * @returns The lit-LED counts plus where the two sources meet.
 */
export function stackedLedLevels(
  lowerValue: number,
  upperValue: number,
  scale: LedScale,
): StackedLedLevels {
  const lower = Math.max(lowerValue, 0);
  const upper = Math.max(upperValue, 0);
  const levels = ledLevels(lower + upper, scale);
  return {
    ...levels,
    lowerRing: Math.min(Math.round(lower / scale.ringUnit), levels.ring),
    upperCenter: upper >= scale.centerUnit,
  };
}

/** Row of each ring LED within its square, clockwise from the top-left corner. */
const RING_ROWS = [0, 0, 0, 0, 0, 1, 2, 3, 4, 4, 4, 4, 4, 3, 2, 1];
/** Column of each ring LED, matching {@link RING_ROWS}. */
const RING_COLUMNS = [0, 1, 2, 3, 4, 4, 4, 4, 4, 3, 2, 1, 0, 0, 0, 0];

/** A LED position inside a square, in square-local row/column coordinates. */
export interface LedCell {
  row: number;
  column: number;
}

/**
 * Position of a ring LED within its square, walking the perimeter clockwise from
 * the top-left corner — the same order the panel fills it in.
 * @param index - Ring LED index (0–15).
 * @returns The square-local row and column.
 */
export function ringCell(index: number): LedCell {
  return { row: RING_ROWS[index] ?? 0, column: RING_COLUMNS[index] ?? 0 };
}

/**
 * Position of a centre LED within its square: the 3×3 block filled row by row.
 * @param index - Centre LED index (0–8).
 * @returns The square-local row and column.
 */
export function centerCell(index: number): LedCell {
  return { row: 1 + Math.floor(index / 3), column: 1 + (index % 3) };
}

/** Below this many watts a link is idle: no travelling dots, just the dim rail. */
export const FLUX_THRESHOLD_W = 25;

/** LEDs in one flux link, of which every third one is lit and marching. */
export const FLUX_LED_COUNT = 6;

/** Slowest march, in LED pitches per second (the panel's 1 step per 25 frames). */
const MIN_FLUX_SPEED = 1;
/** Fastest march, in LED pitches per second (the panel's 1 step per 2 frames). */
const MAX_FLUX_SPEED = 12.5;
/** Watts per LED pitch per second, tuned to the panel's power tiers. */
const WATTS_PER_SPEED_UNIT = 400;

/**
 * Time for the marching dots to advance one LED pitch, so the animation speed
 * tracks the power actually being transferred. Calibrated on the panel's tiers:
 * ~1 kW marches at 2.5 pitches/s and anything past 5 kW at 12.5 pitches/s.
 * @param watts - Power on the link, in watts.
 * @returns Duration of one step, in seconds.
 */
export function fluxStepSeconds(watts: number): number {
  const speed = Math.min(
    MAX_FLUX_SPEED,
    Math.max(MIN_FLUX_SPEED, Math.abs(watts) / WATTS_PER_SPEED_UNIT),
  );
  return 1 / speed;
}

/**
 * Format an energy amount, switching to kWh above 1000 Wh.
 * @param wattHours - Energy in watt-hours.
 * @returns e.g. "740 Wh" or "12.4 kWh".
 */
export function formatWh(wattHours: number): string {
  const abs = Math.abs(wattHours);
  return abs >= 1000
    ? `${(abs / 1000).toFixed(1)} kWh`
    : `${Math.round(abs)} Wh`;
}
