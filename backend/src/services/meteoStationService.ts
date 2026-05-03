const STATION_CODES = ['pre', 'puy'];

function stationUrl(code: string): string {
  return `https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/${code}/ogd-smn_${code}_t.csv`;
}

function historicalStationUrl(code: string, year: number): string {
  return `https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/${code}/ogd-smn_${code}_${year}.csv`;
}

export interface MeteoReading {
  timestamp: number; // Unix seconds UTC
  station: string; // uppercase station code, e.g. 'PRE'
  temperatureC: number | null;
  globalRadiationWm2: number | null;
  humidityPct: number | null;
  precipitationMm: number | null;
  sunshineMin: number | null;
}

interface CachedResponse {
  readings: MeteoReading[];
  etag: string | null;
  fetchedAt: number;
}

const cacheByStation = new Map<string, CachedResponse>();
const CACHE_MAX_AGE_MS = 10 * 60 * 1000; // 10 min fallback

function parseTimestamp(timeStr: string): number | null {
  if (timeStr.length < 12) return null;
  const year = Number(timeStr.slice(0, 4));
  const month = Number(timeStr.slice(4, 6)) - 1;
  const day = Number(timeStr.slice(6, 8));
  const hour = Number(timeStr.slice(8, 10));
  const minute = Number(timeStr.slice(10, 12));
  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    Number.isNaN(hour) ||
    Number.isNaN(minute)
  ) {
    return null;
  }
  return Math.floor(Date.UTC(year, month, day, hour, minute) / 1000);
}

function parseNum(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '-' || trimmed === 'na') return null;
  const n = Number(trimmed);
  return Number.isNaN(n) ? null : n;
}

function parseCSV(text: string, stationCode: string): MeteoReading[] {
  const lines = text.split('\n');
  const headerIdx = lines.findIndex((l) => l.toLowerCase().includes('time;'));
  if (headerIdx === -1) return [];

  const headerLine = lines[headerIdx];
  if (!headerLine) return [];
  const headers = headerLine.split(';').map((h) => h.trim().toLowerCase());
  const timeCol = headers.indexOf('time');
  // Temperature: tre200s0 (2 m air temperature)
  const tempCol = headers.indexOf('tre200s0');
  // Global radiation: gre000z0 (W/m²)
  const radCol = headers.indexOf('gre000z0');
  // Relative humidity: ure200s0 (%)
  const humidityCol = headers.indexOf('ure200s0');
  // Precipitation: rre150z0 (mm per 10 min)
  const precipCol = headers.indexOf('rre150z0');
  // Sunshine duration: sre000z0 (min per 10 min)
  const sunshineCol = headers.indexOf('sre000z0');

  if (timeCol === -1) return [];

  const station = stationCode.toUpperCase();
  const readings: MeteoReading[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim() === '') continue;
    const cols = line.split(';');
    const timeStr = cols[timeCol]?.trim() ?? '';
    const ts = parseTimestamp(timeStr);
    if (ts === null) continue;

    readings.push({
      timestamp: ts,
      station,
      temperatureC: tempCol !== -1 ? parseNum(cols[tempCol] ?? '') : null,
      globalRadiationWm2: radCol !== -1 ? parseNum(cols[radCol] ?? '') : null,
      humidityPct:
        humidityCol !== -1 ? parseNum(cols[humidityCol] ?? '') : null,
      precipitationMm:
        precipCol !== -1 ? parseNum(cols[precipCol] ?? '') : null,
      sunshineMin:
        sunshineCol !== -1 ? parseNum(cols[sunshineCol] ?? '') : null,
    });
  }
  return readings;
}

async function fetchStation(
  code: string,
  now: number,
): Promise<MeteoReading[] | null> {
  const cache = cacheByStation.get(code);
  const headers: Record<string, string> = {};

  if (cache) {
    if (now - cache.fetchedAt < CACHE_MAX_AGE_MS) {
      return cache.readings;
    }
    if (cache.etag) {
      headers['If-None-Match'] = cache.etag;
    }
  }

  let response: Response;
  try {
    response = await fetch(stationUrl(code), { headers });
  } catch {
    return cache?.readings ?? null;
  }

  if (response.status === 304 && cache) {
    cache.fetchedAt = now;
    return cache.readings;
  }

  if (!response.ok) {
    return cache?.readings ?? null;
  }

  const text = await response.text();
  const readings = parseCSV(text, code);
  const etag = response.headers.get('etag');

  cacheByStation.set(code, { readings, etag, fetchedAt: now });
  return readings;
}

export async function fetchStationReadings(): Promise<MeteoReading[]> {
  const now = Date.now();
  /* eslint-disable no-await-in-loop -- tries stations sequentially, stops at first result */
  for (const code of STATION_CODES) {
    const readings = await fetchStation(code, now);
    if (readings && readings.length > 0) {
      return readings;
    }
  }
  /* eslint-enable no-await-in-loop */
  return [];
}

/**
 * Fetch a full year's worth of 10-minute readings from MeteoSwiss OGD for one station.
 * Returns an empty array if the year file is not yet available or the fetch fails.
 * @param stationCode - lowercase station code, e.g. 'pre'
 * @param year - four-digit year
 */
export async function fetchHistoricalStationReadings(
  stationCode: string,
  year: number,
): Promise<MeteoReading[]> {
  let response: Response;
  try {
    response = await fetch(historicalStationUrl(stationCode, year));
  } catch {
    return [];
  }
  if (!response.ok) return [];
  const text = await response.text();
  return parseCSV(text, stationCode);
}

/**
 * Filter readings to those that fall within [startTs, endTs) and have at least one non-null value.
 * @param readings
 * @param startTs
 * @param endTs
 */
export function filterReadings(
  readings: MeteoReading[],
  startTs: number,
  endTs: number,
): MeteoReading[] {
  return readings.filter(
    (r) =>
      r.timestamp >= startTs &&
      r.timestamp < endTs &&
      (r.temperatureC !== null ||
        r.globalRadiationWm2 !== null ||
        r.humidityPct !== null ||
        r.precipitationMm !== null ||
        r.sunshineMin !== null),
  );
}

export { STATION_CODES };
