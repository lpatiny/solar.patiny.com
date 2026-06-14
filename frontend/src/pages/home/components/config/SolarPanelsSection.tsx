import { Button, Intent, NumericInput } from '@blueprintjs/core';
import { useState } from 'react';

import type { ConfigData } from '../../HomePage.tsx';

import { unitStyle } from './configStyles.ts';
import { Row } from './configUi.tsx';

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
      const res = await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          /* eslint-disable camelcase -- backend /api/config uses snake_case keys */
          panel_surface_m2: panelSurface,
          panel_efficiency_pct: panelEfficiency,
          panel_performance_ratio: performanceRatio,
          panel_temp_coeff_pct_per_c: tempCoeff,
          /* eslint-enable camelcase */
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = (await res.json()) as ConfigData;
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
      <Row label="Surface area">
        <NumericInput
          value={panelSurface}
          onValueChange={(v) => setPanelSurface(v)}
          min={1}
          stepSize={1}
          minorStepSize={null}
          style={{ width: 80 }}
          rightElement={<span style={unitStyle}>m²</span>}
        />
      </Row>
      <Row label="Panel efficiency">
        <NumericInput
          value={panelEfficiency}
          onValueChange={(v) => setPanelEfficiency(v)}
          min={1}
          max={100}
          stepSize={1}
          minorStepSize={null}
          style={{ width: 80 }}
          rightElement={<span style={unitStyle}>%</span>}
        />
      </Row>
      <Row label="Performance ratio">
        <NumericInput
          value={performanceRatio}
          onValueChange={(v) => setPerformanceRatio(v)}
          min={0.1}
          max={1}
          stepSize={0.01}
          minorStepSize={null}
          style={{ width: 80 }}
          rightElement={<span style={unitStyle}>(0–1)</span>}
        />
      </Row>
      <Row label="Temp. coefficient">
        <NumericInput
          value={tempCoeff}
          onValueChange={(v) => setTempCoeff(v)}
          min={0}
          max={1}
          stepSize={0.01}
          minorStepSize={null}
          style={{ width: 80 }}
          rightElement={<span style={unitStyle}>%/°C</span>}
        />
      </Row>
      <Row
        label="Peak DC power"
        value={`${((panelSurface * panelEfficiency) / 100).toFixed(1)} kW`}
      />
      <div
        style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}
      >
        <Button
          intent={Intent.PRIMARY}
          loading={savingPanel}
          size="small"
          onClick={() => void handleSavePanelSettings()}
        >
          Save panel settings
        </Button>
        {panelSaveError && (
          <span style={{ fontSize: 11, color: '#fca5a5' }}>
            {panelSaveError}
          </span>
        )}
      </div>
    </div>
  );
}
