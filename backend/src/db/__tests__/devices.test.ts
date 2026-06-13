/* eslint-disable camelcase -- DB fields use snake_case */
import { expect, test } from 'vitest';

import { Database } from '../Database.ts';
import type { BatteryReadingInput } from '../rows.ts';

async function freshDb(): Promise<Database> {
  return Database.open(':memory:');
}

const sampleInput = {
  name: 'Test Battery',
  type: 'marstek',
  host: '10.0.0.5',
  ble_mac: null,
  port: 30_000,
  enabled: true,
  poll_interval_ms: 60_000,
};

function reading(
  deviceId: number,
  timestamp: number,
  overrides: Partial<BatteryReadingInput> = {},
): BatteryReadingInput {
  return {
    device_id: deviceId,
    timestamp,
    soc_pct: 50,
    voltage_v: 53.5,
    current_a: 0.1,
    power_w: 0,
    ac_power_w: -800,
    energy_kwh: 5.12,
    internal_temp_c: 27,
    mos_temp_c: 27.5,
    inverter_state: 2,
    total_charge_kwh: 15.73,
    total_discharge_kwh: 12.22,
    daily_charge_kwh: 0,
    daily_discharge_kwh: 0,
    ...overrides,
  };
}

test('migration seeds the two discovered Marstek devices', async () => {
  const db = await freshDb();
  const devices = db.listDevices();

  expect(devices).toHaveLength(2);
  expect(devices[0]?.host).toBe('192.168.1.52');
  expect(devices[1]?.host).toBe('192.168.1.122');
  expect(devices[0]?.ble_mac).toBe('3c1acc36ad10');
  expect(devices[1]?.ble_mac).toBe('3c1acc36a5b1');
  expect(devices[0]?.port).toBe(30_000);
  expect(devices[1]?.port).toBe(30_000);
  expect(devices.every((device) => device.type === 'marstek')).toBe(true);
});

test('device CRUD round-trips', async () => {
  const db = await freshDb();
  const created = db.insertDevice(sampleInput);

  expect(created.id).toBeGreaterThan(0);
  expect(created.host).toBe('10.0.0.5');
  expect(created.enabled).toBe(1);

  const updated = db.updateDevice(created.id, {
    ...sampleInput,
    name: 'Renamed',
    enabled: false,
  });

  expect(updated?.name).toBe('Renamed');
  expect(updated?.enabled).toBe(0);

  expect(db.listDevices()).toHaveLength(3); // 2 seeded + created
});

test('deleteDevice cascades to its battery readings', async () => {
  const db = await freshDb();
  const device = db.insertDevice(sampleInput);
  db.insertBatteryReading(reading(device.id, 1000));
  db.insertBatteryReading(reading(device.id, 1060));

  expect(db.queryBatteryReadingsRaw(device.id, 0, 2000)).toHaveLength(2);

  db.deleteDevice(device.id);

  expect(db.getDevice(device.id)).toBeNull();
  expect(db.queryBatteryReadingsRaw(device.id, 0, 2000)).toHaveLength(0);
});

test('getLatestBatteryReading returns the newest row', async () => {
  const db = await freshDb();
  const device = db.insertDevice(sampleInput);
  db.insertBatteryReading(reading(device.id, 1000, { soc_pct: 40 }));
  db.insertBatteryReading(reading(device.id, 2000, { soc_pct: 60 }));

  expect(db.getLatestBatteryReading(device.id)?.soc_pct).toBe(60);
});

test('hourly aggregation averages SOC/power and keeps the max energy total', async () => {
  const db = await freshDb();
  const device = db.insertDevice(sampleInput);
  // Two samples in the same hour bucket (3600..7199), one in the next.
  db.insertBatteryReading(
    reading(device.id, 3600, {
      soc_pct: 40,
      power_w: 100,
      total_charge_kwh: 10,
    }),
  );
  db.insertBatteryReading(
    reading(device.id, 5400, {
      soc_pct: 60,
      power_w: 300,
      total_charge_kwh: 11,
    }),
  );
  db.insertBatteryReading(
    reading(device.id, 7200, {
      soc_pct: 80,
      power_w: 500,
      total_charge_kwh: 12,
    }),
  );

  const hourly = db.queryBatteryReadingsHourly(device.id, 0, 10_000);

  expect(hourly).toHaveLength(2);
  // node:sqlite rows have a null prototype; spread to compare as a plain object.
  expect({ ...hourly[0] }).toStrictEqual({
    bucket: 3600,
    soc_pct: 50,
    power_w: 200,
    ac_power_w: -800,
    energy_kwh: 5.12,
    total_charge_kwh: 11,
    total_discharge_kwh: 12.22,
  });
  expect(hourly[1]?.bucket).toBe(7200);
  expect(hourly[1]?.soc_pct).toBe(80);
});

test('history queries are scoped to one device', async () => {
  const db = await freshDb();
  const a = db.insertDevice(sampleInput);
  const b = db.insertDevice({ ...sampleInput, host: '10.0.0.6' });
  db.insertBatteryReading(reading(a.id, 1000, { soc_pct: 11 }));
  db.insertBatteryReading(reading(b.id, 1000, { soc_pct: 99 }));

  const rowsA = db.queryBatteryReadingsRaw(a.id, 0, 2000);

  expect(rowsA).toHaveLength(1);
  expect(rowsA[0]?.soc_pct).toBe(11);
});
