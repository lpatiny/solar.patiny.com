/**
 * Geometry of the 16×16 LED wall, in the same row/column coordinates the panel
 * firmware uses (hackuarium/esp32-c3, `src/pixels/meteo/froniusDisplay.cpp`), so
 * the web view is laid out exactly like the physical wall.
 */

/** LEDs per side of the wall. */
export const WALL_SIDE = 16;
/** Distance between two LED centres, in SVG units. */
export const LED_PITCH = 34;
/** Radius of one LED, in SVG units. */
export const LED_RADIUS = 12;

/** Top-left corner of one square, in wall row/column coordinates. */
export interface SquareOrigin {
  row: number;
  column: number;
}

/** Solar production — top-left, as on the wall. */
export const SOLAR_ORIGIN: SquareOrigin = { row: 0, column: 0 };
/** Battery level — top-right. */
export const BATTERY_ORIGIN: SquareOrigin = { row: 0, column: 11 };
/** Grid — bottom-left. */
export const GRID_ORIGIN: SquareOrigin = { row: 11, column: 0 };
/** Household consumption — bottom-right. */
export const CONSUMPTION_ORIGIN: SquareOrigin = { row: 11, column: 11 };

/** A flux link: six LEDs marching from one square to another. */
export interface FluxTrack {
  from: SquareOrigin;
  to: SquareOrigin;
}

/** Grid → consumption, along the bottom. */
export const GRID_TO_HOME_TRACK: FluxTrack = {
  from: { row: 13, column: 5 },
  to: { row: 13, column: 11 },
};
/** Solar → grid, down the left side. */
export const SOLAR_TO_GRID_TRACK: FluxTrack = {
  from: { row: 5, column: 2 },
  to: { row: 11, column: 2 },
};
/** Solar → battery, along the top. */
export const SOLAR_TO_BATTERY_TRACK: FluxTrack = {
  from: { row: 2, column: 5 },
  to: { row: 2, column: 11 },
};
/** Solar → consumption, across the main diagonal. */
export const SOLAR_TO_HOME_TRACK: FluxTrack = {
  from: { row: 5, column: 5 },
  to: { row: 11, column: 11 },
};
/** Battery → consumption, down the right side. */
export const BATTERY_TO_HOME_TRACK: FluxTrack = {
  from: { row: 5, column: 13 },
  to: { row: 11, column: 13 },
};
/**
 * Battery ↔ grid, across the anti-diagonal. Absent from the panel firmware,
 * which only knows the Fronius battery; here the Marstek units can be charged
 * from the grid (or discharged into it), so the link is real and needs showing.
 */
export const BATTERY_GRID_TRACK: FluxTrack = {
  from: { row: 5, column: 10 },
  to: { row: 11, column: 4 },
};

/**
 * The six LED positions of a flux track, stepping evenly from `from` to `to` —
 * the same walk `paintFlux` performs on the panel.
 * @param track - The link's endpoints, in wall coordinates.
 * @returns One position per LED, in travel order.
 */
export function fluxCells(track: FluxTrack): SquareOrigin[] {
  const rowStep = (track.to.row - track.from.row) / 6;
  const columnStep = (track.to.column - track.from.column) / 6;
  const cells: SquareOrigin[] = [];
  for (let index = 0; index < 6; index++) {
    cells.push({
      row: track.from.row + rowStep * index,
      column: track.from.column + columnStep * index,
    });
  }
  return cells;
}

/**
 * Centre of a LED in SVG units.
 * @param row - Wall row.
 * @param column - Wall column.
 * @returns The LED centre.
 */
export function ledCenter(
  row: number,
  column: number,
): { x: number; y: number } {
  return {
    x: column * LED_PITCH + LED_PITCH / 2,
    y: row * LED_PITCH + LED_PITCH / 2,
  };
}

/** Width and height of the wall itself, in SVG units. */
export const WALL_SIZE = WALL_SIDE * LED_PITCH;
