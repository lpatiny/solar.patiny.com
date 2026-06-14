import { useState } from 'react';

import type { ConfigData } from '../../HomePage.tsx';

import { patchConfig } from './configApi.ts';
import { Row, SaveRow, UnitNumericInput } from './configUi.tsx';

interface SolarPanelsSectionProps {
  config: ConfigData;
  onConfigChange: (updated: ConfigData) => void;
}

export default function SolarPanelsSection({
  config,
  onConfigChange,
}: SolarPanelsSectionProps) {
  const [panelSurface, setPanelSurface] = useState(config.panel_surface_m2);
  const [panelEfficiency, setPanelEfficiency] = useState(
    config.panel_efficiency_pct,
  );
  const [performanceRatio, setPerformanceRatio] = useState(
    config.panel_performance_ratio,
  );
  const [tempCoeff, setTempCoeff] = useState(config.panel_temp_coeff_pct_per_c);
  const [savingPanel, setSavingPanel] = useState(false);
  const [panelSaveError, setPanelSaveError] = useState<string | null>(null);

  async function handleSavePanelSettings() {
    setSavingPanel(true);
    setPanelSaveError(null);
    try {
      const updated = await patchConfig({
        /* eslint-disable camelcase -- backend /api/config uses snake_case keys */
        panel_surface_m2: panelSurface,
        panel_efficiency_pct: panelEfficiency,
        panel_performance_ratio: performanceRatio,
        panel_temp_coeff_pct_per_c: tempCoeff,
        /* eslint-enable camelcase */
      });
      onConfigChange(updated);
    } catch (error_) {
      setPanelSaveError(
        error_ instanceof Error ? error_.message : 'Save failed',
      );
    } finally {
      setSavingPanel(false);
    }
  }

  return (
    <div>
      <Row
        label="Surface area"
        help="Total area of the solar panels. Used with efficiency to estimate the peak DC power and the clear-sky production forecast."
      >
        <UnitNumericInput
          unit="m²"
          value={panelSurface}
          onValueChange={(v) => setPanelSurface(v)}
          min={1}
          stepSize={1}
        />
      </Row>
      <Row
        label="Panel efficiency"
        help="Fraction of incident sunlight the panels convert to electricity at standard test conditions (typically 18–22% for modern panels)."
      >
        <UnitNumericInput
          unit="%"
          value={panelEfficiency}
          onValueChange={(v) => setPanelEfficiency(v)}
          min={1}
          max={100}
          stepSize={1}
        />
      </Row>
      <Row
        label="Performance ratio"
        help="Overall system derating (wiring, inverter, soiling, mismatch) applied to the ideal output. A typical real-world value is 0.75–0.85."
      >
        <UnitNumericInput
          unit="(0–1)"
          value={performanceRatio}
          onValueChange={(v) => setPerformanceRatio(v)}
          min={0.1}
          max={1}
          stepSize={0.01}
        />
      </Row>
      <Row
        label="Temp. coefficient"
        help="Power lost per °C the panels run above 25°C. Used to derate the forecast on hot days."
      >
        <UnitNumericInput
          unit="%/°C"
          value={tempCoeff}
          onValueChange={(v) => setTempCoeff(v)}
          min={0}
          max={1}
          stepSize={0.01}
        />
      </Row>
      <Row
        label="Peak DC power"
        help="Estimated nameplate DC power = surface × efficiency. Derived from the values above."
        value={`${((panelSurface * panelEfficiency) / 100).toFixed(1)} kW`}
      />
      <SaveRow
        label="Save panel settings"
        saving={savingPanel}
        error={panelSaveError}
        onSave={() => void handleSavePanelSettings()}
      />
    </div>
  );
}
