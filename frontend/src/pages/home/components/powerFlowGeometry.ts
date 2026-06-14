/** A point in the diagram's SVG coordinate space. */
export interface Point {
  x: number;
  y: number;
}

/** Center of the inverter hub all flows pass through. */
export const HUB: Point = { x: 340, y: 250 };
/** Radius of a peripheral node circle. */
export const NODE_R = 40;
/** Radius of the central hub circle. */
export const HUB_R = 44;
/** Fixed peripheral node positions around the hub. */
export const SOLAR: Point = { x: 340, y: 80 };
export const GRID: Point = { x: 86, y: 250 };
export const HOME: Point = { x: 594, y: 250 };

/** Power magnitudes below this (in watts) are treated as no flow. */
export const FLOW_THRESHOLD_W = 15;

/**
 * Evenly spread the battery nodes along the bottom of the diagram.
 * @param count - Number of batteries to lay out.
 * @returns One position per battery, left to right.
 */
export function batteryPositions(count: number): Point[] {
  const y = 470;
  if (count <= 0) return [];
  if (count === 1) return [{ x: HUB.x, y }];
  const left = 150;
  const right = 530;
  const step = (right - left) / (count - 1);
  const points: Point[] = [];
  for (let index = 0; index < count; index++) {
    points.push({ x: left + step * index, y });
  }
  return points;
}

/**
 * Straight path from the hub edge to a node edge, trimmed so it starts and ends
 * on the circle outlines rather than their centers.
 * @param node - The peripheral node center.
 * @returns An SVG path `d` string.
 */
export function edgePath(node: Point): string {
  const dx = node.x - HUB.x;
  const dy = node.y - HUB.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const sx = HUB.x + ux * HUB_R;
  const sy = HUB.y + uy * HUB_R;
  const ex = node.x - ux * NODE_R;
  const ey = node.y - uy * NODE_R;
  return `M ${sx.toFixed(1)} ${sy.toFixed(1)} L ${ex.toFixed(1)} ${ey.toFixed(1)}`;
}

/** Slowest dot animation, in seconds — a barely-perceptible drift for tiny flows. */
const MAX_FLOW_DURATION_S = 22;
/** Fastest dot animation, in seconds — a calm but clear stream for strong flows. */
const MIN_FLOW_DURATION_S = 2.5;
/**
 * Reference constant tuned so the dot speed tracks the real power: the duration
 * is `REF / watts`, giving ~20 s at 50 W, ~5 s at 200 W, ~2.5 s at 400 W.
 */
const FLOW_DURATION_REF = 1000;

/**
 * Map a power magnitude to a dot-travel duration so the animation speed reflects
 * the *real* amount of power: the dots move proportionally faster as the power
 * rises (duration ∝ 1 / watts), clamped between a near-still drift below ~45 W
 * and a calm stream above ~400 W.
 * @param watts - Absolute power in watts.
 * @returns Animation duration in seconds.
 */
export function flowDuration(watts: number): number {
  const abs = Math.abs(watts);
  if (abs < 1) return MAX_FLOW_DURATION_S;
  const duration = FLOW_DURATION_REF / abs;
  return Math.min(MAX_FLOW_DURATION_S, Math.max(MIN_FLOW_DURATION_S, duration));
}

/**
 * Format a power magnitude, switching to kW above 1000 W.
 * @param watts - Power in watts (sign ignored).
 * @returns e.g. "149 W" or "1.20 kW".
 */
export function formatW(watts: number): string {
  const abs = Math.abs(watts);
  return abs >= 1000 ? `${(abs / 1000).toFixed(2)} kW` : `${Math.round(abs)} W`;
}
