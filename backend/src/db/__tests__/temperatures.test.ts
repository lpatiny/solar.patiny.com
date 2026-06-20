/* eslint-disable camelcase -- DB fields use snake_case */
import { expect, test } from 'vitest';

import type { TemperatureInput } from '../Database.ts';
import { Database } from '../Database.ts';

async function freshDb(): Promise<Database> {
  return Database.open(':memory:');
}

function sensor(
  id: string,
  name: string,
  temperature_c: number,
  overrides: Partial<TemperatureInput> = {},
): TemperatureInput {
  return {
    id,
    name,
    temperature_c,
    humidity_pct: 50,
    co2_ppm: 500,
    pm25_ugm3: 2,
    ...overrides,
  };
}

test('recordTemperatures stores sensors and all metrics', async () => {
  const db = await freshDb();
  db.recordTemperatures(3600, [
    sensor('a', 'Living room', 20, {
      humidity_pct: 45,
      co2_ppm: 520,
      pm25_ugm3: 3,
    }),
    sensor('b', 'Bedroom', 18, {
      humidity_pct: 60,
      co2_ppm: 480,
      pm25_ugm3: 1,
    }),
  ]);

  // Sensors are listed alphabetically by name. node:sqlite rows have a null
  // prototype, so spread each to compare as a plain object.
  expect(db.listTemperatureSensors().map((s) => ({ ...s }))).toStrictEqual([
    { id: 'b', name: 'Bedroom' },
    { id: 'a', name: 'Living room' },
  ]);

  const raw = db.queryTemperatureReadingsRaw(0, 10_000);
  expect(raw).toHaveLength(2);
  const a = raw.find((r) => r.sensor_id === 'a');
  expect(a?.temperature_c).toBe(20);
  expect(a?.humidity_pct).toBe(45);
  expect(a?.co2_ppm).toBe(520);
  expect(a?.pm25_ugm3).toBe(3);
});

test('recordTemperatures upserts every metric on conflict', async () => {
  const db = await freshDb();
  db.recordTemperatures(3600, [sensor('a', 'Living room', 20)]);
  db.recordTemperatures(3600, [
    sensor('a', 'Living room renamed', 99, { humidity_pct: 11 }),
  ]);

  expect(db.listTemperatureSensors().map((s) => ({ ...s }))).toStrictEqual([
    { id: 'a', name: 'Living room renamed' },
  ]);
  const raw = db.queryTemperatureReadingsRaw(0, 10_000);
  expect(raw).toHaveLength(1);
  expect(raw[0]?.temperature_c).toBe(99);
  expect(raw[0]?.humidity_pct).toBe(11);
});

test('null metrics are stored and averaged as null', async () => {
  const db = await freshDb();
  db.recordTemperatures(3600, [
    sensor('a', 'Living room', 20, { co2_ppm: null, pm25_ugm3: null }),
  ]);
  const hourly = db.queryTemperatureReadingsHourly(0, 10_000);
  expect(hourly[0]?.temperature_c).toBe(20);
  expect(hourly[0]?.co2_ppm).toBeNull();
});

test('hourly aggregation averages each metric per sensor per bucket', async () => {
  const db = await freshDb();
  // Two samples in hour bucket 3600..7199, one in the next bucket.
  db.recordTemperatures(3600, [
    sensor('a', 'Living room', 20, { humidity_pct: 40 }),
    sensor('b', 'Bedroom', 18, { humidity_pct: 50 }),
  ]);
  db.recordTemperatures(5400, [
    sensor('a', 'Living room', 22, { humidity_pct: 50 }),
    sensor('b', 'Bedroom', 19, { humidity_pct: 52 }),
  ]);
  db.recordTemperatures(7200, [sensor('a', 'Living room', 25)]);

  const hourly = db.queryTemperatureReadingsHourly(0, 10_000);

  const a3600 = hourly.find((r) => r.sensor_id === 'a' && r.timestamp === 3600);
  const b3600 = hourly.find((r) => r.sensor_id === 'b' && r.timestamp === 3600);
  const a7200 = hourly.find((r) => r.sensor_id === 'a' && r.timestamp === 7200);
  expect(a3600?.temperature_c).toBe(21); // (20 + 22) / 2
  expect(a3600?.humidity_pct).toBe(45); // (40 + 50) / 2
  expect(b3600?.temperature_c).toBe(18.5); // (18 + 19) / 2
  expect(a7200?.temperature_c).toBe(25);
});

test('queries are scoped to the requested time range', async () => {
  const db = await freshDb();
  db.recordTemperatures(1000, [sensor('a', 'Living room', 10)]);
  db.recordTemperatures(5000, [sensor('a', 'Living room', 30)]);

  const raw = db.queryTemperatureReadingsRaw(0, 2000);
  expect(raw).toHaveLength(1);
  expect(raw[0]?.temperature_c).toBe(10);
});
