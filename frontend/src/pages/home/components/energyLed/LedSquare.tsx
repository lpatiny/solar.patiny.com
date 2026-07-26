import type { SquareOrigin } from './ledLayout.ts';
import { LED_RADIUS, ledCenter } from './ledLayout.ts';
import type { LedScale } from './ledScale.ts';
import {
  CENTER_LED_COUNT,
  RING_LED_COUNT,
  SQUARE_SIDE,
  centerCell,
  ringCell,
  stackedLedLevels,
} from './ledScale.ts';

/** The three brightness levels one square's LEDs are drawn at. */
export interface LedColors {
  /** Lit ring LED — the coarse unit. */
  high: string;
  /** Lit centre LED — the fine unit. */
  low: string;
  /** Unlit LED: the square's colour at a fraction of the brightness. */
  background: string;
}

/** A second quantity stacked on top of the square's own, in its own colours. */
export interface LedStack {
  value: number;
  colors: LedColors;
}

interface LedSquareProps {
  origin: SquareOrigin;
  value: number;
  scale: LedScale;
  colors: LedColors;
  stacked?: LedStack;
}

/**
 * One 5×5 quantity square of the wall. The 16 LEDs around the edge each carry a
 * coarse unit and the 3×3 centre carries the remainder in fine units; past a
 * full ring the whole square lights up to signal an off-scale value. With a
 * `stacked` source the square shows `value + stacked.value`, the ring filled by
 * `value` first and by the stacked amount after it, each in its own colour.
 * @param root0 - Component props.
 * @param root0.origin - Top-left corner of the square, in wall coordinates.
 * @param root0.value - The quantity to display, or the lower half of the stack.
 * @param root0.scale - What one ring LED and one centre LED are worth.
 * @param root0.colors - The lit and unlit colours for this quantity.
 * @param root0.stacked - A second quantity drawn on top, in its own colours.
 * @returns The square's LEDs.
 */
export default function LedSquare({
  origin,
  value,
  scale,
  colors,
  stacked,
}: LedSquareProps) {
  const { ring, center, saturated, lowerRing, upperCenter } = stackedLedLevels(
    value,
    stacked?.value ?? 0,
    scale,
  );
  const upperColors = stacked?.colors ?? colors;

  const litColors = new Map<string, string>();
  if (saturated) {
    for (let row = 0; row < SQUARE_SIDE; row++) {
      for (let column = 0; column < SQUARE_SIDE; column++) {
        litColors.set(`${row}:${column}`, colors.high);
      }
    }
  } else {
    for (let index = 0; index < Math.min(ring, RING_LED_COUNT); index++) {
      const cell = ringCell(index);
      const lit = index < lowerRing ? colors.high : upperColors.high;
      litColors.set(`${cell.row}:${cell.column}`, lit);
    }
    const centerColor = upperCenter ? upperColors.low : colors.low;
    for (let index = 0; index < Math.min(center, CENTER_LED_COUNT); index++) {
      const cell = centerCell(index);
      litColors.set(`${cell.row}:${cell.column}`, centerColor);
    }
  }

  const leds = [];
  for (let row = 0; row < SQUARE_SIDE; row++) {
    for (let column = 0; column < SQUARE_SIDE; column++) {
      const lit = litColors.get(`${row}:${column}`);
      const { x, y } = ledCenter(origin.row + row, origin.column + column);
      leds.push(
        <circle
          key={`${row}:${column}`}
          cx={x}
          cy={y}
          r={LED_RADIUS}
          fill={lit ?? colors.background}
          className={lit ? 'led-on' : undefined}
          style={lit ? { color: lit } : undefined}
        />,
      );
    }
  }

  return <g>{leds}</g>;
}
