import { db } from '../db/Database.ts';

import { getLatest } from './batteryPoller.ts';
import { getForecast } from './forecastService.ts';
import { getCurrentReading } from './poller.ts';
import { readStrategyConfig } from './strategyConfig.ts';
import { MIN_CHARGE_W } from './strategyDecide.ts';

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

/** Predicted charge power and resulting SOC for one battery in one slot. */
export interface BatteryForecastSlot {
  timestamp: number;
  endTimestamp: number;
  chargeW: number;
  socEndPct: number;
}

/** A per-battery predicted charging series across the remaining slots. */
export interface BatteryForecastSeries {
  deviceId: number;
  name: string;
  slots: BatteryForecastSlot[];
}

/** Strategy parameters needed to extrapolate per-battery charging. */
export interface BatteryForecastParams {
  injectTargetW: number;
  chargeMaxW: number;
  chargeCeilingPct: number;
  perBatteryCapacityKwh: number;
}

/**
 * Extrapolate per-battery charge power across the remaining forecast slots by
 * replaying the live control strategy: surplus above the injection target is
 * split equally among the not-yet-full batteries (capped per battery), and each
 * battery's SOC is advanced slot by slot. Pure function so it can be unit-tested.
 * @param slots - the future energy slots (production and consumption per slot)
 * @param devices - the batteries with their current SOC
 * @param params - the resolved strategy parameters and per-battery capacity
 * @returns one predicted charging series per battery
 */
export function simulateBatteryForecast(
  slots: ForecastEnergySlot[],
  devices: BatteryForecastDevice[],
  params: BatteryForecastParams,
): BatteryForecastSeries[] {
  const { injectTargetW, chargeMaxW, chargeCeilingPct, perBatteryCapacityKwh } =
    params;
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

    const eligible: number[] = [];
    for (let i = 0; i < devices.length; i++) {
      const current = soc[i];
      if (
        current !== null &&
        current !== undefined &&
        current < chargeCeilingPct
      ) {
        eligible.push(i);
      }
    }
    const cap = chargeMaxW * eligible.length;
    const desiredTotal = Math.max(0, Math.min(surplusW - injectTargetW, cap));
    const perShare =
      eligible.length > 0
        ? Math.min(chargeMaxW, Math.round(desiredTotal / eligible.length))
        : 0;
    const charging = perShare >= MIN_CHARGE_W;

    for (let i = 0; i < devices.length; i++) {
      const current = soc[i];
      const isEligible = charging && eligible.includes(i);
      let chargeW = 0;
      let socEnd = current ?? 0;
      if (isEligible && current !== null && current !== undefined) {
        const remainingKwh = Math.max(
          0,
          ((chargeCeilingPct - current) / 100) * perBatteryCapacityKwh,
        );
        const maxWForSlot = (remainingKwh * 3_600_000) / durationS;
        chargeW = Math.round(Math.min(perShare, maxWForSlot));
        const energyKwh = (chargeW * durationS) / 3_600_000;
        socEnd = Math.min(
          chargeCeilingPct,
          current + (energyKwh / perBatteryCapacityKwh) * 100,
        );
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

  const batteries: BatteryForecastDevice[] = devices.map((device) => ({
    id: device.id,
    name: device.name,
    socPct: getLatest(device.id)?.values?.soc_pct ?? null,
  }));

  return simulateBatteryForecast(futureSlots, batteries, {
    injectTargetW: config.injectTargetW,
    chargeMaxW: config.chargeMaxW,
    chargeCeilingPct: config.chargeCeilingPct,
    perBatteryCapacityKwh: forecast.batteryCapacityKwh / devices.length,
  });
}
