// PUY (Pully, near Lausanne) is tried first — it has full climate data including
// radiation and temperature. PRE (Pregny) is wind-only and carries no radiation data.
const STATION_CODES = ['puy', 'pre'];

function stationNowUrl(code: string): string {
  return `https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/${code}/ogd-smn_${code}_t_now.csv`;
}

function stationRecentUrl(code: string): string {
  return `https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/${code}/ogd-smn_${code}_t_recent.csv`;
}

function stationHistoricalUrl(code: string, decadeStart: number): string {
  return `https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/${code}/ogd-smn_${code}_t_historical_${decadeStart}-${decadeStart + 9}.csv`;
}

export interface MeteoReading {
  timestamp: number; // Unix seconds UTC
  station: string; // uppercase station code, e.g. 'PAY'
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
const CACHE_MAX_AGE_MS = 10 * 60 * 1000;

// Parses "DD.MM.YYYY HH:MM" → Unix seconds UTC
function parseTimestamp(timeStr: string): number | null {
  const match =
    /^(?<day>\d{2})\.(?<month>\d{2})\.(?<year>\d{4}) (?<hour>\d{2}):(?<minute>\d{2})$/.exec(
      timeStr.trim(),
    );
  if (!match?.groups) return null;
  const { day, month, year, hour, minute } = match.groups;
  return Math.floor(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
    ) / 1000,
  );
}

function parseNum(raw: string): number | null {
  const trimmed = raw.trim();
  if (['', '-', 'na'].includes(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isNaN(n) ? null : n;
}

function parseCSV(text: string): MeteoReading[] {
  const lines = text.split('\n');
  const headerIdx = lines.findIndex((l) =>
    l.toLowerCase().includes('reference_timestamp'),
  );
  if (headerIdx === -1) return [];

  const headerLine = lines[headerIdx];
  if (!headerLine) return [];
  const headers = headerLine.split(';').map((h) => h.trim().toLowerCase());

  const tsCol = headers.indexOf('reference_timestamp');
  const stationCol = headers.indexOf('station_abbr');
  const tempCol = headers.indexOf('tre200s0');
  const radCol = headers.indexOf('gre000z0');
  const humidityCol = headers.indexOf('ure200s0');
  const precipCol = headers.indexOf('rre150z0');
  const sunshineCol = headers.indexOf('sre000z0');

  if (tsCol === -1) return [];

  const readings: MeteoReading[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim() === '') continue;
    const cols = line.split(';');
    const tsStr = cols[tsCol]?.trim() ?? '';
    const ts = parseTimestamp(tsStr);
    if (ts === null) continue;

    const station =
      stationCol !== -1
        ? (cols[stationCol]?.trim().toUpperCase() ?? 'UNKNOWN')
        : 'UNKNOWN';

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

async function fetchCsv(
  url: string,
  headers: Record<string, string> = {},
): Promise<Response | null> {
  try {
    return await fetch(url, { headers });
  } catch {
    return null;
  }
}

async function fetchStation(
  code: string,
  now: number,
): Promise<MeteoReading[] | null> {
  const cache = cacheByStation.get(code);
  const headers: Record<string, string> = {};

  if (cache) {
    if (now - cache.fetchedAt < CACHE_MAX_AGE_MS) return cache.readings;
    if (cache.etag) headers['If-None-Match'] = cache.etag;
  }

  const response = await fetchCsv(stationNowUrl(code), headers);
  if (!response) return cache?.readings ?? null;

  if (response.status === 304 && cache) {
    cache.fetchedAt = now;
    return cache.readings;
  }

  if (!response.ok) return cache?.readings ?? null;

  const text = await response.text();
  const readings = parseCSV(text);
  const etag = response.headers.get('etag');

  cacheByStation.set(code, { readings, etag, fetchedAt: now });
  return readings;
}

/**
 * Returns true if the readings contain at least some temperature or radiation values.
 * @param readings
 */
export function hasClimateData(readings: MeteoReading[]): boolean {
  return readings.some(
    (r) => r.temperatureC !== null || r.globalRadiationWm2 !== null,
  );
}

export async function fetchStationReadings(): Promise<MeteoReading[]> {
  const now = Date.now();
  /* eslint-disable no-await-in-loop -- tries stations sequentially, stops at first useful result */
  for (const code of STATION_CODES) {
    const readings = await fetchStation(code, now);
    if (readings && hasClimateData(readings)) return readings;
  }
  /* eslint-enable no-await-in-loop */
  return [];
}

export async function fetchRecentStationReadings(
  code: string,
): Promise<MeteoReading[]> {
  const response = await fetchCsv(stationRecentUrl(code));
  if (!response?.ok) return [];
  const text = await response.text();
  return parseCSV(text);
}

/**
 * Fetch one decade of 10-minute readings from MeteoSwiss OGD for one station.
 * @param stationCode - lowercase station code, e.g. 'pay'
 * @param decadeStart - first year of the decade, e.g. 2020 for 2020-2029
 */
export async function fetchHistoricalStationReadings(
  stationCode: string,
  decadeStart: number,
): Promise<MeteoReading[]> {
  const response = await fetchCsv(
    stationHistoricalUrl(stationCode, decadeStart),
  );
  if (!response?.ok) return [];
  const text = await response.text();
  return parseCSV(text);
}

/**
 * Filter readings to those within [startTs, endTs) with at least one non-null value.
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
