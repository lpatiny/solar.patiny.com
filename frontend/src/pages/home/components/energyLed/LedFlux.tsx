import type { FluxTrack } from './ledLayout.ts';
import { LED_RADIUS, fluxCells, ledCenter } from './ledLayout.ts';
import { FLUX_THRESHOLD_W, fluxStepSeconds } from './ledScale.ts';

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
 * Below the idle threshold only the dim rail is drawn.
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
    </g>
  );
}
