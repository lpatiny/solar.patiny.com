/* eslint-disable @typescript-eslint/naming-convention -- API response fields use snake_case */

/** A configured device in the registry. */
export interface Device {
  id: number;
  name: string;
  type: string;
  host: string;
  port: number;
  ble_mac: string | null;
  enabled: boolean;
  poll_interval_ms: number;
  created_at: number;
}

/** A device found by broadcast discovery on the LAN (`GET /api/devices/scan`). */
export interface DiscoveredDevice {
  device: string;
  ver: number;
  ble_mac: string;
  wifi_mac: string;
  wifi_name: string;
  ip: string;
}

/** Decoded battery measurements (null when a register block could not be read). */
export interface BatteryValues {
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

/** One controllable parameter with its current value (read-only in this version). */
export interface ControlParam {
  key: string;
  label: string;
  kind: 'enum' | 'number';
  value: number | null;
  unit?: string;
  min?: number;
  max?: number;
  options?: Array<{ value: number; label: string }>;
  register: number;
}

/** Latest live snapshot for a device, as returned by `/api/devices/:id/live`. */
export interface DeviceLive {
  device_id: number;
  timestamp: number;
  is_stale: boolean;
  error: string | null;
  values: BatteryValues | null;
  control: ControlParam[];
}

/** One point in the battery history series. */
export interface BatteryHistoryPoint {
  timestamp: number;
  soc_pct: number | null;
  power_w: number | null;
  ac_power_w: number | null;
  energy_kwh: number | null;
  total_charge_kwh: number | null;
  total_discharge_kwh: number | null;
}
