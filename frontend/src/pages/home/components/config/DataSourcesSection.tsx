import { Intent, Tag } from '@blueprintjs/core';

import type { ConfigData } from '../../HomePage.tsx';

import { Row, SectionTitle } from './configUi.tsx';

interface DataSourcesSectionProps {
  config: ConfigData;
  modbusStatus: 'ok' | 'error' | 'disabled';
  modbusError: string | null;
}

export default function DataSourcesSection({
  config,
  modbusStatus,
  modbusError,
}: DataSourcesSectionProps) {
  return (
    <div>
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
    </div>
  );
}
