import { Button, ButtonGroup, Intent, Slider } from '@blueprintjs/core';
import { CircularProgressbar, buildStyles } from 'react-circular-progressbar';
import 'react-circular-progressbar/dist/styles.css';

type BatteryMode = 'auto' | 'charge' | 'discharge' | 'idle';

interface BatteryCardProps {
  soc: number;
  powerW: number;
  mode: BatteryMode;
  chargeRatePercent: number;
  modbusEnabled: boolean;
  onModeChange: (mode: BatteryMode, ratePercent: number) => void;
}

const MODES: Array<{ value: BatteryMode; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'charge', label: 'Force Charge' },
  { value: 'discharge', label: 'Force Discharge' },
  { value: 'idle', label: 'Idle' },
];

function getSocColor(soc: number): string {
  if (soc < 20) return '#f87171';
  if (soc < 40) return '#fbbf24';
  return '#34d399';
}

export default function BatteryCard({
  soc,
  powerW,
  mode,
  chargeRatePercent,
  modbusEnabled,
  onModeChange,
}: BatteryCardProps) {
  const socColor = getSocColor(soc);
  const isCharging = powerW < 0;

  return (
    <div className="card">
      <span className="card-title">Battery (11 kWh)</span>

      <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
        <div style={{ width: 110, flexShrink: 0 }}>
          <CircularProgressbar
            value={soc}
            text={`${Math.round(soc)}%`}
            styles={buildStyles({
              pathColor: socColor,
              textColor: socColor,
              trailColor: 'var(--border)',
              textSize: '22px',
            })}
          />
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ marginBottom: 10 }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
              State of charge
            </div>
            <div
              className="value-large"
              style={{ color: socColor, fontSize: 24 }}
            >
              {Math.round(soc)}
              <span className="value-unit">%</span>
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
              {isCharging ? 'Charging at' : 'Discharging at'}
            </div>
            <div style={{ fontWeight: 600 }}>
              {Math.abs(powerW) >= 1000
                ? `${(Math.abs(powerW) / 1000).toFixed(2)} kW`
                : `${Math.round(Math.abs(powerW))} W`}
            </div>
          </div>

          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
              Rate limit
            </div>
            <div style={{ fontWeight: 600 }}>{chargeRatePercent}%</div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <div
          style={{
            color: 'var(--text-secondary)',
            fontSize: 12,
            marginBottom: 8,
          }}
        >
          Control mode{' '}
          {!modbusEnabled && (
            <span style={{ color: '#fb923c' }}>(Modbus not configured)</span>
          )}
        </div>

        <ButtonGroup>
          {MODES.map((m) => (
            <Button
              key={m.value}
              active={mode === m.value}
              disabled={!modbusEnabled}
              intent={mode === m.value ? Intent.PRIMARY : Intent.NONE}
              onClick={() => onModeChange(m.value, chargeRatePercent)}
            >
              {m.label}
            </Button>
          ))}
        </ButtonGroup>

        {modbusEnabled && (
          <div style={{ marginTop: 16, maxWidth: 400 }}>
            <div
              style={{
                color: 'var(--text-secondary)',
                fontSize: 12,
                marginBottom: 8,
              }}
            >
              Charge rate: {chargeRatePercent}%
            </div>
            <Slider
              min={0}
              max={100}
              stepSize={5}
              labelStepSize={25}
              value={chargeRatePercent}
              onChange={(v) => onModeChange(mode, v)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
