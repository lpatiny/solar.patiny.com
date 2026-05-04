/* eslint-disable @typescript-eslint/naming-convention -- DB and API fields use snake_case */
import { createRequire } from 'node:module';

import { db } from '../db/Database.ts';
import {
  DENGES_LAT,
  DENGES_LNG,
  getSunTimesForDate,
} from '../utils/sunTimes.ts';
import {
  cloudFactorFromMask,
  weatherDescription,
} from '../utils/weatherMask.ts';

import { clearSkyGhi, totalPredictedPower } from './analysisService.ts';
import type { MeteoReading } from './meteoStationService.ts';
import { fetchStationReadings, filterReadings } from './meteoStationService.ts';

const _require = createRequire(import.meta.url);

interface SunCalcPosition {
  altitude: number;
  azimuth: number;
}

const suncalc: {
  getPosition(d: Date, lat: number, lng: number): SunCalcPosition;
} = _require('suncalc');

const WEATHER_PROXY_URL = 'https://weather-proxy.cheminfo.org/v2/forecast24';

// System derating: inverter, wiring, temperature, soiling losses
const PV_EFFICIENCY = 0.8;

function getPanelConfig(): {
  surfaceM2: number;
  efficiencyPct: number;
  peakKw: number;
  scalingFactor: number;
} {
  const surfaceM2 = Number(db.getSetting('panel_surface_m2') ?? 46);
  const efficiencyPct = Number(db.getSetting('panel_efficiency_pct') ?? 21);
  const peakKw = (surfaceM2 * efficiencyPct) / 100;
  return {
    surfaceM2,
    efficiencyPct,
    peakKw,
    scalingFactor: peakKw * PV_EFFICIENCY,
  };
}
const TYPICAL_CONSUMPTION_W = Number(process.env.TYPICAL_CONSUMPTION_W ?? 400);
const NEIGHBOR_EXPORT_TARGET_W = Number(
  process.env.NEIGHBOR_EXPORT_TARGET_W ?? 500,
);
const BATTERY_CAPACITY_KWH = Number(process.env.BATTERY_CAPACITY_KWH ?? 11);
const BATTERY_MAX_CHARGE_W = Number(process.env.BATTERY_MAX_CHARGE_W ?? 3300);
const MORNING_MIN_SOC_PCT = 20;
const SLOT_DURATION_S = 3 * 3600;

interface WeatherProxyResponse {
  temperature: number[];
  precipitation: number[];
  weather: number[];
  windSpeed: number[];
  sunrise: string;
  sunset: string;
}

export interface ForecastSlot {
  timestamp: number;
  endTimestamp: number;
  temperatureC: number;
  precipitationMm: number;
  weatherMask: number;
  weatherDescription: string;
  cloudFactor: number;
  predictedProductionKwh: number;
  typicalConsumptionKwh: number;
  batteryChargeKwh: number;
  neighborExportKwh: number;
  batterySocStartPct: number;
  batterySocEndPct: number;
  isPast: boolean;
  clearSkyIrradianceWm2: number;
  predictedIrradianceWm2: number;
}

export interface ForecastResult {
  slots: ForecastSlot[];
  sunriseTs: number;
  sunsetTs: number;
  solarNoonTs: number;
  totalDayPredictedKwh: number;
  remainingPredictedKwh: number;
  currentSocPct: number;
  batteryCapacityKwh: number;
  pvPeakKw: number;
  /** Multiply irradiance (W/m²) by this to get estimated AC output power (W). */
  pvScalingFactor: number;
  neighborExportTargetW: number;
  meteoReadings: MeteoReading[];
}

/**
 * Clear-sky AC output (kWh) for one 3-hour slot, using POA transposition with
 * Bird & Hulstrom clear-sky GHI, Erbs decomposition, and isotropic sky model.
 * @param slotStartTs
 * @param efficiencyFrac
 */
