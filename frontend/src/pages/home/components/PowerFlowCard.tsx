interface PowerFlowCardProps {
  productionW: number;
  gridW: number;
  batteryW: number;
  consumptionW: number;
  /** Combined energy currently stored across all batteries, in kWh. */
  totalStoredKwh?: number;
  isStale: boolean;
}

function formatW(w: number): string {
  if (Math.abs(w) >= 1000) return `${(w / 1000).toFixed(2)} kW`;
  return `${Math.round(w)} W`;
}

interface FlowRowProps {
  color: string;
  label: string;
  value: string;
  sub?: string;
}

function FlowRow({ color, label, value, sub }: FlowRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontWeight: 600, fontSize: 16 }}>{value}</span>
      {sub && (
        <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
          {sub}
        </span>
      )}
    </div>
  );
}

export default function PowerFlowCard({
  productionW,
  gridW,
  batteryW,
  consumptionW,
  totalStoredKwh,
  isStale,
}: PowerFlowCardProps) {
  const isExporting = gridW < 0;
  const isCharging = batteryW < 0;

  return (
    <div className="card">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <span className="card-title" style={{ marginBottom: 0 }}>
          Power Flow
        </span>
        {isStale && <span className="stale-badge">Stale</span>}
      </div>

      <FlowRow
        color="var(--solar)"
        label="Solar production"
        value={formatW(productionW)}
      />
      <FlowRow
        color="var(--consumption)"
        label="Home consumption"
        value={formatW(consumptionW)}
      />
      <FlowRow
        color={isExporting ? 'var(--grid-export)' : 'var(--grid-import)'}
        label={isExporting ? 'Grid export' : 'Grid import'}
        value={formatW(Math.abs(gridW))}
        sub={isExporting ? '→ neighbours' : '← from grid'}
      />
      <div style={{ borderBottom: 'none' }}>
        <FlowRow
          color="var(--battery)"
          label={isCharging ? 'Battery charging' : 'Battery discharging'}
          value={formatW(Math.abs(batteryW))}
          sub={
            totalStoredKwh === undefined
              ? undefined
              : `${totalStoredKwh.toFixed(1)} kWh stored`
          }
        />
      </div>
    </div>
  );
}
