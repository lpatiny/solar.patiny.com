import {
  Button,
  ButtonGroup,
  Callout,
  NumericInput,
  Slider,
} from '@blueprintjs/core';
import { useState } from 'react';

import type { PostResult } from './controlApi.ts';
import {
  MAX_CHARGE_POWER_W,
  MAX_DISCHARGE_POWER_W,
  postControl,
} from './controlApi.ts';

type Action = 'charge' | 'discharge' | 'stop';

interface ManualControlProps {
  deviceId: number;
}

const ACTIONS: Array<{
  value: Action;
  label: string;
  intent: 'success' | 'primary' | 'none';
}> = [
  { value: 'charge', label: 'Charge', intent: 'success' },
  { value: 'discharge', label: 'Discharge', intent: 'primary' },
  { value: 'stop', label: 'Stop', intent: 'none' },
];

/**
 * Immediate manual control of one battery: force a charge, force a discharge
 * for a countdown, or stop. Charging holds until changed; discharging
 * self-expires after the chosen duration (the firmware's Passive countdown).
 * @param root0 - Component props.
 * @param root0.deviceId - The device to control.
 * @returns The manual-control widget.
 */
export default function ManualControl({ deviceId }: ManualControlProps) {
  const [action, setAction] = useState<Action>('charge');
  const [power, setPower] = useState(0);
  const [durationMin, setDurationMin] = useState(60);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PostResult | null>(null);

  const max =
    action === 'discharge' ? MAX_DISCHARGE_POWER_W : MAX_CHARGE_POWER_W;
  const clampedPower = Math.max(0, Math.min(max, Math.round(power || 0)));

  function apply() {
    setBusy(true);
    setResult(null);
    const body =
      action === 'stop'
        ? { action }
        : action === 'discharge'
          ? // eslint-disable-next-line camelcase -- the API contract uses snake_case
            { action, power_w: clampedPower, duration_s: durationMin * 60 }
          : // eslint-disable-next-line camelcase -- the API contract uses snake_case
            { action, power_w: clampedPower };
    const success =
      action === 'stop'
        ? 'Battery returned to idle.'
        : action === 'charge'
          ? `Charging at ${clampedPower} W.`
          : `Discharging at ${clampedPower} W for ${durationMin} min.`;
    void postControl(`/api/devices/${deviceId}/manual`, body, success)
      .then(setResult)
      .finally(() => setBusy(false));
  }

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ marginBottom: 10 }}>
        <ButtonGroup>
          {ACTIONS.map((option) => (
            <Button
              key={option.value}
              intent={action === option.value ? option.intent : 'none'}
              active={action === option.value}
              onClick={() => setAction(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </ButtonGroup>
      </div>

      {action !== 'stop' && (
        <>
          <div
            style={{
              alignItems: 'center',
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 6,
            }}
          >
            <span style={{ fontSize: 13 }}>
              {action === 'charge' ? 'Charge' : 'Discharge'} power
            </span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
              max {max} W
            </span>
          </div>
          <div style={{ marginBottom: 12 }}>
            <Slider
              min={0}
              max={max}
              stepSize={10}
              labelStepSize={250}
              value={clampedPower}
              onChange={setPower}
            />
          </div>
        </>
      )}

      {action === 'discharge' && (
        <div
          style={{
            alignItems: 'center',
            display: 'flex',
            gap: 8,
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 13 }}>Duration</span>
          <NumericInput
            min={1}
            max={1440}
            stepSize={15}
            clampValueOnBlur
            value={durationMin}
            rightElement={<span style={{ padding: '0 8px' }}>min</span>}
            onValueChange={(value) => setDurationMin(value || 1)}
          />
        </div>
      )}

      <Button intent="primary" loading={busy} onClick={apply}>
        Apply
      </Button>

      {result && (
        <Callout
          intent={result.ok ? 'success' : 'danger'}
          style={{ marginTop: 10 }}
        >
          {result.text}
        </Callout>
      )}
    </div>
  );
}
