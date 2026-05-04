/* eslint-disable camelcase, @typescript-eslint/naming-convention -- DB fields use snake_case */
import { createRequire } from 'node:module';

import { db } from '../db/Database.ts';
import { DENGES_LAT, DENGES_LNG } from '../utils/sunTimes.ts';

const _require = createRequire(import.meta.url);

interface SunCalcPosition {
  altitude: number; // radians above horizon, negative = below
  azimuth: number; // radians from south, clockwise (west positive)
}

const suncalc: {
  getPosition(d: Date, lat: number, lng: number): SunCalcPosition;
} = _require('suncalc');

// Solar constant at 1 AU (W/m²)
const SOLAR_CONSTANT = 1361;
// Ground albedo for reflected irradiance component
const ALBEDO = 0.2;
// 10-minute weather interval in hours
const INTERVAL_HOURS = 10 / 60;

export interface PanelArray {
  name: string;
  azimuthDeg: number; // from north, clockwise
  tiltDeg: number; // from horizontal
  areaM2: number;
}

/**
 * Physical panel arrays at Denges.
 *   - East/West: 40 m² on shallow 10° pitch, ridge running north–south.
 *   - South: 6 m² vertical (90°) facade panels, full south.
 */
export const PANEL_ARRAYS: PanelArray[] = [
  { name: 'East', azimuthDeg: 90, tiltDeg: 10, areaM2: 20 },
  { name: 'West', azimuthDeg: 270, tiltDeg: 10, areaM2: 20 },
  { name: 'South', azimuthDeg: 180, tiltDeg: 90, areaM2: 6 },
];

export const TOTAL_AREA_M2 = PANEL_ARRAYS.reduce((s, a) => s + a.areaM2, 0);

/**
 * Kasten–Young (1989) air mass formula.
 * zenithDeg: solar zenith in degrees (0 = overhead).
 * @param zenithDeg
 */
function airMass(zenithDeg: number): number {
  if (zenithDeg >= 90) return Infinity;
  const zRad = (zenithDeg * Math.PI) / 180;
  return 1 / (Math.cos(zRad) + 0.50572 * (96.07995 - zenithDeg) ** -1.6364);
}

/**
 * Day-of-year extraterrestrial correction (Earth's elliptical orbit).
 * Returns the ratio E0 = (r_mean/r)² ≈ 1 ± 0.033.
 * @param date
 */
function extraterrestrialCorrection(date: Date): number {
  const dayOfYear =
    Math.floor(
      (date.getTime() - new Date(date.getUTCFullYear(), 0, 0).getTime()) /
        86_400_000,
    ) + 1;
  return 1 + 0.033 * Math.cos((2 * Math.PI * dayOfYear) / 365);
}

// Broadband atmospheric transmittance for Bird & Hulstrom (1981).
// The original paper uses 0.7 for "average" turbidity (Linke TL ≈ 3.5–4.0).
// For the Swiss plateau with clean Alpine air, TL is typically 2.0–2.5,
// which corresponds to a transmittance of ~0.80 and matches the empirical
// clear-sky production maxima recorded by the system.
const BIRD_TRANSMITTANCE = 0.8;

/**
 * Bird & Hulstrom (1981) simplified clear-sky GHI model.
 * Returns W/m² on a horizontal surface.
 * @param zenithDeg
 * @param date
 */
export function clearSkyGhi(zenithDeg: number, date: Date): number {
  if (zenithDeg >= 87) return 0; // avoid extreme air-mass values
  const am = airMass(zenithDeg);
  const cosZ = Math.cos((zenithDeg * Math.PI) / 180);
  const e0 = extraterrestrialCorrection(date);
  return SOLAR_CONSTANT * e0 * cosZ * BIRD_TRANSMITTANCE ** (am ** 0.678);
}

