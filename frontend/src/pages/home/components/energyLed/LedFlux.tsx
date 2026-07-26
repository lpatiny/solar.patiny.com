import { formatW } from '../powerFlowGeometry.ts';

import type { FluxTrack, SquareOrigin } from './ledLayout.ts';
import { LED_RADIUS, fluxCells, ledCenter } from './ledLayout.ts';
import { FLUX_THRESHOLD_W, fluxStepSeconds } from './ledScale.ts';

/** Height of the power chip drawn beside an active link, in SVG units. */
const LABEL_HEIGHT = 19;
/** Width one character of the reading takes, plus the chip's own padding. */
const LABEL_CHAR_WIDTH = 7.4;
const LABEL_PADDING = 12;

interface LedFluxProps {
  /** The link's endpoints; the dots always travel `from` → `to`. */
  track: FluxTrack;
  /** Power on the link in watts; drives the marching speed. */
  watts: number;
  /** Lit dot colour. */
  color: string;
  /** Unlit rail colour. */
  background: string;
}

/**
 * One link between two squares: six LEDs of which every third is lit, marching
 * from one square to the other. The step duration is inversely proportional to
 * the power, so a strong transfer visibly races and a trickle barely creeps.
 * Below the idle threshold only the dim rail is drawn. A link that carries a
 * `label` position also writes its power beside the dots, and drops it with them
 * when it goes idle.
 * @param root0 - Component props.
 * @param root0.track - The link's endpoints, in wall coordinates.
 * @param root0.watts - Power on the link, in watts.
 * @param root0.color - Lit dot colour.
 * @param root0.background - Unlit rail colour.
 * @returns The link's LEDs.
 */
export default function LedFlux({
  track,
  watts,
  color,
  background,
}: LedFluxProps) {
  const active = watts >= FLUX_THRESHOLD_W;
  const step = fluxStepSeconds(watts);
  const cells = fluxCells(track);

  return (
    <g>
      {cells.map((cell, index) => {
        const { x, y } = ledCenter(cell.row, cell.column);
        // The lit LED walks 0 → 1 → 2 and repeats, so LED `index` is on during
        // phase `index % 3`. A negative delay starts each LED already advanced
        // to its own phase of the shared three-step cycle.
        const delay = ((3 - (index % 3)) % 3) * step;
        return (
          <g key={`${cell.row}:${cell.column}`}>
            <circle cx={x} cy={y} r={LED_RADIUS} fill={background} />
            {active && (
              <circle
                cx={x}
                cy={y}
                r={LED_RADIUS}
                fill={color}
                className="led-on led-flux-dot"
                style={{
                  animationDelay: `-${delay.toFixed(3)}s`,
                  animationDuration: `${(step * 3).toFixed(3)}s`,
                  color,
                }}
              />
            )}
          </g>
        );
      })}
      {active && track.label && (
        <FluxLabel at={track.label} watts={watts} color={color} />
      )}
    </g>
  );
}

function FluxLabel({
  at,
  watts,
  color,
}: {
  at: SquareOrigin;
  watts: number;
  color: string;
}) {
  const text = formatW(watts);
  const { x, y } = ledCenter(at.row, at.column);
  const width = text.length * LABEL_CHAR_WIDTH + LABEL_PADDING;

  return (
    <g>
      <rect
        x={x - width / 2}
        y={y - LABEL_HEIGHT / 2}
        width={width}
        height={LABEL_HEIGHT}
        rx={LABEL_HEIGHT / 2}
        fill="rgba(5, 7, 12, 0.85)"
        stroke={color}
        strokeOpacity={0.35}
      />
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        style={{ fill: '#bfdbfe', fontSize: 12, fontWeight: 700 }}
      >
        {text}
      </text>
    </g>
  );
}
