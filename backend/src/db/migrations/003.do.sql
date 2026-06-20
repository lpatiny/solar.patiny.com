-- Additional environment metrics reported alongside temperature by the same
-- DIRIGERA environmentSensor (ALPSTUGA). All nullable: a sensor may report
-- temperature but not every metric.
ALTER TABLE temperature_readings ADD COLUMN humidity_pct REAL;
ALTER TABLE temperature_readings ADD COLUMN co2_ppm REAL;
ALTER TABLE temperature_readings ADD COLUMN pm25_ugm3 REAL;
