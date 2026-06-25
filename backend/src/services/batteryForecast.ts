import { db } from '../db/Database.ts';

import { getFreshLatest } from './batteryPoller.ts';
import { getForecast } from './forecastService.ts';
import { getCurrentReading } from './poller.ts';
import { readStrategyConfig } from './strategyConfig.ts';
import { MIN_CHARGE_W, MIN_DISCHARGE_W } from './strategyDecide.ts';

/** One battery's identity and current charge state for the simulation. */
export interface BatteryForecastDevice {
  id: number;
  name: string;
  /** Current state of charge (%), or null if unknown. */
  socPct: number | null;
}

/** A future 3-hour slot with its predicted solar and consumption energy. */
export interface ForecastEnergySlot {
  timestamp: number;
  endTimestamp: number;
  predictedProductionKwh: number;
  typicalConsumptionKwh: number;
}

/** Predicted net battery power and resulting SOC for one battery in one slot. */
export interface BatteryForecastSlot {
  timestamp: number;
  endTimestamp: number;
  /** Net power: positive = charging, negative = discharging to cover the deficit. */
  chargeW: number;
  socEndPct: number;
}

/** A per-battery predicted charging series across the remaining slots. */
export interface BatteryForecastSeries {
  deviceId: number;
  name: string;
  slots: BatteryForecastSlot[];
}

/** Strategy parameters needed to extrapolate per-battery charge/discharge. */
export interface BatteryForecastParams {
  injectTargetW: number;
  chargeMaxW: number;
  chargeCeilingPct: number;
  /** Per-battery discharge ceiling (W) when covering a post-solar deficit. */
  dischargeMaxW: number;
  /** Stop discharging a battery once its SOC falls to this percentage. */
  dischargeFloorPct: number;
  perBatteryCapacityKwh: number;
}

/**
 * Extrapolate per-battery net power across the remaining forecast slots by
 * replaying the live control strategy. Charging takes priority: surplus above the
 * injection target is split equally among the not-yet-full batteries (capped per
 * battery). When there is no surplus but a post-solar deficit, the batteries
 * discharge to cover it — split across the above-floor batteries, capped per
 * battery — mirroring `decide`'s cover mode. Each battery's SOC is advanced (up
 * when charging, down when discharging) slot by slot. Pure function so it can be
 * unit-tested.
 * @param slots - the future energy slots (production and consumption per slot)
 * @param devices - the batteries with their current SOC
 * @param params - the resolved strategy parameters and per-battery capacity
 * @returns one predicted net-power series per battery (chargeW > 0 charge, < 0 discharge)
 */