/**
 * Erbs et al. (1982) diffuse fraction model.
 * Decomposes measured GHI into DHI (diffuse) and DNI (direct normal).
 * Returns { dhi, dni } in W/m².
 * @param ghiWm2
 * @param zenithDeg
 * @param date
 */
export function erbsDecomposition(
  ghiWm2: number,
  zenithDeg: number,
  date: Date,
): { dhi: number; dni: number } {
  if (zenithDeg >= 90 || ghiWm2 <= 0) return { dhi: 0, dni: 0 };
  const cosZ = Math.cos((zenithDeg * Math.PI) / 180);
  const e0 = extraterrestrialCorrection(date);
  const extraterrestrial = SOLAR_CONSTANT * e0 * cosZ;
  const kt = Math.min(ghiWm2 / extraterrestrial, 1); // clearness index

  let kd: number; // diffuse fraction
  if (kt <= 0.22) {
    kd = 1 - 0.09 * kt;
  } else if (kt <= 0.8) {
    kd =
      0.9511 -
      0.1604 * kt +
      4.388 * kt ** 2 -
      16.638 * kt ** 3 +
      12.336 * kt ** 4;
  } else {
    kd = 0.165;
  }

  const dhi = Math.max(0, Math.min(kd * ghiWm2, ghiWm2));
  const dni = (ghiWm2 - dhi) / cosZ;
  return { dhi, dni };
}

/**
 * Isotropic sky transposition model (Liu & Jordan, 1961).
 * Converts horizontal irradiance to plane-of-array (POA) irradiance for one array.
 * All angles in radians.
 * @param ghi
 * @param dhi
 * @param dni
 * @param zenithRad
 * @param solarAzimuthRad
 * @param panelTiltRad
 * @param panelAzimuthRad
 */
function computePoa(
  ghi: number,
  dhi: number,
  dni: number,
  zenithRad: number,
  solarAzimuthRad: number, // from north, clockwise
  panelTiltRad: number,
  panelAzimuthRad: number, // from north, clockwise
): number {
  const cosIncidence =
    Math.cos(zenithRad) * Math.cos(panelTiltRad) +
    Math.sin(zenithRad) *
      Math.sin(panelTiltRad) *
      Math.cos(solarAzimuthRad - panelAzimuthRad);

  const direct = Math.max(0, cosIncidence) * dni;
  const skyDiffuse = (dhi * (1 + Math.cos(panelTiltRad))) / 2;
  const groundReflect = (ALBEDO * ghi * (1 - Math.cos(panelTiltRad))) / 2;
  return direct + skyDiffuse + groundReflect;
}

/**
 * Total predicted electrical power (W) across all panel arrays.
 * Uses measured GHI from MeteoSwiss + Erbs decomposition + isotropic transposition.
 * @param ghiWm2
 * @param zenithDeg
 * @param solarAzimuthStdDeg
 * @param efficiencyFrac
 * @param date
 */
export function totalPredictedPower(
  ghiWm2: number,
  zenithDeg: number,
  solarAzimuthStdDeg: number, // from north, clockwise
  efficiencyFrac: number,
  date: Date,
): number {
  const zenithRad = (zenithDeg * Math.PI) / 180;
  const solarAzimuthRad = (solarAzimuthStdDeg * Math.PI) / 180;
  const { dhi, dni } = erbsDecomposition(ghiWm2, zenithDeg, date);

  let totalW = 0;
  for (const array of PANEL_ARRAYS) {
    const tiltRad = (array.tiltDeg * Math.PI) / 180;
    const azimuthRad = (array.azimuthDeg * Math.PI) / 180;
    const poa = computePoa(
      ghiWm2,
      dhi,
      dni,
      zenithRad,
      solarAzimuthRad,
      tiltRad,
      azimuthRad,
    );
    totalW += poa * array.areaM2 * efficiencyFrac;
  }
  return totalW;
}

