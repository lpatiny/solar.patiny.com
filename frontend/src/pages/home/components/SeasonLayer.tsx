interface SeasonLayerProps {
  innerWidth: number;
  innerHeight: number;
  timestamps: number[];
}

type Half = 'summer' | 'winter';

function getSolarHalf(timestamp: number): Half {
  const month = new Date(timestamp * 1000).getMonth(); // 0 = Jan
  return month >= 3 && month <= 8 ? 'summer' : 'winter';
}

const halfFill: Record<Half, string> = {
  summer: 'rgba(251, 191, 36, 0.07)',
  winter: 'rgba(96, 165, 250, 0.07)',
};

export function SeasonLayer({
  innerWidth,
  innerHeight,
  timestamps,
}: SeasonLayerProps) {
  if (timestamps.length < 2) return null;

  const step = innerWidth / (timestamps.length - 1);
  const halfStep = step / 2;

  const bands: Array<{ startIdx: number; endIdx: number; half: Half }> = [];
  let half = getSolarHalf(timestamps[0]!);
  let bandStart = 0;

  for (let i = 1; i < timestamps.length; i++) {
    const h = getSolarHalf(timestamps[i]!);
    if (h !== half) {
      bands.push({ startIdx: bandStart, endIdx: i - 1, half });
      half = h;
      bandStart = i;
    }
  }
  bands.push({ startIdx: bandStart, endIdx: timestamps.length - 1, half });

  return (
    <g>
      {bands.map((band) => {
        const x = Math.max(0, band.startIdx * step - halfStep);
        const endX = Math.min(innerWidth, band.endIdx * step + halfStep);
        return (
          <rect
            key={band.startIdx}
            x={x}
            y={0}
            width={endX - x}
            height={innerHeight}
            fill={halfFill[band.half]}
          />
        );
      })}
    </g>
  );
}
