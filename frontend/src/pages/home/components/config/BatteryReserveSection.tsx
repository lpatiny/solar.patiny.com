import { useState } from 'react';

import type { ConfigData } from '../../HomePage.tsx';

import { patchConfig } from './configApi.ts';
import { Row, SaveRow, UnitNumericInput } from './configUi.tsx';

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
  const [pollIntervalSec, setPollIntervalSec] = useState(
    Math.round(config.marstek_poll_interval_ms / 1000),
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await patchConfig({
        /* eslint-disable camelcase -- backend /api/config uses snake_case keys */
        byd_reserve_pct: bydReserve,
        marstek_reserve_pct: marstekReserve,
        marstek_poll_interval_ms: pollIntervalSec * 1000,
        /* eslint-enable camelcase */
      });
      onConfigChange(updated);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Row
        label="BYD reserve"
        help="Minimum SOC hidden from the displays for the BYD battery. Capacity, energy and the SOC dial are rescaled over the usable range above this floor, so the battery reads 0–100%."
      >
        <UnitNumericInput
          unit="%"
          value={bydReserve}
          onValueChange={(v) => setBydReserve(v)}
          min={0}
          max={90}
          stepSize={1}
        />
      </Row>
      <Row
        label="Marstek reserve"
        help="Minimum SOC hidden from the displays for the Marstek batteries, and the floor the auto strategy will not discharge below."
      >
        <UnitNumericInput
          unit="%"
          value={marstekReserve}
          onValueChange={(v) => setMarstekReserve(v)}
          min={0}
          max={90}
          stepSize={1}
        />
      </Row>
      <Row
        label="Marstek poll interval"
        help="How often each Marstek battery is queried over UDP. A slower cadence is gentler on the device (too-frequent queries can crash the ESP32). A device that stops responding is backed off further automatically. Minimum 20s; telemetry counts as stale after 4× this interval."
      >
        <UnitNumericInput
          unit="s"
          value={pollIntervalSec}
          onValueChange={(v) => setPollIntervalSec(v)}
          min={20}
          max={300}
          stepSize={10}
        />
      </Row>
      <SaveRow
        label="Save reserve settings"
        saving={saving}
        dirty={
          bydReserve !== config.byd_reserve_pct ||
          marstekReserve !== config.marstek_reserve_pct ||
          pollIntervalSec !== Math.round(config.marstek_poll_interval_ms / 1000)
        }
        error={saveError}
        onSave={() => void handleSave()}
      />
    </div>
  );
}