export interface DailyAnalysis {
  date: string;
  actual_kwh: number | null;
  predicted_kwh: number | null;
  clear_sky_kwh: number | null;
  ghi_kwh_per_m2: number | null;
  performance_ratio: number | null;
}

export interface MonthlyAnalysis {
  year_month: string;
  actual_kwh: number | null;
  predicted_kwh: number | null;
  clear_sky_kwh: number | null;
  avg_performance_ratio: number | null;
  capacity_factor: number | null;
}

export interface PanelConfig {
  efficiency_pct: number;
  performance_ratio: number;
  temp_coeff_pct_per_c: number;
  total_area_m2: number;
  peak_kw: number;
  arrays: PanelArray[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clearSkyDayKwh(dayStartMs: number, efficiency: number): number {
  let kwh = 0;
  for (let minOffset = 0; minOffset < 24 * 60; minOffset += 10) {
    const t = new Date(dayStartMs + minOffset * 60 * 1000);
    const pos = suncalc.getPosition(t, DENGES_LAT, DENGES_LNG);
    const elevationDeg = (pos.altitude * 180) / Math.PI;
    if (elevationDeg <= 0.5) continue;
    const zenithDeg = 90 - elevationDeg;
    const solarAzimuthStdDeg = (pos.azimuth * 180) / Math.PI + 180;
    const csGhi = clearSkyGhi(zenithDeg, t);
    kwh +=
      (totalPredictedPower(
        csGhi,
        zenithDeg,
        solarAzimuthStdDeg,
        efficiency,
        t,
      ) *
        INTERVAL_HOURS) /
      1000;
  }
  return kwh;
}

export function getPanelConfig(): PanelConfig {
  const efficiency_pct = Number(db.getSetting('panel_efficiency_pct') ?? 21);
  const performance_ratio = Number(
    db.getSetting('panel_performance_ratio') ?? 0.85,
  );
  const temp_coeff_pct_per_c = Number(
    db.getSetting('panel_temp_coeff_pct_per_c') ?? 0.4,
  );
  return {
    efficiency_pct,
    performance_ratio,
    temp_coeff_pct_per_c,
    total_area_m2: TOTAL_AREA_M2,
    peak_kw: (TOTAL_AREA_M2 * efficiency_pct) / 100,
    arrays: PANEL_ARRAYS,
  };
}

// NOCT (Nominal Operating Cell Temperature) for standard crystalline silicon panels.
const NOCT_C = 45;

/**
 * Compute daily comparison between MeteoSwiss-predicted production,
 * clear-sky theoretical maximum, and actual SolarWeb production.
 * @param fromTs
 * @param toTs
 */
export function computeDailyAnalysis(
  fromTs: number,
  toTs: number,
): DailyAnalysis[] {
  const efficiencyFrac =
    Number(db.getSetting('panel_efficiency_pct') ?? 21) / 100;
  const performanceRatio = Number(
    db.getSetting('panel_performance_ratio') ?? 0.85,
  );
  const tempCoeffPctPerC = Number(
    db.getSetting('panel_temp_coeff_pct_per_c') ?? 0.4,
  );

  // Actual production per day: SolarWeb 5-min readings (kWh = Σ production_w / 12 000)
  const actualRows = db
    .statement<{ date: string; actual_kwh: number }>(
      `SELECT
         date(timestamp, 'unixepoch') AS date,
         SUM(production_w) / 12000.0 AS actual_kwh
       FROM solarweb_readings
       WHERE timestamp BETWEEN ? AND ? AND production_w IS NOT NULL
       GROUP BY date
       ORDER BY date`,
    )
    .all(fromTs, toTs);

  const actualByDate = new Map(actualRows.map((r) => [r.date, r.actual_kwh]));

  // Clear-sky ceiling: computed purely from solar geometry for every date in range.
  // Independent of MeteoSwiss data → always continuous, always smooth.
  // Uses efficiency × PR at STC temperature — no measured temperature applied so
  // the curve is a clean seasonal bell and is never gapped by data outages.
  const clearSkyByDate = new Map<string, number>();
  const clearSkyEfficiency = efficiencyFrac * performanceRatio;

  for (let d = fromTs; d <= toTs; d += 86_400) {
    const dateStr = new Date(d * 1000).toISOString().slice(0, 10);
    const dayStartMs = Date.UTC(
      Number(dateStr.slice(0, 4)),
      Number(dateStr.slice(5, 7)) - 1,
      Number(dateStr.slice(8, 10)),
    );
    clearSkyByDate.set(
      dateStr,
      round2(clearSkyDayKwh(dayStartMs, clearSkyEfficiency)),
    );
  }

  // Weather readings for model (10-min MeteoSwiss GHI W/m² and ambient temperature °C)
  const weatherRows = db
    .statement<{
      timestamp: number;
      global_radiation_w: number | null;
      temperature_c: number | null;
    }>(
      `SELECT timestamp, global_radiation_w, temperature_c
       FROM weather_readings
       WHERE timestamp BETWEEN ? AND ?
       ORDER BY timestamp`,
    )
    .all(fromTs, toTs);

  // Accumulate MeteoSwiss-driven predicted energy by date
  const predByDate = new Map<string, { predicted: number; ghi: number }>();

  for (const row of weatherRows) {
    if (row.global_radiation_w === null) continue;

    const date = new Date(row.timestamp * 1000);
    const dateStr = date.toISOString().slice(0, 10);

    const pos = suncalc.getPosition(date, DENGES_LAT, DENGES_LNG);
    const elevationDeg = (pos.altitude * 180) / Math.PI;
    if (elevationDeg <= 0.5) continue;

    const zenithDeg = 90 - elevationDeg;
    const solarAzimuthStdDeg = (pos.azimuth * 180) / Math.PI + 180;

    const ghi = Math.max(0, row.global_radiation_w);

    // NOCT cell temperature model: T_cell = T_ambient + (GHI/800) × (NOCT − 20)
    const ambientTempC = row.temperature_c ?? 20;
    const cellTempC = ambientTempC + (ghi / 800) * (NOCT_C - 20);
    const tempDerate = Math.max(
      0,
      1 - (tempCoeffPctPerC / 100) * Math.max(0, cellTempC - 25),
    );
    const effectiveEfficiency = efficiencyFrac * tempDerate * performanceRatio;

    const predictedW = totalPredictedPower(
      ghi,
      zenithDeg,
      solarAzimuthStdDeg,
      effectiveEfficiency,
      date,
    );

    const existing = predByDate.get(dateStr) ?? { predicted: 0, ghi: 0 };
    predByDate.set(dateStr, {
      predicted: existing.predicted + (predictedW * INTERVAL_HOURS) / 1000,
      ghi: existing.ghi + (ghi * INTERVAL_HOURS) / 1000,
    });
  }

  // Merge all sources over every date in the range (clear-sky covers them all)
  const allDates = new Set([
    ...clearSkyByDate.keys(),
    ...actualByDate.keys(),
    ...predByDate.keys(),
  ]);
  const result: DailyAnalysis[] = [];

  for (const date of [...allDates].toSorted()) {
    const actual = actualByDate.get(date) ?? null;
    const pred = predByDate.get(date);

    const predicted_kwh = pred ? round2(pred.predicted) : null;
    const clear_sky_kwh = clearSkyByDate.get(date) ?? null;
    const ghi_kwh_per_m2 = pred ? round2(pred.ghi) : null;

    const performance_ratio =
      actual !== null && predicted_kwh !== null && predicted_kwh > 0.05
        ? round2(actual / predicted_kwh)
        : null;

    result.push({
      date,
      actual_kwh: actual !== null ? round2(actual) : null,
      predicted_kwh,
      clear_sky_kwh,
      ghi_kwh_per_m2,
      performance_ratio,
    });
  }

  return result;
}

export interface WeeklyEnvelopePoint {
  week: number;
  max_kwh: number;
  best_date: string;
  clear_sky_kwh: number;
}

/**
 * For each calendar week 1–52, find the single best daily production
 * across ALL years of SolarWeb data.
 * Clear-sky days cluster near the top; cloudy days are ignored because
 * we take the maximum, not the mean.
 */
export function computeWeeklyEnvelope(): WeeklyEnvelopePoint[] {
  const dailyRows = db
    .statement<{ date: string; actual_kwh: number }>(
      `SELECT
         date(timestamp, 'unixepoch') AS date,
         SUM(production_w) / 12000.0 AS actual_kwh
       FROM solarweb_readings
       WHERE production_w IS NOT NULL
       GROUP BY date
       HAVING actual_kwh > 0.5
       ORDER BY date`,
    )
    .all();

  const weekMap = new Map<number, { max_kwh: number; best_date: string }>();

  for (const row of dailyRows) {
    const d = new Date(`${row.date}T12:00:00Z`);
    const year = d.getUTCFullYear();
    const dayOfYear =
      Math.floor((d.getTime() - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
    const week = Math.min(52, Math.ceil(dayOfYear / 7));

    const current = weekMap.get(week);
    if (!current || row.actual_kwh > current.max_kwh) {
      weekMap.set(week, { max_kwh: row.actual_kwh, best_date: row.date });
    }
  }

  const efficiencyFrac =
    Number(db.getSetting('panel_efficiency_pct') ?? 21) / 100;
  const performanceRatio = Number(
    db.getSetting('panel_performance_ratio') ?? 0.85,
  );
  const clearSkyEfficiency = efficiencyFrac * performanceRatio;

  return Array.from({ length: 52 }, (_, i) => i + 1).map((week) => {
    const entry = weekMap.get(week);
    // Use the midpoint day of each week in reference year 2024 for a stable clear-sky curve
    const midDayOfYear = (week - 1) * 7 + 4;
    const refDayStartMs = Date.UTC(2024, 0, midDayOfYear);
    return {
      week,
      max_kwh: entry ? round2(entry.max_kwh) : 0,
      best_date: entry?.best_date ?? '',
      clear_sky_kwh: round2(clearSkyDayKwh(refDayStartMs, clearSkyEfficiency)),
    };
  });
}

/**
 * Aggregate daily analysis into monthly summaries.
 * @param daily
 */
export function aggregateMonthly(daily: DailyAnalysis[]): MonthlyAnalysis[] {
  const byMonth = new Map<
    string,
    {
      actual: number;
      predicted: number;
      clearSky: number;
      prSum: number;
      prCount: number;
    }
  >();

  for (const d of daily) {
    const ym = d.date.slice(0, 7);
    const m = byMonth.get(ym) ?? {
      actual: 0,
      predicted: 0,
      clearSky: 0,
      prSum: 0,
      prCount: 0,
    };
    if (d.actual_kwh !== null) m.actual += d.actual_kwh;
    if (d.predicted_kwh !== null) m.predicted += d.predicted_kwh;
    if (d.clear_sky_kwh !== null) m.clearSky += d.clear_sky_kwh;
    if (d.performance_ratio !== null) {
      m.prSum += d.performance_ratio;
      m.prCount++;
    }
    byMonth.set(ym, m);
  }

  return [...byMonth.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([ym, m]) => ({
      year_month: ym,
      actual_kwh: Math.round(m.actual * 10) / 10,
      predicted_kwh: Math.round(m.predicted * 10) / 10,
      clear_sky_kwh: Math.round(m.clearSky * 10) / 10,
      avg_performance_ratio: m.prCount > 0 ? round2(m.prSum / m.prCount) : null,
      capacity_factor: m.clearSky > 0 ? round2(m.actual / m.clearSky) : null,
    }));
}
