import type { SquareOrigin } from './ledLayout.ts';
import { LED_RADIUS, ledCenter } from './ledLayout.ts';
import type { LedScale } from './ledScale.ts';
import {
  CENTER_LED_COUNT,
  RING_LED_COUNT,
  SQUARE_SIDE,
  centerCell,
  ledLevels,
  ringCell,
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

interface LedSquareProps {
  origin: SquareOrigin;
  value: number;
  scale: LedScale;
  colors: LedColors;
}

/**
 * One 5×5 quantity square of the wall. The 16 LEDs around the edge each carry a
 * coarse unit and the 3×3 centre carries the remainder in fine units; past a
 * full ring the whole square lights up to signal an off-scale value.
 * @param root0 - Component props.
 * @param root0.origin - Top-left corner of the square, in wall coordinates.
 * @param root0.value - The quantity to display.
 * @param root0.scale - What one ring LED and one centre LED are worth.
 * @param root0.colors - The lit and unlit colours for this quantity.
 * @returns The square's LEDs.
 */
export default function LedSquare({
  origin,
  value,
  scale,
  colors,
}: LedSquareProps) {
  const { ring, center, saturated } = ledLevels(value, scale);

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
      litColors.set(`${cell.row}:${cell.column}`, colors.high);
    }
    for (let index = 0; index < Math.min(center, CENTER_LED_COUNT); index++) {
      const cell = centerCell(index);
      litColors.set(`${cell.row}:${cell.column}`, colors.low);
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
