interface SquareCaptionProps {
  /** Horizontal centre of the square being labelled. */
  x: number;
  /** Top of the caption band. */
  y: number;
  title: string;
  value: string;
  /** Extra state line under the value, e.g. "charging 1.2 kW". */
  sub?: string;
  /** A second state line under {@link sub}, e.g. how a level splits per pack. */
  extra?: string;
  /** The square's lit colour, used for the value. */
  color: string;
}

/**
 * Title, value and state line for one square of the energy wall, drawn in the
 * caption band above (top row) or below (bottom row) the wall.
 * @param root0 - Component props.
 * @param root0.x - Horizontal centre of the square being labelled.
 * @param root0.y - Top of the caption band.
 * @param root0.title - The quantity's name.
 * @param root0.value - The formatted quantity.
 * @param root0.sub - Optional state line under the value.
 * @param root0.extra - Optional second state line.
 * @param root0.color - The square's lit colour.
 * @returns The caption text.
 */
export default function SquareCaption({
  x,
  y,
  title,
  value,
  sub,
  extra,
  color,
}: SquareCaptionProps) {
  const titleY = y + 24;
  const valueY = titleY + 25;
  const subY = valueY + 17;
  const extraY = subY + 15;

  return (
    <g>
      <text
        x={x}
        y={titleY}
        textAnchor="middle"
        style={{
          fill: 'var(--text-secondary)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.08em',
        }}
      >
        {title.toUpperCase()}
      </text>
      <text
        x={x}
        y={valueY}
        textAnchor="middle"
        style={{ fill: color, fontSize: 19, fontWeight: 700 }}
      >
        {value}
      </text>
      {sub && (
        <text
          x={x}
          y={subY}
          textAnchor="middle"
          style={{ fill: 'var(--text-secondary)', fontSize: 11 }}
        >
          {sub}
        </text>
      )}
      {extra && (
        <text
          x={x}
          y={extraY}
          textAnchor="middle"
          style={{ fill: 'var(--text-secondary)', fontSize: 10 }}
        >
          {extra}
        </text>
      )}
    </g>
  );
}
