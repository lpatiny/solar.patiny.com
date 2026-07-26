/* eslint-disable camelcase, @typescript-eslint/naming-convention -- the API payload uses snake_case like the other routes */
import { db } from '../db/Database.ts';

import { getFreshLatest } from './batteryPoller.ts';
import {
  getBydReservePct,
  getMarstekReservePct,
  usableEnergy,
} from './batteryReserve.ts';
import { getCurrentReading } from './poller.ts';

/** Nominal capacity of the Fronius-attached BYD pack, in Wh. */
export const HOME_BATTERY_CAPACITY_WH = 11_000;

/** Live power balance the flow decomposition is derived from. */
export interface EnergyFlowInput {
  /** Solar production in watts (never negative). */
  productionW: number;
  /** Grid power: positive = importing (buying), negative = exporting. */
  gridW: number;
  /** Net battery power: positive = discharging, negative = charging. */
  batteryW: number;
}

/** Watts moving along each of the six links between the four entities. */
export interface EnergyFlows {
  solarToHomeW: number;
  solarToBatteryW: number;
  solarToGridW: number;
  batteryToHomeW: number;
  batteryToGridW: number;
  gridToHomeW: number;
  gridToBatteryW: number;
}

/** The four displayed quantities plus the flows between them. */
export interface EnergyFlowResult extends EnergyFlows {
  productionW: number;
  consumptionW: number;
  gridImportW: number;
  gridExportW: number;
  batteryChargeW: number;
  batteryDischargeW: number;
}

/**
 * Split the live power balance into the individual source → sink flows.
 *
 * The three sources (solar, battery discharge, grid import) are allocated to the
 * three sinks (home, battery charge, grid export) greedily, in self-consumption
 * order: solar serves the house first, then charges the battery, and only the
 * leftover is exported; the house is then covered by the battery before the grid.
 * Because charge/discharge and import/export are mutually exclusive, this
 * allocation is exact — the flows add back up to each entity's total.
 * @param input - The live power balance.
 * @returns Every entity total and the flows between them, all in watts.
 */
export function computeEnergyFlow(input: EnergyFlowInput): EnergyFlowResult {
  const { gridW, batteryW } = input;
  const productionW = Math.max(input.productionW, 0);
  const batteryChargeW = Math.max(-batteryW, 0);
  const batteryDischargeW = Math.max(batteryW, 0);
  const gridImportW = Math.max(gridW, 0);
  const gridExportW = Math.max(-gridW, 0);
  // Derived from the balance rather than read separately, so the four squares
  // and the flows between them can never disagree by a sampling skew.
  const consumptionW = Math.max(productionW + batteryW + gridW, 0);

  let solarLeft = productionW;
  let dischargeLeft = batteryDischargeW;
  let importLeft = gridImportW;
  let homeLeft = consumptionW;
  let chargeLeft = batteryChargeW;
  let exportLeft = gridExportW;

  const solarToHomeW = Math.min(solarLeft, homeLeft);
  solarLeft -= solarToHomeW;
  homeLeft -= solarToHomeW;

  const solarToBatteryW = Math.min(solarLeft, chargeLeft);
  solarLeft -= solarToBatteryW;
  chargeLeft -= solarToBatteryW;

  const solarToGridW = Math.min(solarLeft, exportLeft);
  exportLeft -= solarToGridW;

  const batteryToHomeW = Math.min(dischargeLeft, homeLeft);
  dischargeLeft -= batteryToHomeW;
  homeLeft -= batteryToHomeW;

  const batteryToGridW = Math.min(dischargeLeft, exportLeft);

  const gridToHomeW = Math.min(importLeft, homeLeft);
  importLeft -= gridToHomeW;

  const gridToBatteryW = Math.min(importLeft, chargeLeft);

  return {
    productionW,
    consumptionW,
    gridImportW,
    gridExportW,
    batteryChargeW,
    batteryDischargeW,
    solarToHomeW,
    solarToBatteryW,
    solarToGridW,
    batteryToHomeW,
    batteryToGridW,
    gridToHomeW,
    gridToBatteryW,
  };
}

/** Energy stored across every battery, and the capacity it is stored in. */
export interface StoredEnergy {
  storedWh: number;
  capacityWh: number;
}

