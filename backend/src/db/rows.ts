/* eslint-disable @typescript-eslint/naming-convention */

export interface ReadingRow {
  id: number;
  timestamp: number;
  production_w: number;
  grid_w: number;
  battery_w: number;
  consumption_w: number;
  battery_soc: number;
  // Modbus-enhanced fields (nullable)
  ac_power_w: number | null;
  voltage_a_v: number | null;
  voltage_b_v: number | null;
  voltage_c_v: number | null;
  frequency_hz: number | null;
  pv1_power_w: number | null;
  pv2_power_w: number | null;
  battery_charging_w: number | null;
  battery_discharging_w: number | null;
  meter_power_w: number | null;
  /** Net Marstek AC power at this sample (discharge positive); null for old rows. */
  marstek_net_w: number | null;
}

export interface AggregatedReadingRow {
  bucket: number;
  production_w: number;
  grid_w: number;
  battery_w: number;
  consumption_w: number;
  battery_soc: number;
  pv1_power_w: number | null;
  pv2_power_w: number | null;
}

/** One 5-minute interval row scraped from SolarWeb. Values are average watts. */
export interface SolarwebReadingRow {
  timestamp: number;
  production_w: number;
  export_w: number;
  import_w: number;
  self_consumption_w: number;
  /** "Power to battery": battery charging (PV → battery), ≥ 0. */
  battery_w: number;
  /** "Power from battery": battery discharging into the house, ≥ 0. */
  battery_discharge_w: number;
  battery_soc_pct: number | null;
}

/** Result of a GROUP BY aggregation over solarweb_readings. */
export interface AggregatedSolarwebRow {
  bucket: number;
  production_w: number;
  grid_w: number;
  battery_w: number;
  consumption_w: number;
  battery_soc_max: number | null;
  battery_soc_min: number | null;
}

export interface WeatherReadingRow {
  id: number;
  timestamp: number;
  station: string;
  global_radiation_w: number | null;
  temperature_c: number | null;
  humidity_pct: number | null;
  precipitation_mm: number | null;
  sunshine_min: number | null;
}

/** Aggregated weather row (hourly or daily average), without the auto-increment id. */
export interface AggregatedWeatherRow {
  timestamp: number;
  station: string;
  global_radiation_w: number | null;
  global_radiation_w_max: number | null;
  temperature_c: number | null;
  humidity_pct: number | null;
  precipitation_mm: number | null;
  sunshine_min: number | null;
}

/** Result of a kWh aggregation over solarweb_readings for the stats route. */
export interface AggregatedStatsRow {
  period: string;
  production_kwh: number;
  export_kwh: number;
  import_kwh: number;
  self_consumption_kwh: number;
  battery_charge_kwh: number;
}

/** A temperature sensor paired to the IKEA DIRIGERA hub. */
export interface TemperatureSensorRow {
  id: string;
  name: string;
}

/** One environment sample (raw, or one aggregation bucket aliased as `timestamp`). */
export interface TemperatureReadingRow {
  timestamp: number;
  sensor_id: string;
  temperature_c: number;
  humidity_pct: number | null;
  co2_ppm: number | null;
  pm25_ugm3: number | null;
}

/** A configured device in the generic device registry. */
export interface DeviceRow {
  id: number;
  name: string;
  type: string;
  host: string;
  port: number;
  ble_mac: string | null;
  enabled: number;
  poll_interval_ms: number;
  created_at: number;
}

/** One battery reading sample, one row per poll per device. */
export interface BatteryReadingRow {
  id: number;
  device_id: number;
  timestamp: number;
  soc_pct: number | null;
  voltage_v: number | null;
  current_a: number | null;
  power_w: number | null;
  ac_power_w: number | null;
  energy_kwh: number | null;
  internal_temp_c: number | null;
  mos_temp_c: number | null;
  inverter_state: number | null;
  total_charge_kwh: number | null;
  total_discharge_kwh: number | null;
  daily_charge_kwh: number | null;
  daily_discharge_kwh: number | null;
}

/** A battery reading ready to be persisted (no auto-increment id). */
export type BatteryReadingInput = Omit<BatteryReadingRow, 'id'>;

/** Aggregated battery reading over a time bucket. */
export interface AggregatedBatteryRow {
  bucket: number;
  soc_pct: number | null;
  power_w: number | null;
  ac_power_w: number | null;
  energy_kwh: number | null;
  total_charge_kwh: number | null;
  total_discharge_kwh: number | null;
}
