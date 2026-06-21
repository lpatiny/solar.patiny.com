/* eslint-disable camelcase -- normalized device shape uses snake_case JSON keys */
import { expect, test } from 'vitest';

import type { DirigeraDevice } from '../dirigeraClient.ts';
import { normalizeDevice, normalizeDevices } from '../dirigeraDevices.ts';

const rgbLight: DirigeraDevice = {
  id: 'light-1',
  type: 'light',
  isReachable: true,
  room: { name: 'Bedroom' },
  attributes: {
    customName: 'Light 4',
    model: 'TRADFRI bulb E27 CWS 806lm',
    firmwareVersion: '1.0.0',
    otaStatus: 'upToDate',
    isOn: true,
    lightLevel: 40,
    colorMode: 'color',
    colorHue: 20.88,
    colorSaturation: 0.99,
    colorTemperature: 2202,
  },
};

const whiteLight: DirigeraDevice = {
  id: 'light-2',
  type: 'light',
  isReachable: true,
  room: { name: 'Kitchen' },
  attributes: {
    model: 'TRADFRI bulb E27 WS',
    isOn: false,
    lightLevel: 100,
    colorMode: 'temperature',
    colorTemperature: 2700,
  },
};

const remote: DirigeraDevice = {
  id: 'remote-1',
  type: 'controller',
  deviceType: 'lightController',
  isReachable: true,
  room: { name: 'Bedroom' },
  attributes: {
    customName: 'FloRemote',
    model: 'Remote Control N2',
    batteryPercentage: 65,
  },
};

const sensor: DirigeraDevice = {
  id: 'sensor-1',
  type: 'sensor',
  isReachable: false,
  room: { name: 'Cellar' },
  attributes: {
    model: 'ALPSTUGA air quality monitor',
    currentTemperature: 23.3,
    currentRH: 63,
    currentCO2: 867,
    currentPM25: 4,
  },
};

test('normalizes an RGB light in color mode with hue/saturation', () => {
  expect(normalizeDevice(rgbLight)).toStrictEqual({
    id: 'light-1',
    type: 'light',
    model: 'TRADFRI bulb E27 CWS 806lm',
    name: 'Light 4',
    room: 'Bedroom',
    is_reachable: true,
    is_on: true,
    light_level: 40,
    color_mode: 'color',
    color: { hue: 20.88, saturation: 0.99 },
    color_temperature: 2202,
    battery_percentage: null,
    temperature_c: null,
    humidity_pct: null,
    co2_ppm: null,
    pm25_ugm3: null,
    firmware_version: '1.0.0',
    ota_status: 'upToDate',
  });
});

test('a white-spectrum light in temperature mode has no color swatch', () => {
  const result = normalizeDevice(whiteLight);
  expect(result.color).toBeNull();
  expect(result.color_mode).toBe('temperature');
  expect(result.color_temperature).toBe(2700);
  expect(result.is_on).toBe(false);
});

test('a remote falls back to its custom name and exposes battery', () => {
  const result = normalizeDevice(remote);
  expect(result.name).toBe('FloRemote');
  expect(result.type).toBe('controller');
  expect(result.battery_percentage).toBe(65);
  expect(result.color).toBeNull();
});

test('an offline sensor keeps its readings but is marked unreachable', () => {
  const result = normalizeDevice(sensor);
  expect(result.is_reachable).toBe(false);
  expect(result.name).toBe('Cellar');
  expect(result.temperature_c).toBe(23.3);
  expect(result.co2_ppm).toBe(867);
  expect(result.pm25_ugm3).toBe(4);
});

test('sorts devices by type then name', () => {
  const sorted = normalizeDevices([sensor, rgbLight, remote, whiteLight]);
  expect(sorted.map((d) => d.id)).toStrictEqual([
    'remote-1', // controller
    'light-2', // light, "Kitchen" (room name; no custom name)
    'light-1', // light, "Light 4"
    'sensor-1', // sensor
  ]);
});
