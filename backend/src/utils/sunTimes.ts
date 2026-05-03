import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);

interface SunPosition {
  altitude: number; // radians above horizon (negative = below)
  azimuth: number; // radians from south, clockwise
}

interface RawSunTimes {
  sunrise: Date;
  sunset: Date;
  solarNoon: Date;
  dawn: Date;
  dusk: Date;
  nauticalDawn: Date;
  nauticalDusk: Date;
  goldenHour: Date;
  goldenHourEnd: Date;
  night: Date;
  nightEnd: Date;
  nadir: Date;
}

interface SunCalc {
  getTimes(date: Date, lat: number, lng: number): RawSunTimes;
  getPosition(date: Date, lat: number, lng: number): SunPosition;
}

const suncalc: SunCalc = _require('suncalc');

export const DENGES_LAT = 46.543;
export const DENGES_LNG = 6.51;

export interface SunTimes {
  sunrise: number; // Unix seconds
  sunset: number;
  solarNoon: number;
  dawn: number;
  dusk: number;
}

export function getSunTimesForDate(date: Date): SunTimes {
  const t = suncalc.getTimes(date, DENGES_LAT, DENGES_LNG);
  return {
    sunrise: Math.floor(t.sunrise.getTime() / 1000),
    sunset: Math.floor(t.sunset.getTime() / 1000),
    solarNoon: Math.floor(t.solarNoon.getTime() / 1000),
    dawn: Math.floor(t.dawn.getTime() / 1000),
    dusk: Math.floor(t.dusk.getTime() / 1000),
  };
}

export function getSunElevationRad(timestampS: number): number {
  const pos = suncalc.getPosition(
    new Date(timestampS * 1000),
    DENGES_LAT,
    DENGES_LNG,
  );
  return Math.max(0, pos.altitude);
}
