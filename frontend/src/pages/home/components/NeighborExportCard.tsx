interface NeighborExportCardProps {
  gridInjectionW: number;
  todayExportKwh?: number;
}

function formatW(w: number): string {
  if (w >= 1000) return `${(w / 1000).toFixed(2)} kW`;
  return `${Math.round(w)} W`;
}

export default function NeighborExportCard({
  gridInjectionW,
  todayExportKwh,
}: NeighborExportCardProps) {
  const isExporting = gridInjectionW > 10;

  return (
    <div
      className="card"
      style={{
        borderColor: isExporting ? '#065f46' : 'var(--border)',
        background: isExporting ? '#022c22' : 'var(--surface)',
      }}
    >
      <span className="card-title">Available for Neighbours</span>

      <div
        className="value-large"
        style={{
          color: isExporting ? 'var(--grid-export)' : 'var(--text-secondary)',
          fontSize: 36,
          marginBottom: 4,
        }}
      >
        {isExporting ? formatW(gridInjectionW) : '0 W'}
      </div>

      <p
        style={{
          color: isExporting ? '#6ee7b7' : 'var(--text-secondary)',
          fontSize: 13,
          marginTop: 4,
          marginBottom: 16,
        }}
      >
        {isExporting
          ? 'Currently injecting into the grid'
          : 'No surplus power right now'}
      </p>

      {todayExportKwh !== undefined && (
        <div
          style={{
            background: 'var(--surface-raised)',
            borderRadius: 8,
            padding: '10px 12px',
          }}
        >
          <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
            Exported today
          </span>
          <div
            style={{
              fontWeight: 700,
              fontSize: 20,
              color: 'var(--grid-export)',
            }}
          >
            {todayExportKwh.toFixed(2)}{' '}
            <span
              style={{
                fontWeight: 400,
                fontSize: 13,
                color: 'var(--text-secondary)',
              }}
            >
              kWh
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
