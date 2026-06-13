/* eslint-disable camelcase, @typescript-eslint/naming-convention -- Open API wire fields are snake_case */
import type { MarstekValues } from './marstekRegisters.ts';
import type { UdpDeviceAddress } from './marstekUdpTransport.ts';
import { rpc } from './marstekUdpTransport.ts';

/** Result of `ES.GetStatus`: the device's basic electrical/energy snapshot. */
export interface EsStatusResult {
  id: number;
  bat_soc: number;
  bat_cap: number;
  pv_power: number;
  /** Grid-tied power [W]. Negative = charging/importing, positive = discharging. */
  ongrid_power: number;
  offgrid_power: number;
  total_pv_energy: number;
  total_grid_output_energy: number;
  total_grid_input_energy: number;
  total_load_energy: number;
}

/** Result of `Bat.GetStatus`: battery pack detail (temperature, flags). */
export interface BatStatusResult {
  id: number;
  soc: number;
  charg_flag: boolean;
  dischrg_flag: boolean;
  bat_temp: number | null;
  /** Remaining capacity [Wh]. */
  bat_capacity: number | null;
  /** Rated capacity [Wh] (per-controller nominal, not the full pack). */
  rated_capacity: number | null;
}

/**
 * Read the device's electrical snapshot (`ES.GetStatus`) — one paced request,
 * suitable for polling. Returns the raw result plus a mapping to the shared
 * {@link MarstekValues} shape persisted by the battery poller.
 * @param address - device host and UDP port
 * @returns the raw `ES.GetStatus` result and its `MarstekValues` mapping
 */
export async function readMarstekUdp(
  address: UdpDeviceAddress,
): Promise<{ status: EsStatusResult; values: MarstekValues }> {
  const status = await rpc<EsStatusResult>(address, 'ES.GetStatus', { id: 0 });
  return { status, values: toMarstekValues(status) };
}

/**
 * Read battery-pack detail (`Bat.GetStatus`): temperature and charge/discharge
 * permission flags. A second paced request (≥10 s after any other call).
 * @param address - device host and UDP port
 * @returns the `Bat.GetStatus` detail
 */
export async function readMarstekUdpBattery(
  address: UdpDeviceAddress,
): Promise<BatStatusResult> {
  return rpc<BatStatusResult>(address, 'Bat.GetStatus', { id: 0 });
}

/**
 * Map an `ES.GetStatus` result to the shared {@link MarstekValues} shape. Only
 * the fields the Open API exposes are populated; the rest are null. `ongrid_power`
 * keeps the Modbus sign convention (negative = charging).
 * @param status - the `ES.GetStatus` result
 * @returns the mapped `MarstekValues`
 */
export function toMarstekValues(status: EsStatusResult): MarstekValues {
  return {
    soc_pct: status.bat_soc,
    ac_power_w: status.ongrid_power,
    energy_kwh: status.bat_cap / 1000,
    voltage_v: null,
    current_a: null,
    power_w: null,
    internal_temp_c: null,
    mos_temp_c: null,
    inverter_state: null,
    total_charge_kwh: status.total_grid_input_energy / 1000,
    total_discharge_kwh: status.total_grid_output_energy / 1000,
    daily_charge_kwh: null,
    daily_discharge_kwh: null,
  };
}
