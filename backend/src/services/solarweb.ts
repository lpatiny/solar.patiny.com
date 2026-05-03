/* eslint-disable camelcase, @typescript-eslint/naming-convention -- SolarWeb API fields use snake_case */

const BASE_URL = 'https://api.solarweb.com/swqapi';
const PV_SYSTEM_ID = process.env.SOLARWEB_PV_SYSTEM_ID;

// Auth option 1: API access keys (generated in SolarWeb → System settings)
const ACCESS_KEY_ID = process.env.SOLARWEB_ACCESS_KEY_ID;
const ACCESS_KEY_VALUE = process.env.SOLARWEB_ACCESS_KEY_VALUE;

// Auth option 2: SolarWeb account username + password (uses undocumented OAuth endpoint)
const USERNAME = process.env.SOLARWEB_USERNAME;
const PASSWORD = process.env.SOLARWEB_PASSWORD;

// History sync start date — defaults to system commissioning date fetched from API.
// Override with SOLARWEB_HISTORY_START=YYYY-MM-DD to start from a specific date.
const HISTORY_START = process.env.SOLARWEB_HISTORY_START;

interface SolarWebDayData {
  Data: {
    EnergyProduction?: { Values: Record<string, number> };
    EnergyFeedIn?: { Values: Record<string, number> };
    EnergyGrid?: { Values: Record<string, number> };
    EnergyConsumption?: { Values: Record<string, number> };
  };
}

interface PvSystemInfo {
  pvSystemId: string;
  name: string;
  address: {
    country: string;
  };
  installationDate?: string;
  commissioningDate?: string;
}

// ─── OAuth token cache (username/password flow) ───────────────────────────────

let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getOAuthToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await fetch('https://api.solarweb.com/swqapi/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      username: USERNAME ?? '',
      password: PASSWORD ?? '',
      client_id: 'swqapi',
    }),
  });

  if (!res.ok) {
    throw new Error(`SolarWeb OAuth failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  const token = json.access_token;
  // eslint-disable-next-line require-atomic-updates
  cachedToken = token;
  // eslint-disable-next-line require-atomic-updates
  tokenExpiry = Date.now() + (json.expires_in - 60) * 1000;
  return token;
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function isConfiguredWithKeys(): boolean {
  return Boolean(ACCESS_KEY_ID && ACCESS_KEY_VALUE && PV_SYSTEM_ID);
}

function isConfiguredWithPassword(): boolean {
  return Boolean(USERNAME && PASSWORD && PV_SYSTEM_ID);
}

export function isConfigured(): boolean {
  return isConfiguredWithKeys() || isConfiguredWithPassword();
}

async function authHeaders(): Promise<Record<string, string>> {
  if (isConfiguredWithKeys() && ACCESS_KEY_ID && ACCESS_KEY_VALUE) {
    return {
      AccessKeyId: ACCESS_KEY_ID,
      AccessKeyValue: ACCESS_KEY_VALUE,
    };
  }
  const token = await getOAuthToken();
  return { Authorization: `Bearer ${token}` };
}

// ─── API calls ────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  if (!res.ok) {
    throw new Error(`SolarWeb API ${res.status}: ${path}`);
  }
  return res.json() as Promise<T>;
}

async function getSystemInfo(): Promise<PvSystemInfo | null> {
  if (!PV_SYSTEM_ID || !isConfigured()) return null;
  return apiFetch<PvSystemInfo>(`/pvsystems/${PV_SYSTEM_ID}`);
}

async function fetchDayData(date: string): Promise<SolarWebDayData | null> {
  if (!PV_SYSTEM_ID || !isConfigured()) return null;
  return apiFetch<SolarWebDayData>(
    `/pvsystems/${PV_SYSTEM_ID}/histdata/day/${date}`,
  );
}

// ─── Sync functions ───────────────────────────────────────────────────────────

export async function syncDay(date: string): Promise<void> {
  // api.solarweb.com is not accessible for most deployments; this is a no-op stub.
  // Historical data is scraped via solarwebScraper.ts instead.
  await fetchDayData(date);
}

export async function syncRecentDays(): Promise<void> {
  if (!isConfigured()) return;

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10);

  await Promise.allSettled([syncDay(yesterday), syncDay(today)]);
}

export async function syncAllHistory(): Promise<{
  synced: number;
  errors: number;
  startDate: string;
}> {
  if (!isConfigured()) {
    return { synced: 0, errors: 0, startDate: '' };
  }

  // Determine start date: env override → commissioning date from API → 1 year ago
  let startDate = HISTORY_START ?? null;
  if (!startDate) {
    const info = await getSystemInfo().catch(() => null);
    startDate =
      info?.commissioningDate?.slice(0, 10) ??
      info?.installationDate?.slice(0, 10) ??
      null;
  }
  if (!startDate) {
    // Fallback: 1 year ago
    startDate = new Date(Date.now() - 365 * 86_400_000)
      .toISOString()
      .slice(0, 10);
  }

  const today = new Date().toISOString().slice(0, 10);
  const dates: string[] = [];
  let cursor = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${today}T12:00:00Z`);

  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }

  let synced = 0;
  let errors = 0;

  /* eslint-disable no-await-in-loop -- sequential to avoid rate-limiting */
  for (const date of dates) {
    try {
      await syncDay(date);
      synced++;
    } catch {
      errors++;
    }
    // SolarWeb rate limit: ~1 req/s
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 1100);
    });
  }
  /* eslint-enable no-await-in-loop */

  return { synced, errors, startDate };
}
