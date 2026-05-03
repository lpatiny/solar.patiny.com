import { Intent, Tag } from '@blueprintjs/core';

import type { ConfigData } from '../HomePage.tsx';

interface ConfigCardProps {
  config: ConfigData;
  modbusStatus: 'ok' | 'error' | 'disabled';
  modbusError: string | null;
}

function Row({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        alignItems: 'center',
        display: 'flex',
        gap: 8,
        justifyContent: 'space-between',
        padding: '5px 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
        {label}
      </span>
      <span style={{ fontSize: 12 }}>
        {value}
        {children}
      </span>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <div
      style={{
        color: 'var(--text-secondary)',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        marginBottom: 6,
        marginTop: 16,
      }}
    >
      {title}
    </div>
  );
}

export default function ConfigCard({
  config,
  modbusStatus,
  modbusError,
}: ConfigCardProps) {
  return (
    <div className="card">
      <span className="card-title">Configuration</span>

      <SectionTitle title="Fronius REST" />
      <Row label="Host" value={config.fronius_host} />
      <Row label="Poll interval" value={`${config.poll_interval_ms / 1000}s`} />

      <SectionTitle title="Modbus TCP" />
      <Row label="Status">
        {modbusStatus === 'ok' && (
          <Tag intent={Intent.SUCCESS} minimal>
            Connected
          </Tag>
        )}
        {modbusStatus === 'error' && (
          <Tag intent={Intent.DANGER} minimal>
            Error
          </Tag>
        )}
        {modbusStatus === 'disabled' && <Tag minimal>Disabled</Tag>}
      </Row>
      {config.modbus_enabled && (
        <Row
          label="Host"
          value={`${config.modbus_host}:${config.modbus_port}`}
        />
      )}
      {modbusError && (
        <div
          style={{
            color: '#fca5a5',
            fontSize: 11,
            marginTop: 4,
            wordBreak: 'break-all',
            fontFamily: 'monospace',
          }}
        >
          {modbusError}
        </div>
      )}

      <SectionTitle title="SolarWeb Cloud" />
      <Row label="Cloud sync">
        <Tag
          intent={config.solarweb_configured ? Intent.SUCCESS : Intent.WARNING}
          minimal
        >
          {config.solarweb_configured ? 'Configured' : 'Not configured'}
        </Tag>
      </Row>
      <Row
        label="Stats source"
        value={
          config.solarweb_configured ? 'SolarWeb + local' : 'Local readings'
        }
      />
    </div>
  );
}
