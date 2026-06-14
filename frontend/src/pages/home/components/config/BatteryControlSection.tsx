/* eslint-disable @typescript-eslint/naming-convention -- backend /api/strategy uses snake_case keys */
import { SegmentedControl } from '@blueprintjs/core';
import { useEffect, useState } from 'react';

import AutoStrategyPanel from './AutoStrategyPanel.tsx';
import ManualBatteryPanel from './ManualBatteryPanel.tsx';
import { secondaryTextStyle } from './configStyles.ts';

/** How the Marstek batteries are driven. */
export type StrategyMode = 'off' | 'auto' | 'manual';

/** Marstek strategy configuration as returned by `/api/strategy`. */
export interface StrategyConfig {
  mode: StrategyMode;
  inject_target_w: number;
  charge_max_w: number;
  charge_ceiling_pct: number;
  discharge_max_w: number;
  discharge_mode: 'cover' | 'force';
  discharge_floor_pct: number;
  interval_ms: number;
}

/** One battery's decision in the latest control cycle. */
export interface DeviceDecision {
  device_id: number;
  name: string;
  soc_pct: number | null;
  action: string;
  power_w: number;
  sent: boolean;
}

/** Latest control-cycle status from `/api/strategy`. */
export interface StrategyStatus {
  phase: string;
  timestamp: number;
  production_w: number | null;
  grid_injection_w: number | null;
  devices: DeviceDecision[];
  error: string | null;
}

interface StrategyResponse {
  config: StrategyConfig;
  status: StrategyStatus;
}

const STATUS_POLL_MS = 5000;

/**
 * Battery Control config tab. An Off/Automatic/Manual switch selects how the
 * Marstek batteries are driven: Off disables control and releases the batteries
 * to their own behavior, Automatic runs the autonomous strategy loop, and Manual
 * turns the loop off and lets the operator command the batteries directly. Only
 * one mode is ever active, so nothing fights over the battery.
 * @returns The battery-control tab.
 */
export default function BatteryControlSection() {
  const [config, setConfig] = useState<StrategyConfig | null>(null);
  const [savedConfig, setSavedConfig] = useState<StrategyConfig | null>(null);
  const [status, setStatus] = useState<StrategyStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch('/api/strategy');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as StrategyResponse;
        if (!active) return;
        setStatus(data.status);
        // Keep the form as-is once loaded so an edit isn't clobbered by polling,
        // but always track the persisted config so we can detect unsaved edits.
        setConfig((current) => current ?? data.config);
        setSavedConfig(data.config);
      } catch (error_) {
        if (active) {
          setError(error_ instanceof Error ? error_.message : 'Load failed');
        }
      }
    }
    void load();
    const timer = setInterval(() => void load(), STATUS_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  async function patch(update: Partial<StrategyConfig>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/strategy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as StrategyResponse;
      setConfig(data.config);
      setSavedConfig(data.config);
      setStatus(data.status);
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (!config) {
    return <div style={{ fontSize: 12 }}>{error ?? 'Loading…'}</div>;
  }

  const mode = config.mode;

  const description =
    mode === 'auto'
      ? 'The control loop charges from solar surplus and discharges to cover house load.'
      : mode === 'manual'
        ? 'The control loop is off. You command the batteries directly below.'
        : 'Control is disabled. The batteries are released and run on their own; the app commands nothing.';

  return (
    <div>
      <div style={{ ...secondaryTextStyle, marginBottom: 8 }}>
        Drives the Marstek batteries only. The BYD battery is not controllable
        and will have its own strategy.
      </div>

      <SegmentedControl
        fill
        options={[
          { label: 'Off', value: 'off' },
          { label: 'Automatic', value: 'auto' },
          { label: 'Manual', value: 'manual' },
        ]}
        value={mode}
        onValueChange={(value) => void patch({ mode: value as StrategyMode })}
      />

      <div style={{ ...secondaryTextStyle, margin: '8px 0 4px' }}>
        {description}
      </div>

      {mode === 'auto' && (
        <AutoStrategyPanel
          config={config}
          savedConfig={savedConfig}
          status={status}
          saving={saving}
          error={error}
          setConfig={setConfig}
          onSave={(update) => void patch(update)}
        />
      )}
      {mode === 'manual' && <ManualBatteryPanel />}
    </div>
  );
}