export function simulateBatteryForecast(
  slots: ForecastEnergySlot[],
  devices: BatteryForecastDevice[],
  params: BatteryForecastParams,
): BatteryForecastSeries[] {
  const {
    injectTargetW,
    chargeMaxW,
    chargeCeilingPct,
    dischargeMaxW,
    dischargeFloorPct,
    perBatteryCapacityKwh,
  } = params;
  const soc = devices.map((device) => device.socPct);
  const series: BatteryForecastSeries[] = devices.map((device) => ({
    deviceId: device.id,
    name: device.name,
    slots: [],
  }));

  for (const slot of slots) {
    const durationS = slot.endTimestamp - slot.timestamp;
    const surplusW =
      ((slot.predictedProductionKwh - slot.typicalConsumptionKwh) * 3_600_000) /
      durationS;

    // Charge from solar surplus (priority).
    const chargeEligible: number[] = [];
    for (let i = 0; i < devices.length; i++) {
      const current = soc[i];
      if (
        current !== null &&
        current !== undefined &&
        current < chargeCeilingPct
      ) {
        chargeEligible.push(i);
      }
    }
    const chargeCap = chargeMaxW * chargeEligible.length;
    const desiredCharge = Math.max(
      0,
      Math.min(surplusW - injectTargetW, chargeCap),
    );
    const perCharge =
      chargeEligible.length > 0
        ? Math.min(
            chargeMaxW,
            Math.round(desiredCharge / chargeEligible.length),
          )
        : 0;
    const charging = perCharge >= MIN_CHARGE_W;

    // Otherwise discharge to cover the post-solar deficit (consumption the solar
    // cannot meet), split across the above-floor batteries and capped per battery.
    const deficitW = Math.max(0, -surplusW);
    const dischargeEligible: number[] = [];
    if (!charging) {
      for (let i = 0; i < devices.length; i++) {
        const current = soc[i];
        if (
          current !== null &&
          current !== undefined &&
          current > dischargeFloorPct
        ) {
          dischargeEligible.push(i);
        }
      }
    }
    const dischargeCap = dischargeMaxW * dischargeEligible.length;
    const desiredDischarge = Math.max(0, Math.min(deficitW, dischargeCap));
    const perDischarge =
      dischargeEligible.length > 0
        ? Math.min(
            dischargeMaxW,
            Math.round(desiredDischarge / dischargeEligible.length),
          )
        : 0;
    const discharging = perDischarge >= MIN_DISCHARGE_W;

    for (let i = 0; i < devices.length; i++) {
      const current = soc[i];
      let chargeW = 0;
      let socEnd = current ?? 0;
      if (
        charging &&
        chargeEligible.includes(i) &&
        current !== null &&
        current !== undefined
      ) {
        const remainingKwh = Math.max(
          0,
          ((chargeCeilingPct - current) / 100) * perBatteryCapacityKwh,
        );
        const maxWForSlot = (remainingKwh * 3_600_000) / durationS;
        chargeW = Math.round(Math.min(perCharge, maxWForSlot));
        const energyKwh = (chargeW * durationS) / 3_600_000;
        socEnd = Math.min(
          chargeCeilingPct,
          current + (energyKwh / perBatteryCapacityKwh) * 100,
        );
        soc[i] = socEnd;
      } else if (
        discharging &&
        dischargeEligible.includes(i) &&
        current !== null &&
        current !== undefined
      ) {
        const availableKwh = Math.max(
          0,
          ((current - dischargeFloorPct) / 100) * perBatteryCapacityKwh,
        );
        const maxWForSlot = (availableKwh * 3_600_000) / durationS;
        const dischargeW = Math.round(Math.min(perDischarge, maxWForSlot));
        const energyKwh = (dischargeW * durationS) / 3_600_000;
        socEnd = Math.max(
          dischargeFloorPct,
          current - (energyKwh / perBatteryCapacityKwh) * 100,
        );
        chargeW = -dischargeW;
        soc[i] = socEnd;
      }
      series[i]?.slots.push({
        timestamp: slot.timestamp,
        endTimestamp: slot.endTimestamp,
        chargeW,
        socEndPct: Math.round(socEnd * 10) / 10,
      });
    }
  }

  return series;
}

/**
 * Build the per-battery charging forecast from live inputs: the enabled Marstek
 * devices, their current SOC, the strategy configuration, and today's remaining
 * solar/consumption forecast slots. Per-battery capacity is the system capacity
 * divided evenly across the batteries.
 * @returns one predicted charging series per enabled battery (empty if none)
 */
export async function getBatteryForecast(): Promise<BatteryForecastSeries[]> {
  const devices = db
    .listDevices()
    .filter((device) => device.enabled === 1 && device.type === 'marstek');
  if (devices.length === 0) return [];

  const config = readStrategyConfig();
  const current = getCurrentReading();
  const forecast = await getForecast(current?.battery_soc ?? 50);
  const futureSlots: ForecastEnergySlot[] = forecast.slots
    .filter((slot) => !slot.isPast)
    .map((slot) => ({
      timestamp: slot.timestamp,
      endTimestamp: slot.endTimestamp,
      predictedProductionKwh: slot.predictedProductionKwh,
      typicalConsumptionKwh: slot.typicalConsumptionKwh,
    }));

  // Seed each battery's starting SOC from FRESH telemetry only. A stale (offline)
  // device's last-known SOC is dropped to null, so the forecast treats it as
  // unknown — exactly as the control loop does — instead of projecting from a
  // potentially hours-old value.
  const batteries: BatteryForecastDevice[] = devices.map((device) => ({
    id: device.id,
    name: device.name,
    socPct: getFreshLatest(device.id)?.values?.soc_pct ?? null,
  }));

  return simulateBatteryForecast(futureSlots, batteries, {
    injectTargetW: config.injectTargetW,
    chargeMaxW: config.chargeMaxW,
    chargeCeilingPct: config.chargeCeilingPct,
    dischargeMaxW: config.dischargeMaxW,
    dischargeFloorPct: config.dischargeFloorPct,
    perBatteryCapacityKwh: forecast.batteryCapacityKwh / devices.length,
  });
}
