-- Temperature sensors paired to the IKEA DIRIGERA hub. `id` is the hub's stable
-- device id; `name` is the latest custom/room name reported for it.
CREATE TABLE temperature_sensors (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

-- Time-series of temperature readings, one row per sensor per 5-minute sample.
CREATE TABLE temperature_readings (
  timestamp     INTEGER NOT NULL,
  sensor_id     TEXT NOT NULL,
  temperature_c REAL NOT NULL,
  PRIMARY KEY (sensor_id, timestamp)
);

CREATE INDEX idx_temperature_readings_ts ON temperature_readings (timestamp);
