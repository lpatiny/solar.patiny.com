import type { IconName } from '@blueprintjs/core';
import { Icon, Tag } from '@blueprintjs/core';
import type { ReactNode } from 'react';
import { CircularProgressbar, buildStyles } from 'react-circular-progressbar';
import 'react-circular-progressbar/dist/styles.css';

import type { BatteryFlow } from './batteryStatus.ts';
import { formatPower } from './batteryStatus.ts';

interface BatteryCellProps {
  name: string;
  statusLabel: string;
  offline: boolean;
  soc: number | null;
  flow: BatteryFlow;
  watts: number;
  subtitle: string | null;
  capacityKwh: number | null;
  /** When true, render a solid (non-minimal) status tag (e.g. selected card). */
  highlighted?: boolean;
  /** When provided the cell becomes a clickable button. */
  onClick?: () => void;
}

interface FlowVisual {
  icon: IconName;
  color: string;
  verb: string;
}

const FLOW_VISUAL: Record<BatteryFlow, FlowVisual> = {
  charging: { icon: 'arrow-up', color: '#34d399', verb: 'Charging' },
  discharging: { icon: 'arrow-down', color: '#f87171', verb: 'Discharging' },
  idle: { icon: 'arrows-horizontal', color: '#fbbf24', verb: 'Standby' },
};

function socColor(soc: number): string {
  if (soc < 20) return '#f87171';
  if (soc < 40) return '#fbbf24';
  return '#34d399';
}

/**
 * Shared presentational battery cell: SOC dial, status tag, IP/energy details
 * and a large arrow logo for the charge/discharge/standby direction. Used both
 * for the BYD home battery and each Marstek device.
 * @param root0 - Component props.
 * @param root0.name - Battery display name.
 * @param root0.statusLabel - Status tag text (online/stale/error/disabled/offline).
 * @param root0.offline - Whether the battery is offline (drives the tag colour).
 * @param root0.soc - State of charge in percent, or null when unknown.
 * @param root0.flow - Charge/discharge/standby direction.
 * @param root0.watts - Absolute power magnitude in watts.
 * @param root0.subtitle - Secondary line (e.g. IP address).
 * @param root0.capacityKwh - Battery capacity in kWh, or null.
 * @param root0.highlighted - Render a solid status tag when selected.
 * @param root0.onClick - Makes the cell a clickable button when provided.
 * @returns The battery cell.
 */
export default function BatteryCell({
  name,
  statusLabel,
  offline,
  soc,
  flow,
  watts,
  subtitle,
  capacityKwh,
  highlighted = false,
  onClick,
}: BatteryCellProps) {
  const visual = FLOW_VISUAL[flow];
  const color = soc === null ? 'var(--text-secondary)' : socColor(soc);
  const flowText =
    flow === 'idle' ? 'Standby' : `${visual.verb} ${formatPower(watts)}`;

  const stored =
    soc !== null && capacityKwh !== null ? (soc / 100) * capacityKwh : null;
  const energyText =
    stored !== null && capacityKwh !== null
      ? `${stored.toFixed(2)} / ${capacityKwh.toFixed(2)} kWh`
      : capacityKwh !== null
        ? `${capacityKwh.toFixed(2)} kWh`
        : null;

  const content: ReactNode = (
    <>
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <span style={{ fontWeight: 600 }}>{name}</span>
        <Tag
          intent={offline ? 'danger' : 'success'}
          minimal={!highlighted}
          round
        >
          {statusLabel}
        </Tag>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <div style={{ width: 64, flexShrink: 0 }}>
          <CircularProgressbar
            value={soc ?? 0}
            text={soc === null ? '–' : `${Math.round(soc)}%`}
            styles={buildStyles({
              pathColor: color,
              textColor: color,
              trailColor: 'var(--border)',
              textSize: '24px',
            })}
          />
        </div>
        <div style={{ flex: 1, fontSize: 12, minWidth: 0 }}>
          {subtitle && (
            <div
              style={{
                color: 'var(--text-secondary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {subtitle}
            </div>
          )}
          <div style={{ marginTop: 6, fontWeight: 600, fontSize: 14 }}>
            {flowText}
          </div>
          {energyText && (
            <div style={{ marginTop: 4, color: 'var(--text-secondary)' }}>
              {energyText}
            </div>
          )}
        </div>
        <Icon
          icon={visual.icon}
          size={40}
          color={visual.color}
          title={flowText}
        />
      </div>
    </>
  );

  const cardStyle = {
    border: highlighted ? '1px solid #3b82f6' : '1px solid var(--border)',
    minWidth: 260,
    flex: '1 1 260px',
  } as const;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="card"
        style={{ ...cardStyle, cursor: 'pointer', textAlign: 'left' }}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="card" style={cardStyle}>
      {content}
    </div>
  );
}