/**
 * Sum the *usable* energy stored in the BYD pack plus every Marstek reporting
 * fresh telemetry — the reserve floor of each pack is taken out of both the
 * stored energy and the capacity, so a fleet sitting on its floors reads as
 * empty rather than as a permanently-lit remainder. A stale device is skipped
 * entirely, so the level never counts a pack we cannot currently see.
 * @param homeSocPct - BYD state of charge in percent.
 * @returns Usable stored energy and usable capacity, both in Wh.
 */
export function collectStoredEnergy(homeSocPct: number): StoredEnergy {
  const home = usableEnergy(
    homeSocPct,
    HOME_BATTERY_CAPACITY_WH,
    getBydReservePct(),
  );
  let storedWh = home.storedWh;
  let capacityWh = home.capacityWh;

  const marstekReservePct = getMarstekReservePct();
  for (const device of db.listDevices()) {
    if (device.enabled !== 1) continue;
    const values = getFreshLatest(device.id)?.values;
    if (values?.soc_pct == null || values.energy_kwh == null) continue;
    const pack = usableEnergy(
      values.soc_pct,
      values.energy_kwh * 1000,
      marstekReservePct,
    );
    storedWh += pack.storedWh;
    capacityWh += pack.capacityWh;
  }
  return { storedWh, capacityWh };
}

/** The `/api/energy-flow` payload. */
export interface EnergyFlowPayload {
  timestamp: number;
  is_stale: boolean;
  production_w: number;
  consumption_w: number;
  grid_import_w: number;
  grid_export_w: number;
  /** Usable stored energy: the reserve floors are already taken out. */
  battery_stored_wh: number;
  /** Usable capacity, above the reserve floors. */
  battery_capacity_wh: number;
  /** Usable charge: 0 % is the reserve floor, 100 % is full. */
  battery_soc_pct: number;
  battery_charge_w: number;
  battery_discharge_w: number;
  solar_to_home_w: number;
  solar_to_battery_w: number;
  solar_to_grid_w: number;
  battery_to_home_w: number;
  battery_to_grid_w: number;
  grid_to_home_w: number;
  grid_to_battery_w: number;
}

/**
 * Build the live energy-flow payload from the cached Fronius reading and the
 * Marstek telemetry. The Marstek net power is folded into the battery flow, so
 * the household load is the true load behind the meter.
 *
 * Every value is rounded before it is serialized. This is not cosmetic: the
 * ESP32 LED wall (hackuarium/esp32-c3, `src/fronius.cpp`) reads this route into a
 * 1000-byte buffer and warns past 900, and raw float watts would blow that budget
 * on their own. Rounded, the payload is ~440 bytes — keep any new field short.
 * @returns The payload, or null when no reading has been taken yet.
 */
export function collectEnergyFlow(): EnergyFlowPayload | null {
  const reading = getCurrentReading();
  if (!reading) return null;

  const batteryW = reading.battery_w + (reading.marstek_net_w ?? 0);
  const flow = computeEnergyFlow({
    productionW: reading.production_w,
    gridW: reading.grid_w,
    batteryW,
  });
  const { storedWh, capacityWh } = collectStoredEnergy(reading.battery_soc);

  return {
    timestamp: reading.timestamp,
    is_stale: reading.is_stale,
    production_w: Math.round(flow.productionW),
    consumption_w: Math.round(flow.consumptionW),
    grid_import_w: Math.round(flow.gridImportW),
    grid_export_w: Math.round(flow.gridExportW),
    battery_stored_wh: Math.round(storedWh),
    battery_capacity_wh: Math.round(capacityWh),
    battery_soc_pct:
      capacityWh > 0 ? Math.round((storedWh / capacityWh) * 1000) / 10 : 0,
    battery_charge_w: Math.round(flow.batteryChargeW),
    battery_discharge_w: Math.round(flow.batteryDischargeW),
    solar_to_home_w: Math.round(flow.solarToHomeW),
    solar_to_battery_w: Math.round(flow.solarToBatteryW),
    solar_to_grid_w: Math.round(flow.solarToGridW),
    battery_to_home_w: Math.round(flow.batteryToHomeW),
    battery_to_grid_w: Math.round(flow.batteryToGridW),
    grid_to_home_w: Math.round(flow.gridToHomeW),
    grid_to_battery_w: Math.round(flow.gridToBatteryW),
  };
}
