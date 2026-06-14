interface IconProps {
  x: number;
  y: number;
  color: string;
}

/**
 * Sun glyph (filled disc with radiating rays) for the solar-production node.
 * @param root0 - Icon props.
 * @param root0.x - Center x.
 * @param root0.y - Center y.
 * @param root0.color - Stroke/fill color.
 * @returns The sun icon group.
 */
export function SunIcon({ x, y, color }: IconProps) {
  const rays = [];
  for (let index = 0; index < 8; index++) {
    const angle = (Math.PI / 4) * index;
    rays.push(
      <line
        key={index}
        x1={x + Math.cos(angle) * 11}
        y1={y + Math.sin(angle) * 11}
        x2={x + Math.cos(angle) * 16}
        y2={y + Math.sin(angle) * 16}
        style={{ stroke: color, strokeWidth: 2, strokeLinecap: 'round' }}
      />,
    );
  }
  return (
    <g>
      <circle cx={x} cy={y} r={7} style={{ fill: color }} />
      {rays}
    </g>
  );
}

/**
 * Lightning-bolt glyph for the grid node.
 * @param root0 - Icon props.
 * @param root0.x - Center x.
 * @param root0.y - Center y.
 * @param root0.color - Fill color.
 * @returns The grid icon.
 */
export function GridIcon({ x, y, color }: IconProps) {
  const d = `M ${x + 3} ${y - 12} L ${x - 7} ${y + 2} L ${x - 1} ${y + 2} L ${x - 3} ${y + 12} L ${x + 8} ${y - 3} L ${x + 1} ${y - 3} Z`;
  return <path d={d} style={{ fill: color }} />;
}

/**
 * House glyph for the home-consumption node.
 * @param root0 - Icon props.
 * @param root0.x - Center x.
 * @param root0.y - Center y.
 * @param root0.color - Stroke/fill color.
 * @returns The home icon group.
 */
export function HomeIcon({ x, y, color }: IconProps) {
  return (
    <g style={{ fill: 'none', stroke: color, strokeWidth: 2 }}>
      <path
        d={`M ${x - 11} ${y + 10} L ${x - 11} ${y - 1} L ${x} ${y - 11} L ${x + 11} ${y - 1} L ${x + 11} ${y + 10} Z`}
        strokeLinejoin="round"
      />
      <rect
        x={x - 3}
        y={y + 2}
        width={6}
        height={8}
        style={{ fill: color, stroke: 'none' }}
      />
    </g>
  );
}

interface BatteryIconProps extends IconProps {
  soc: number | null;
}

/**
 * Battery glyph whose inner bar fills proportionally to the state of charge.
 * @param root0 - Icon props plus the state of charge.
 * @param root0.x - Center x.
 * @param root0.y - Center y.
 * @param root0.color - Stroke/fill color.
 * @param root0.soc - State of charge in percent, or null when unknown.
 * @returns The battery icon group.
 */
export function BatteryIcon({ x, y, color, soc }: BatteryIconProps) {
  const width = 26;
  const height = 14;
  const left = x - width / 2;
  const top = y - height / 2;
  const ratio = soc == null ? 0 : Math.min(Math.max(soc, 0), 100) / 100;
  return (
    <g>
      <rect
        x={left}
        y={top}
        width={width}
        height={height}
        rx={3}
        style={{ fill: 'none', stroke: color, strokeWidth: 2 }}
      />
      <rect
        x={left + width}
        y={y - 3}
        width={2.5}
        height={6}
        style={{ fill: color }}
      />
      {soc != null && (
        <rect
          x={left + 1.5}
          y={top + 1.5}
          width={(width - 3) * ratio}
          height={height - 3}
          rx={1.5}
          style={{ fill: color }}
        />
      )}
    </g>
  );
}

/**
 * Inverter glyph (rounded box with a wave) for the central hub.
 * @param root0 - Icon props.
 * @param root0.x - Center x.
 * @param root0.y - Center y.
 * @param root0.color - Stroke color.
 * @returns The inverter icon group.
 */
export function InverterIcon({ x, y, color }: IconProps) {
  return (
    <g style={{ fill: 'none', stroke: color, strokeWidth: 2 }}>
      <rect x={x - 14} y={y - 14} width={28} height={28} rx={6} />
      <path
        d={`M ${x - 8} ${y + 3} Q ${x - 4} ${y - 7} ${x} ${y} T ${x + 8} ${y - 3}`}
        strokeLinecap="round"
      />
    </g>
  );
}