function computeClearSkyKwh(
  slotStartTs: number,
  efficiencyFrac: number,
): number {
  const SAMPLES = 6;
  const sampleIntervalS = SLOT_DURATION_S / SAMPLES;
  let totalWh = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const sampleTs = slotStartTs + (i + 0.5) * sampleIntervalS;
    const date = new Date(sampleTs * 1000);
    const pos = suncalc.getPosition(date, DENGES_LAT, DENGES_LNG);
    const elevationDeg = (pos.altitude * 180) / Math.PI;
    if (elevationDeg <= 0.5) continue;
    const zenithDeg = 90 - elevationDeg;
    // suncalc azimuth: from south, westward positive → convert to from north, CW
    const solarAzimuthStdDeg = (pos.azimuth * 180) / Math.PI + 180;
    const ghi = clearSkyGhi(zenithDeg, date);
    const powerW = totalPredictedPower(
      ghi,
      zenithDeg,
      solarAzimuthStdDeg,
      efficiencyFrac * PV_EFFICIENCY,
      date,
    );
    totalWh += (powerW * sampleIntervalS) / 3600;
  }
  return totalWh / 1000;
}

/**
 * Average horizontal clear-sky GHI (W/m²) over a 3-hour slot (Bird & Hulstrom).
 * @param slotStartTs
 */
function computeClearSkyIrradianceWm2(slotStartTs: number): number {
  const SAMPLES = 6;
  const sampleIntervalS = SLOT_DURATION_S / SAMPLES;
  let total = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const sampleTs = slotStartTs + (i + 0.5) * sampleIntervalS;
    const date = new Date(sampleTs * 1000);
    const pos = suncalc.getPosition(date, DENGES_LAT, DENGES_LNG);
    const elevationDeg = (pos.altitude * 180) / Math.PI;
    if (elevationDeg <= 0) continue;
    const zenithDeg = 90 - elevationDeg;
    total += clearSkyGhi(zenithDeg, date);
  }
  return total / SAMPLES;
}

let cachedProxy: { data: WeatherProxyResponse; fetchedAt: number } | null =
  null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchWeatherProxy(): Promise<WeatherProxyResponse> {
  const now = Date.now();
  if (cachedProxy && now - cachedProxy.fetchedAt < CACHE_TTL_MS) {
    return cachedProxy.data;
  }
  const response = await fetch(WEATHER_PROXY_URL);
  if (!response.ok) {
    throw new Error(`Weather proxy error: ${response.status}`);
  }
  const data = (await response.json()) as WeatherProxyResponse;
  // eslint-disable-next-line require-atomic-updates -- intentional: concurrent fetches just cause an extra request, not corruption
  cachedProxy = { data, fetchedAt: now };
  return data;
}

