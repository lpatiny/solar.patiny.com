-- Time-series of readings ingested from the live inverter feed.
CREATE TABLE readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  production_w REAL NOT NULL,
  grid_w REAL NOT NULL,
  battery_w REAL NOT NULL,
  consumption_w REAL NOT NULL,
  battery_soc REAL NOT NULL DEFAULT 0,
  ac_power_w REAL DEFAULT NULL,
  voltage_a_v REAL DEFAULT NULL,
  voltage_b_v REAL DEFAULT NULL,
  voltage_c_v REAL DEFAULT NULL,
  frequency_hz REAL DEFAULT NULL,
  pv1_power_w REAL DEFAULT NULL,
  pv2_power_w REAL DEFAULT NULL,
  battery_charging_w REAL DEFAULT NULL,
  battery_discharging_w REAL DEFAULT NULL,
  meter_power_w REAL DEFAULT NULL
);

CREATE INDEX idx_readings_timestamp ON readings(timestamp);

-- 5-minute interval data scraped from SolarWeb (www.solarweb.com/Chart/GetChartNew).
-- Each row represents one 5-minute bucket; values are average watts over that interval.
-- kWh for any period = SUM(col) / 12000  (5 min = 1/12 hr, /1000 W→kW).
CREATE TABLE solarweb_readings (
  timestamp INTEGER NOT NULL PRIMARY KEY,
  production_w REAL NOT NULL DEFAULT 0,
  export_w REAL NOT NULL DEFAULT 0,
  import_w REAL NOT NULL DEFAULT 0,
  self_consumption_w REAL NOT NULL DEFAULT 0,
  battery_w REAL NOT NULL DEFAULT 0,
  battery_soc_pct REAL DEFAULT NULL
);

CREATE TABLE weather_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  station TEXT NOT NULL DEFAULT 'PRE',
  global_radiation_w REAL,
  temperature_c REAL,
  humidity_pct REAL,
  precipitation_mm REAL,
  sunshine_min REAL
);

CREATE UNIQUE INDEX idx_weather_ts_station
  ON weather_readings (timestamp, station);

-- Derived constants for the production model.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('panel_surface_m2',    '46'),
  ('panel_efficiency_pct', '21');

-- Tracks which local calendar dates have been fully scraped from SolarWeb.
-- Decouples the "have we fetched date D?" question from UTC timestamp bucketing,
-- so the skip-logic in scrapeAllHistory does not depend on server timezone.
CREATE TABLE solarweb_synced_dates (
  date TEXT PRIMARY KEY  -- local calendar date 'YYYY-MM-DD' (as used by the SolarWeb API)
);

-- Generic device registry. `type` allows future device kinds; only 'marstek'
-- (Venus E battery) has a driver today. The Marstek battery is addressed over
-- its local UDP Open API (default port 30000). `ble_mac` is the stable identity
-- used to self-heal the (DHCP) host via broadcast discovery.
CREATE TABLE devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'marstek',
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 30000,
  ble_mac TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  poll_interval_ms INTEGER NOT NULL DEFAULT 60000,
  created_at INTEGER NOT NULL,
  UNIQUE (host, port)
);

-- Time-series of battery readings, one row per poll per device.
-- power_w/ac_power_w sign convention: >0 charging, <0 discharging.
CREATE TABLE battery_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  soc_pct REAL,
  voltage_v REAL,
  current_a REAL,
  power_w REAL,
  ac_power_w REAL,
  energy_kwh REAL,
  internal_temp_c REAL,
  mos_temp_c REAL,
  inverter_state INTEGER,
  total_charge_kwh REAL,
  total_discharge_kwh REAL,
  daily_charge_kwh REAL,
  daily_discharge_kwh REAL
);

CREATE INDEX idx_battery_readings_device_ts
  ON battery_readings (device_id, timestamp);

-- Seed the two Marstek Venus E 3.0 batteries, keyed by ble_mac. The host is just
-- a starting hint: DHCP moves the IPs, and the poller self-heals the host by
-- re-discovering the ble_mac when a poll fails.
INSERT INTO devices (name, type, host, port, ble_mac, enabled, poll_interval_ms, created_at)
VALUES
  ('Marstek 1', 'marstek', '192.168.1.52', 30000, '3c1acc36ad10', 1, 60000,
   CAST(strftime('%s', 'now') AS INTEGER)),
  ('Marstek 2', 'marstek', '192.168.1.122', 30000, '3c1acc36a5b1', 1, 60000,
   CAST(strftime('%s', 'now') AS INTEGER));
