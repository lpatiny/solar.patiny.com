import { Intent, NonIdealState, ProgressBar, Tag } from '@blueprintjs/core';

import type { RealtimeData } from '../HomePage.tsx';

interface ElectricalCardProps {
  realtime: RealtimeData | null;
}

function fmt(value: number | null, digits = 0, unit = ''): string {
  if (value === null) return '—';
  return `${value.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
}

function fmtW(value: number | null): string {
  if (value === null) return '—';
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2)} kW`;
  return `${Math.round(value)} W`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <div
      style={{
        color: 'var(--text-secondary)',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        marginBottom: 10,
        marginTop: 20,
        paddingBottom: 4,
        borderBottom: '1px solid var(--border)',
      }}
    >
      {title}
    </div>
  );
}

function ParamRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '5px 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
        {label}
      </span>
      <span
        style={{ fontWeight: 600, fontSize: 13, color: color ?? 'inherit' }}
      >
        {value}
      </span>
    </div>
  );
}

function PvStringRow({
  label,
  powerW,
  maxW,
}: {
  label: string;
  powerW: number | null;
  maxW: number;
}) {
  const pct = powerW !== null && maxW > 0 ? powerW / maxW : 0;
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 4,
        }}
      >
        <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
          {label}
        </span>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{fmtW(powerW)}</span>
      </div>
      <ProgressBar
        value={Math.min(1, Math.max(0, pct))}
        intent={Intent.WARNING}
        animate={false}
        stripes={false}
      />
    </div>
  );
}

function ModbusStatusTag({
  status,
  error,
}: {
  status: 'ok' | 'error' | 'disabled';
  error: string | null;
}) {
  if (status === 'ok') {
    return (
      <Tag intent={Intent.SUCCESS} minimal>
        Connected
      </Tag>
    );
  }
  if (status === 'error') {
    return (
      <Tag intent={Intent.DANGER} minimal title={error ?? undefined}>
        Error
      </Tag>
    );
  }
  return <Tag minimal>Disabled</Tag>;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ElectricalCard({ realtime }: ElectricalCardProps) {
  const status = realtime?.modbus_status ?? 'disabled';
  const error = realtime?.modbus_error ?? null;

  const pv1 = realtime?.pv1_power_w ?? null;
  const pv2 = realtime?.pv2_power_w ?? null;
  const totalPv = (pv1 ?? 0) + (pv2 ?? 0);
  const meterPower = realtime?.meter_power_w ?? null;
  const meterImport = meterPower !== null ? Math.max(0, meterPower) : null;
  const meterExport = meterPower !== null ? Math.max(0, -meterPower) : null;

  return (
    <div className="card">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <span className="card-title" style={{ marginBottom: 0 }}>
          Electrical Detail
        </span>
        <ModbusStatusTag status={status} error={error} />
      </div>

      {status === 'disabled' && (
        <NonIdealState
          icon="offline"
          title="Modbus disabled"
          description={
            <span>
              Set <code>MODBUS_ENABLED=true</code> in your <code>.env</code> and
              restart.
            </span>
          }
        />
      )}

      {status === 'error' && (
        <NonIdealState
          icon="error"
          title="Modbus TCP connection failed"
          description={error ?? 'Unknown error'}
        />
      )}

      {status === 'ok' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '0 40px',
          }}
        >
          {/* ── Left column ── */}
          <div>
            <SectionHeader title="PV Strings" />
            <PvStringRow label="String 1" powerW={pv1} maxW={totalPv} />
            <PvStringRow label="String 2" powerW={pv2} maxW={totalPv} />
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-secondary)',
                marginTop: 4,
              }}
            >
              Total:{' '}
              <strong style={{ color: 'var(--solar)' }}>
                {fmtW(totalPv > 0 ? totalPv : null)}
              </strong>
            </div>

            <SectionHeader title="Grid Meter" />
            <ParamRow
              label="Import (from grid)"
              value={fmt(meterImport, 0, 'W')}
              color={
                meterImport && meterImport > 10
                  ? 'var(--grid-import)'
                  : undefined
              }
            />
            <ParamRow
              label="Export (to grid)"
              value={fmt(meterExport, 0, 'W')}
              color={
                meterExport && meterExport > 10
                  ? 'var(--grid-export)'
                  : undefined
              }
            />
            <ParamRow
              label="Net power"
              value={fmt(meterPower, 0, 'W')}
              color={
                meterPower !== null
                  ? meterPower > 10
                    ? 'var(--grid-import)'
                    : meterPower < -10
                      ? 'var(--grid-export)'
                      : undefined
                  : undefined
              }
            />
          </div>

          {/* ── Right column ── */}
          <div>
            <SectionHeader title="Inverter AC Output" />
            <ParamRow
              label="AC Power"
              value={fmtW(realtime?.ac_power_w ?? null)}
              color="var(--solar)"
            />
            <ParamRow
              label="Frequency"
              value={fmt(realtime?.frequency_hz ?? null, 2, 'Hz')}
            />
            <ParamRow
              label="Phase A voltage"
              value={fmt(realtime?.voltage_a_v ?? null, 1, 'V')}
            />
            <ParamRow
              label="Phase B voltage"
              value={fmt(realtime?.voltage_b_v ?? null, 1, 'V')}
            />
            <ParamRow
              label="Phase C voltage"
              value={fmt(realtime?.voltage_c_v ?? null, 1, 'V')}
            />

            <SectionHeader title="Battery (BYD HVM 11.0)" />
            <ParamRow
              label="State of charge"
              value={fmt(realtime?.battery_soc ?? null, 1, '%')}
              color="var(--battery)"
            />
            <ParamRow
              label="Charging power"
              value={fmtW(realtime?.battery_charging_w ?? null)}
              color="var(--grid-export)"
            />
            <ParamRow
              label="Discharging power"
              value={fmtW(realtime?.battery_discharging_w ?? null)}
              color="var(--consumption)"
            />
          </div>
        </div>
      )}
    </div>
  );
}
