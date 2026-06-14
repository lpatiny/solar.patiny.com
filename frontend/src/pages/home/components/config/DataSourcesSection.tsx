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
      <SectionTitle
        title="Fronius REST"
        help="The Fronius inverter's local REST API — the primary source of live production, consumption and grid readings."
      />
      <Row label="Host" value={config.fronius_host} />
      <Row
        label="Poll interval"
        help="How often the backend reads the Fronius REST API."
        value={`${config.poll_interval_ms / 1000}s`}
      />

      <SectionTitle
        title="Modbus TCP"
        help="Direct Modbus TCP link to the inverter/meter, used for register-level readings beyond the REST API."
      />
      <Row
        label="Status"
        help="Connected: Modbus polling is live. Error: the connection failed (see message below). Disabled: Modbus is turned off."
      >
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
