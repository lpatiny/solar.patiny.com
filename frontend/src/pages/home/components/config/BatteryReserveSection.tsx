import { Button, Intent, NumericInput } from '@blueprintjs/core';
import { useState } from 'react';

import type { ConfigData } from '../../HomePage.tsx';

import { unitStyle } from './configStyles.ts';
import { Row } from './configUi.tsx';

interface BatteryReserveSectionProps {
  config: ConfigData;
  onConfigChange: (updated: ConfigData) => void;
}

/**
 * Configures the per-battery reserve (minimum SOC) that is hidden from the
 * displays. Stored capacity, energy and the SOC dial are all rescaled over the
 * usable range above this floor, so every battery reads 0–100 %.
 * @param root0 - Component props.
 * @param root0.config - The current configuration.
 * @param root0.onConfigChange - Called with the updated config after saving.
 * @returns The battery-reserve configuration section.
 */
export default function BatteryReserveSection({
  config,
  onConfigChange,
}: BatteryReserveSectionProps) {
  const [bydReserve, setBydReserve] = useState(config.byd_reserve_pct);
  const [marstekReserve, setMarstekReserve] = useState(
    config.marstek_reserve_pct,
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          /* eslint-disable camelcase -- backend /api/config uses snake_case keys */
          byd_reserve_pct: bydReserve,
          marstek_reserve_pct: marstekReserve,
          /* eslint-enable camelcase */
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = (await res.json()) as ConfigData;
      onConfigChange(updated);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Row label="BYD reserve">
        <NumericInput
          value={bydReserve}
          onValueChange={(v) => setBydReserve(v)}
          min={0}
          max={90}
          stepSize={1}
          minorStepSize={null}
          style={{ width: 80 }}
          rightElement={<span style={unitStyle}>%</span>}
        />
      </Row>
      <Row label="Marstek reserve">
        <NumericInput
          value={marstekReserve}
          onValueChange={(v) => setMarstekReserve(v)}
          min={0}
          max={90}
          stepSize={1}
          minorStepSize={null}
          style={{ width: 80 }}
          rightElement={<span style={unitStyle}>%</span>}
        />
      </Row>
      <div
        style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}
      >
        <Button
          intent={Intent.PRIMARY}
          loading={saving}
          size="small"
          onClick={() => void handleSave()}
        >
          Save reserve settings
        </Button>
        {saveError && (
          <span style={{ fontSize: 11, color: '#fca5a5' }}>{saveError}</span>
        )}
      </div>
    </div>
  );
}
