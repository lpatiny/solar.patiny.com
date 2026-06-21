/* eslint-disable @typescript-eslint/naming-convention -- API response types use snake_case */
import { Icon, Tag } from '@blueprintjs/core';

import { hsvToHex } from './dirigeraColor.ts';

export interface DirigeraDevice {
  id: string;
  type: string;
  model: string;
  name: string;
  room: string | null;
  is_reachable: boolean;
  is_on: boolean | null;
  light_level: number | null;
  color_mode: string | null;
  color: { hue: number; saturation: number } | null;
  color_temperature: number | null;
  battery_percentage: number | null;
  temperature_c: number | null;
  humidity_pct: number | null;
  co2_ppm: number | null;
  pm25_ugm3: number | null;
  firmware_version: string | null;
  ota_status: string | null;
}

const muted = { color: 'var(--text-secondary)', fontSize: 12 };

/** Compact sensor line: "23.3°C · 63% · 867 ppm · PM2.5 4". */
function sensorLine(device: DirigeraDevice): string {
  const parts: string[] = [];
  if (device.temperature_c !== null) {
    parts.push(`${device.temperature_c.toFixed(1)}°C`);
  }
  if (device.humidity_pct !== null) {
    parts.push(`${Math.round(device.humidity_pct)}%`);
  }
  if (device.co2_ppm !== null) parts.push(`${Math.round(device.co2_ppm)} ppm`);
  if (device.pm25_ugm3 !== null) {
    parts.push(`PM2.5 ${Math.round(device.pm25_ugm3)}`);
  }
  return parts.join(' · ');
}

function StatusTag({ device }: { device: DirigeraDevice }) {
  if (!device.is_reachable) return <Tag minimal>offline</Tag>;
  // `isOn` is only a meaningful power state for switchable loads. Remotes, the
  // hub, and sensors also carry an `isOn` field, but it does not describe an
  // on/off state the user cares about — show them as simply "online".
  const switchable = device.type === 'light' || device.type === 'outlet';
  if (switchable && device.is_on === true) {
    return (
      <Tag intent="success" minimal>
        on
      </Tag>
    );
  }
  if (switchable && device.is_on === false) return <Tag minimal>off</Tag>;
  return (
    <Tag intent="success" minimal>
      online
    </Tag>
  );
}

/** The type-specific detail line shown at the bottom of a device tile. */
function DeviceDetail({ device }: { device: DirigeraDevice }) {
  if (device.type === 'sensor') {
    return <div style={muted}>{sensorLine(device) || '—'}</div>;
  }

  if (device.type === 'controller' && device.battery_percentage !== null) {
    return (
      <div style={{ ...muted, alignItems: 'center', display: 'flex', gap: 4 }}>
        <Icon icon="lightning" size={12} />
        {device.battery_percentage}%
      </div>
    );
  }

  if (device.type === 'light') {
    const brightness =
      device.is_on && device.light_level !== null
        ? `${Math.round(device.light_level)}%`
        : null;
    return (
      <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
        {device.color ? (
          <span
            title={`hue ${Math.round(device.color.hue)}° · sat ${Math.round(
              device.color.saturation * 100,
            )}%`}
            style={{
              background: hsvToHex(device.color.hue, device.color.saturation),
              border: '1px solid var(--border)',
              borderRadius: '50%',
              display: 'inline-block',
              height: 18,
              width: 18,
            }}
          />
        ) : device.color_temperature !== null ? (
          <span style={muted}>{device.color_temperature} K</span>
        ) : null}
        {brightness && <span style={muted}>{brightness}</span>}
      </div>
    );
  }

  if (device.firmware_version) {
    return <div style={muted}>fw {device.firmware_version}</div>;
  }
  return null;
}

/**
 * A single read-only DIRIGERA device tile: name, room/model, status badge, and
 * a type-specific detail line (sensor readings, light colour/brightness, remote
 * battery, or hub firmware). Offline devices are dimmed.
 * @param props.device - the device to render
 */
export default function DirigeraDeviceTile({
  device,
}: {
  device: DirigeraDevice;
}) {
  return (
    <div
      style={{
        background: 'var(--surface-raised)',
        borderRadius: 8,
        opacity: device.is_reachable ? 1 : 0.5,
        padding: '10px 12px',
      }}
    >
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          gap: 8,
          justifyContent: 'space-between',
        }}
      >
        <span
          title={device.name}
          style={{
            fontSize: 13,
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {device.name}
        </span>
        <StatusTag device={device} />
      </div>
      <div
        style={{
          color: 'var(--text-secondary)',
          fontSize: 11,
          marginBottom: 8,
          marginTop: 2,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={device.model}
      >
        {[device.room, device.model].filter(Boolean).join(' · ')}
      </div>
      <DeviceDetail device={device} />
    </div>
  );
}
