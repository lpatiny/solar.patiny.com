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
  battery_w: number;
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

/** Result of a kWh aggregation over solarweb_readings for the stats route. */
export interface AggregatedStatsRow {
  period: string;
  production_kwh: number;
  export_kwh: number;
  import_kwh: number;
  self_consumption_kwh: number;
  battery_charge_kwh: number;
}
