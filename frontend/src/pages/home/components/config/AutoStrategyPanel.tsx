/* eslint-disable camelcase -- backend /api/strategy uses snake_case keys */
import { Intent, SegmentedControl, Tag } from '@blueprintjs/core';

import type {
  StrategyConfig,
  StrategyStatus,
} from './BatteryControlSection.tsx';
import { secondaryTextStyle } from './configStyles.ts';
import {
  ErrorText,
  Row,
  SaveRow,
  SectionTitle,
  UnitNumericInput,
} from './configUi.tsx';

const PHASE_INTENT: Record<string, Intent> = {
  charge: Intent.SUCCESS,
  discharge: Intent.WARNING,
  idle: Intent.NONE,
  off: Intent.NONE,
  stale: Intent.DANGER,
};

interface AutoStrategyPanelProps {
  config: StrategyConfig;
  savedConfig: StrategyConfig | null;
  status: StrategyStatus | null;
  saving: boolean;
  error: string | null;
  setConfig: (config: StrategyConfig) => void;
  onSave: (update: Partial<StrategyConfig>) => void;
}

/**
 * Threshold editor and live status for the autonomous Marstek strategy, shown
 * when the Battery Control tab is in Automatic mode.
 * @param root0 - Component props.
 * @param root0.config - The current (editable) strategy configuration.
 * @param root0.savedConfig - The persisted configuration, used to detect unsaved edits.
 * @param root0.status - The latest control-cycle status, or null before the first poll.
 * @param root0.saving - Whether a save request is in flight.
 * @param root0.error - The last error message, or null.
 * @param root0.setConfig - Update the in-memory config from a field edit.
 * @param root0.onSave - Persist a partial config update to the backend.
 * @returns The automatic-strategy panel.
 */
export default function AutoStrategyPanel({
  config,
  savedConfig,
  status,
  saving,
  error,
  setConfig,
  onSave,
}: AutoStrategyPanelProps) {
  const set = (key: keyof StrategyConfig) => (value: number) =>
    setConfig({ ...config, [key]: value });

  const dirty =
    savedConfig !== null &&
    (config.inject_target_w !== savedConfig.inject_target_w ||
      config.charge_max_w !== savedConfig.charge_max_w ||
      config.charge_ceiling_pct !== savedConfig.charge_ceiling_pct ||
      config.discharge_max_w !== savedConfig.discharge_max_w ||
      config.discharge_mode !== savedConfig.discharge_mode ||
      config.interval_ms !== savedConfig.interval_ms);

  return (
    <div>
      <SectionTitle title="Charge (solar surplus)" />
      <Row
        label="Keep injecting up to"
        help="Grid export to preserve before charging. Only the solar surplus above this value is stored in the batteries; the rest keeps flowing to the grid. Set to 0 to bank all surplus and export nothing."
      >
        <UnitNumericInput
          unit="W"
          width={90}
          value={config.inject_target_w}
          onValueChange={set('inject_target_w')}
          min={0}
          max={20_000}
          stepSize={50}
        />
      </Row>
      <Row
        label="Max charge / battery"
        help="Upper limit on the charge power commanded to each Marstek battery, regardless of how much surplus is available."
      >
        <UnitNumericInput
          unit="W"
          width={90}
          value={config.charge_max_w}
          onValueChange={set('charge_max_w')}
          min={0}
          max={1000}
          stepSize={50}
        />
      </Row>
      <Row
        label="Charge up to"
        help="Stop charging a battery once its state of charge reaches this level."
      >
        <UnitNumericInput
          unit="%"
          width={90}
          value={config.charge_ceiling_pct}
          onValueChange={set('charge_ceiling_pct')}
          min={1}
          max={100}
          stepSize={1}
        />
      </Row>

      <SectionTitle title="Discharge" />
      <Row
        label="Discharge mode"
        help="Cover: discharge only to cover the house consumption (Marstek first, never exporting). Force: discharge at the rate below, exporting to the grid up to the injection limit set above."
      >
        <SegmentedControl
          options={[
            { label: 'Cover', value: 'cover' },
            { label: 'Force', value: 'force' },
          ]}
          value={config.discharge_mode}
          onValueChange={(value) =>
            setConfig({
              ...config,
              discharge_mode: value as 'cover' | 'force',
            })
          }
        />
      </Row>
      <Row
        label={
          config.discharge_mode === 'force'
            ? 'Discharge rate / battery'
            : 'Max discharge / battery'
        }
        help="Discharge power per Marstek battery — the rate each is driven at in Force mode, or the ceiling on load-following in Cover mode."
      >
        <UnitNumericInput
          unit="W"
          width={90}
          value={config.discharge_max_w}
          onValueChange={set('discharge_max_w')}
          min={0}
          max={1000}
          stepSize={50}
        />
      </Row>
      <div style={{ ...secondaryTextStyle, padding: '4px 0' }}>
        {config.discharge_mode === 'force'
          ? `Force: each battery discharges at the rate above, but throttled so grid injection never exceeds the "Keep injecting up to" limit (${config.inject_target_w} W) — so it deliberately exports up to that limit.`
          : 'Cover: the Marstek batteries cover the house load (after solar, capped per battery) so they empty first and the BYD only supplies what they cannot — never exporting.'}
      </div>
      <Row
        label="Stop discharging at"
        help="Discharge floor — the strategy never drains a Marstek below this. It tracks the Marstek reserve set in Battery Reserve, so the displayed 0% is preserved."
        value={`${config.discharge_floor_pct}% · Marstek reserve`}
      />

      <SectionTitle title="Loop" />
      <Row
        label="Cycle interval"
        help="How often the control loop re-reads the meter and re-commands the batteries."
      >
        <UnitNumericInput
          unit="s"
          width={90}
          value={Math.round(config.interval_ms / 1000)}
          onValueChange={(v) => set('interval_ms')(Math.round(v) * 1000)}
          min={10}
          max={600}
          stepSize={5}
        />
      </Row>

      <SaveRow
        label="Save thresholds"
        saving={saving}
        dirty={dirty}
        error={error}
        onSave={() =>
          onSave({
            inject_target_w: config.inject_target_w,
            charge_max_w: config.charge_max_w,
            charge_ceiling_pct: config.charge_ceiling_pct,
            discharge_max_w: config.discharge_max_w,
            discharge_mode: config.discharge_mode,
            interval_ms: config.interval_ms,
          })
        }
      />

      {status && (
        <>
          <SectionTitle title="Live status" />
          <Row
            label="Phase"
            help="What the loop decided this cycle: charge (storing surplus), discharge (covering load), idle (nothing to do), off (disabled), or stale (no fresh meter reading)."
          >
            <Tag minimal intent={PHASE_INTENT[status.phase] ?? Intent.NONE}>
              {status.phase}
            </Tag>
          </Row>
          <Row
            label="PV production"
            help="Current solar production reported by the Fronius inverter."
            value={
              status.production_w === null
                ? '—'
                : `${Math.round(status.production_w)} W`
            }
          />
          <Row
            label="Grid injection"
            help="Power currently exported to the grid, as seen by the Fronius meter."
            value={
              status.grid_injection_w === null
                ? '—'
                : `${Math.round(status.grid_injection_w)} W`
            }
          />
          {status.devices.map((device) => (
            <Row
              key={device.device_id}
              label={device.name}
              value={`${device.soc_pct === null ? '?' : Math.round(device.soc_pct)}% · ${device.action}${device.action === 'stop' ? '' : ` ${device.power_w} W`}`}
            />
          ))}
          {status.error && <ErrorText>{status.error}</ErrorText>}
        </>
      )}
    </div>
  );
}