export async function getForecast(
  currentSocPct: number,
): Promise<ForecastResult> {
  const panel = getPanelConfig();
  const [weather, allMeteoReadings] = await Promise.all([
    fetchWeatherProxy(),
    fetchStationReadings(),
  ]);

  const nowTs = Math.floor(Date.now() / 1000);
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  const sunTimes = getSunTimesForDate(todayMidnight);
  // Today's 8 slots always start at local midnight (00:00–03:00, …, 21:00–00:00)
  const todayMidnightTs = Math.floor(todayMidnight.getTime() / 1000);
  const todayEndTs = todayMidnightTs + 86_400;
  const meteoReadings = filterReadings(
    allMeteoReadings,
    todayMidnightTs,
    todayEndTs,
  );

  // Actual battery SOC from SolarWeb for today (used for past slots)
  const socRows = db
    .statement<{ timestamp: number; battery_soc_pct: number }>(
      `SELECT timestamp, battery_soc_pct
       FROM solarweb_readings
       WHERE timestamp BETWEEN ? AND ? AND battery_soc_pct IS NOT NULL AND battery_soc_pct > 0
       ORDER BY timestamp`,
    )
    .all(todayMidnightTs, nowTs);

  // Last known SOC at or before `ts` from SolarWeb history
  function socAtOrBefore(ts: number): number | null {
    let result: number | null = null;
    for (const r of socRows) {
      if (r.timestamp > ts) break;
      result = r.battery_soc_pct;
    }
    return result;
  }

  // Weather proxy covers 24 h from the current 3 h block
  const firstProxySlotTs =
    Math.floor(nowTs / SLOT_DURATION_S) * SLOT_DURATION_S;

  const typicalConsumptionKwh =
    (TYPICAL_CONSUMPTION_W * SLOT_DURATION_S) / 3_600_000;
  const batteryMaxChargeKwh =
    (BATTERY_MAX_CHARGE_W * SLOT_DURATION_S) / 3_600_000;
  const efficiencyFrac = panel.efficiencyPct / 100;

  let soc = currentSocPct;
  let totalDayPredictedKwh = 0;
  let remainingPredictedKwh = 0;

  const slots: ForecastSlot[] = Array.from({ length: 8 }, (_, i) => {
    const slotStartTs = todayMidnightTs + i * SLOT_DURATION_S;
    const slotEndTs = slotStartTs + SLOT_DURATION_S;
    const isPast = slotEndTs <= nowTs;

    // Map this midnight-aligned slot to the weather proxy index
    const proxyIndex = Math.round(
      (slotStartTs - firstProxySlotTs) / SLOT_DURATION_S,
    );
    const hasProxy = proxyIndex >= 0 && proxyIndex < weather.weather.length;
    const mask = hasProxy ? (weather.weather[proxyIndex] ?? 80) : 80;
    const temperature = hasProxy ? (weather.temperature[proxyIndex] ?? 15) : 15;
    const precipitation = hasProxy
      ? (weather.precipitation[proxyIndex] ?? 0)
      : 0;

    const cloudFactor = cloudFactorFromMask(mask);
    const clearSkyIrradianceWm2 = computeClearSkyIrradianceWm2(slotStartTs);
    const predictedProductionKwh =
      computeClearSkyKwh(slotStartTs, efficiencyFrac) * cloudFactor;
    const predictedIrradianceWm2 = clearSkyIrradianceWm2 * cloudFactor;

    totalDayPredictedKwh += predictedProductionKwh;
    if (!isPast) {
      remainingPredictedKwh += predictedProductionKwh;
    }

    // For past slots: show actual measured SOC from SolarWeb instead of simulating
    if (isPast) {
      const socAtStart = socAtOrBefore(slotStartTs) ?? soc;
      const socAtEnd = socAtOrBefore(slotEndTs - 1) ?? socAtStart;
      soc = socAtEnd;
      return {
        timestamp: slotStartTs,
        endTimestamp: slotEndTs,
        temperatureC: temperature,
        precipitationMm: precipitation,
        weatherMask: mask,
        weatherDescription: weatherDescription(mask),
        cloudFactor,
        predictedProductionKwh,
        typicalConsumptionKwh,
        batteryChargeKwh: 0,
        neighborExportKwh: 0,
        batterySocStartPct: socAtStart,
        batterySocEndPct: socAtEnd,
        isPast: true,
        clearSkyIrradianceWm2,
        predictedIrradianceWm2,
      };
    }

    // Future/current slot: simulate charging strategy
    const socAtStart = soc;
    const netAvailableKwh = Math.max(
      0,
      predictedProductionKwh - typicalConsumptionKwh,
    );
    const remainingCapacityKwh = Math.max(
      0,
      ((100 - soc) / 100) * BATTERY_CAPACITY_KWH,
    );

    let batteryChargeKwh = 0;
    let neighborExportKwh = 0;

    if (netAvailableKwh > 0) {
      if (remainingCapacityKwh > 0) {
        // "Cut the top": charge battery from any surplus, limiting grid injection
        batteryChargeKwh = Math.min(
          netAvailableKwh,
          batteryMaxChargeKwh,
          remainingCapacityKwh,
        );
        neighborExportKwh = Math.max(0, netAvailableKwh - batteryChargeKwh);
      } else {
        // Battery full: export all surplus
        neighborExportKwh = netAvailableKwh;
      }
    }

    soc = Math.min(100, soc + (batteryChargeKwh / BATTERY_CAPACITY_KWH) * 100);

    return {
      timestamp: slotStartTs,
      endTimestamp: slotEndTs,
      temperatureC: temperature,
      precipitationMm: precipitation,
      weatherMask: mask,
      weatherDescription: weatherDescription(mask),
      cloudFactor,
      predictedProductionKwh,
      typicalConsumptionKwh,
      batteryChargeKwh,
      neighborExportKwh,
      batterySocStartPct: socAtStart,
      batterySocEndPct: soc,
      isPast: false,
      clearSkyIrradianceWm2,
      predictedIrradianceWm2,
    };
  });

  return {
    slots,
    sunriseTs: sunTimes.sunrise,
    sunsetTs: sunTimes.sunset,
    solarNoonTs: sunTimes.solarNoon,
    totalDayPredictedKwh,
    remainingPredictedKwh,
    currentSocPct,
    batteryCapacityKwh: BATTERY_CAPACITY_KWH,
    pvPeakKw: panel.peakKw,
    pvScalingFactor: panel.scalingFactor,
    neighborExportTargetW: NEIGHBOR_EXPORT_TARGET_W,
    meteoReadings,
  };
}

