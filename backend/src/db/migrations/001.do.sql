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
