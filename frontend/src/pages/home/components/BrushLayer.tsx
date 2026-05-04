import { useCallback, useState } from 'react';

interface BrushLayerProps {
  innerWidth: number;
  innerHeight: number;
  onZoom: (startFraction: number, endFraction: number) => void;
  onReset: () => void;
}

interface Brush {
  start: number;
  current: number;
}

export function BrushLayer({
  innerWidth,
  innerHeight,
  onZoom,
  onReset,
}: BrushLayerProps) {
  const [brush, setBrush] = useState<Brush | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setBrush({ start: x, current: x });
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGRectElement>) => {
      if (!brush) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.max(0, Math.min(innerWidth, e.clientX - rect.left));
      setBrush((prev) => (prev ? { ...prev, current: x } : null));
    },
    [brush, innerWidth],
  );

  const commit = useCallback(() => {
    if (!brush) return;
    const minX = Math.min(brush.start, brush.current);
    const maxX = Math.max(brush.start, brush.current);
    if (maxX - minX > 5) {
      const startFraction = minX / innerWidth;
      const endFraction = maxX / innerWidth;
      if (endFraction > startFraction) {
        onZoom(startFraction, endFraction);
      }
    }
    setBrush(null);
  }, [brush, innerWidth, onZoom]);

  const selX = brush ? Math.min(brush.start, brush.current) : 0;
  const selW = brush ? Math.abs(brush.current - brush.start) : 0;

  return (
    <g>
      {brush && selW > 2 && (
        <rect
          x={selX}
          y={0}
          width={selW}
          height={innerHeight}
          fill="rgba(148,163,184,0.12)"
          stroke="#94a3b8"
          strokeWidth={1}
          pointerEvents="none"
        />
      )}
      <rect
        x={0}
        y={0}
        width={innerWidth}
        height={innerHeight}
        fill="transparent"
        style={{ cursor: 'crosshair', pointerEvents: 'all' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={commit}
        onMouseLeave={commit}
        onDoubleClick={onReset}
      />
    </g>
  );
}