export function computeChargingProfileFromReadings(
  hourlyReadings: Array<{
    bucket: number;
    production_w: number;
    battery_soc: number | null;
  }>,
  startSocPct: number,
): Array<{
  timestamp: number;
  productionW: number;
  batteryChargeW: number;
  neighborExportW: number;
  batterySocPct: number;
}> {
  const HOUR_S = 3600;
  const batteryMaxChargeKwh = (BATTERY_MAX_CHARGE_W * HOUR_S) / 3_600_000;
  const neighborTargetKwh = (NEIGHBOR_EXPORT_TARGET_W * HOUR_S) / 3_600_000;
  const typicalConsumptionKwhPerHour =
    (TYPICAL_CONSUMPTION_W * HOUR_S) / 3_600_000;

  let soc = startSocPct;

  const sunTimes = getSunTimesForDate(
    hourlyReadings[0] ? new Date(hourlyReadings[0].bucket * 1000) : new Date(),
  );

  return hourlyReadings.map((row) => {
    const productionKwh = (row.production_w * HOUR_S) / 3_600_000;
    const netAvailableKwh = Math.max(
      0,
      productionKwh - typicalConsumptionKwhPerHour,
    );
    const remainingCapacityKwh = Math.max(
      0,
      ((100 - soc) / 100) * BATTERY_CAPACITY_KWH,
    );

    let batteryChargeKwh = 0;
    let neighborExportKwh = 0;

    if (netAvailableKwh > 0) {
      const slotMidTs = row.bucket + HOUR_S / 2;
      const isMorning = slotMidTs < sunTimes.solarNoon;
      const needsMorningCharge = soc < MORNING_MIN_SOC_PCT && isMorning;

      if (needsMorningCharge) {
        batteryChargeKwh = Math.min(
          netAvailableKwh,
          batteryMaxChargeKwh,
          remainingCapacityKwh,
        );
        neighborExportKwh = Math.max(0, netAvailableKwh - batteryChargeKwh);
      } else {
        neighborExportKwh = Math.min(netAvailableKwh, neighborTargetKwh);
        const afterExportKwh = netAvailableKwh - neighborExportKwh;
        batteryChargeKwh = Math.min(
          afterExportKwh,
          batteryMaxChargeKwh,
          remainingCapacityKwh,
        );
        neighborExportKwh += Math.max(0, afterExportKwh - batteryChargeKwh);
      }
    }

    soc = Math.min(100, soc + (batteryChargeKwh / BATTERY_CAPACITY_KWH) * 100);

    return {
      timestamp: row.bucket,
      productionW: row.production_w,
      batteryChargeW: (batteryChargeKwh / HOUR_S) * 3_600_000,
      neighborExportW: (neighborExportKwh / HOUR_S) * 3_600_000,
      batterySocPct: soc,
    };
  });
}

export { type MeteoReading } from './meteoStationService.ts';
