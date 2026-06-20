-- Reconcile every "consumption" figure to the true household load by storing the
-- flows the two measurement systems each miss.

-- Net Marstek AC power at the time of each live reading: discharge positive,
-- charge negative (sum of each device's ac_power_w). The Fronius meter cannot see
-- the plug-in Marstek, so true load = consumption_w + marstek_net_w. NULL for rows
-- written before this column existed.
ALTER TABLE readings ADD COLUMN marstek_net_w REAL;

-- BYD battery discharge (battery -> house) from SolarWeb's "Power from battery"
-- series. The scraped battery_w ("Power to battery") only carries charging, so
-- without this the scraped consumption (self_consumption_w + import_w) omitted the
-- battery-sourced part of the load. 0 when the series is unavailable for a slot.
ALTER TABLE solarweb_readings ADD COLUMN battery_discharge_w REAL NOT NULL DEFAULT 0;
