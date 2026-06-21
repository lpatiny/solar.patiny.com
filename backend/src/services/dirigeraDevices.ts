/* eslint-disable camelcase, @typescript-eslint/naming-convention -- JSON API fields use snake_case */
import type { DirigeraDevice } from './dirigeraClient.ts';
import { isConfigured } from './dirigeraClient.ts';

const STALE_THRESHOLD_MS = 5 * 60_000;

/** Hue/saturation of an RGB light currently in color mode. */
export interface DirigeraColor {
  /** Hue in degrees, 0–360. */
  hue: number;
  /** Saturation, 0–1. */
  saturation: number;
}

/** A normalized, read-only view of one DIRIGERA device for the status page. */
export interface DirigeraDeviceStatus {
  id: string;
  /** `light` | `gateway` | `controller` | `sensor` | … */
  type: string;
  model: string;
  name: string;
  room: string | null;
  is_reachable: boolean;
  /** On/off state for switchable devices, otherwise `null`. */
  is_on: boolean | null;
  /** Brightness percentage (lights, controllers), otherwise `null`. */
  light_level: number | null;
  /** `color` | `temperature` for lights, otherwise `null`. */
  color_mode: string | null;
  /** Hue/saturation when an RGB light is in color mode, otherwise `null`. */
  color: DirigeraColor | null;
  /** Colour temperature in Kelvin for white-spectrum lights, otherwise `null`. */
  color_temperature: number | null;
  /** Remaining battery percentage for battery devices, otherwise `null`. */
  battery_percentage: number | null;
  temperature_c: number | null;
  humidity_pct: number | null;
  co2_ppm: number | null;
  pm25_ugm3: number | null;
  firmware_version: string | null;
  ota_status: string | null;
}

/** A point-in-time snapshot of every device the hub reports. */
export interface DevicesSnapshot {
  /** Unix seconds of the last successful poll (0 if never polled). */
  timestamp: number;
  is_stale: boolean;
  configured: boolean;
  devices: DirigeraDeviceStatus[];
}

let latestDevices: DirigeraDeviceStatus[] = [];
let lastUpdatedAt = 0;

function nullable<T>(value: T | null | undefined): T | null {
  return value === undefined || value === null ? null : value;
}

function deviceName(device: DirigeraDevice): string {
  const custom = device.attributes?.customName?.trim();
  if (custom) return custom;
  const room = device.room?.name?.trim();
  if (room) return room;
  return device.id;
}

/** Normalize one raw hub device into the read-only status shape. */
export function normalizeDevice(device: DirigeraDevice): DirigeraDeviceStatus {
  const attributes = device.attributes ?? {};
  const color =
    attributes.colorMode === 'color' &&
    typeof attributes.colorHue === 'number' &&
    typeof attributes.colorSaturation === 'number'
      ? { hue: attributes.colorHue, saturation: attributes.colorSaturation }
      : null;
  return {
    id: device.id,
    type: device.type ?? device.deviceType ?? 'unknown',
    model: attributes.model ?? 'unknown',
    name: deviceName(device),
    room: device.room?.name?.trim() || null,
    is_reachable: device.isReachable !== false,
    is_on: nullable(attributes.isOn),
    light_level: nullable(attributes.lightLevel),
    color_mode: nullable(attributes.colorMode),
    color,
    color_temperature: nullable(attributes.colorTemperature),
    battery_percentage: nullable(attributes.batteryPercentage),
    temperature_c: nullable(attributes.currentTemperature),
    humidity_pct: nullable(attributes.currentRH),
    co2_ppm: nullable(attributes.currentCO2),
    pm25_ugm3: nullable(attributes.currentPM25),
    firmware_version: nullable(attributes.firmwareVersion),
    ota_status: nullable(attributes.otaStatus),
  };
}

/**
 * Normalize the full hub device list, sorted by type then name so the status
 * page renders a stable, grouped layout.
 * @param devices - raw devices from the hub
 * @returns normalized device statuses
 */
export function normalizeDevices(
  devices: DirigeraDevice[],
): DirigeraDeviceStatus[] {
  const normalized = devices.map(normalizeDevice);
  normalized.sort(
    (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name),
  );
  return normalized;
}

/**
 * Update the cached device snapshot. Called by the DIRIGERA poll so the status
 * page and the temperature card share a single hub fetch.
 * @param devices - raw devices from the latest successful poll
 * @param atMs - poll time in milliseconds
 */
export function setDevices(devices: DirigeraDevice[], atMs: number): void {
  latestDevices = normalizeDevices(devices);
  lastUpdatedAt = atMs;
}

/**
 * Latest cached device statuses, served from memory.
 * @returns the device snapshot, with `is_stale` true when the last successful
 * poll is older than the stale threshold (or never happened).
 */
export function getDevices(): DevicesSnapshot {
  return {
    timestamp: Math.floor(lastUpdatedAt / 1000),
    is_stale:
      lastUpdatedAt === 0 || Date.now() - lastUpdatedAt > STALE_THRESHOLD_MS,
    configured: isConfigured(),
    devices: latestDevices,
  };
}
