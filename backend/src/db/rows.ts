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

export interface DailyStatsRow {
  date: string;
  production_kwh: number;
  export_kwh: number;
  import_kwh: number;
  self_consumption_kwh: number;
}

export interface ComputedDailyStatsRow {
  date: string;
  production_kwh: number;
  export_kwh: number;
  import_kwh: number;
}
