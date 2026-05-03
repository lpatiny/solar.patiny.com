/* eslint-disable camelcase, @typescript-eslint/naming-convention -- API response fields use snake_case */
import { db } from '../db/Database.ts';

const PV_SYSTEM_ID = process.env.SOLARWEB_PV_SYSTEM_ID;
const USERNAME = process.env.SOLARWEB_USERNAME;
const PASSWORD = process.env.SOLARWEB_PASSWORD;
const HISTORY_START = process.env.SOLARWEB_HISTORY_START;

// ─── Cookie jar ───────────────────────────────────────────────────────────────

type CookieJar = Map<string, string>;

function parseCookies(headers: Headers): CookieJar {
  const jar: CookieJar = new Map();
  const raw = headers.getSetCookie?.() ?? [];
  for (const cookie of raw) {
    const [pair] = cookie.split(';');
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return jar;
}

function mergeCookies(base: CookieJar, incoming: CookieJar): CookieJar {
  const merged = new Map(base);
  for (const [k, v] of incoming) merged.set(k, v);
  return merged;
}

function cookieHeader(jar: CookieJar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

// ─── Login ────────────────────────────────────────────────────────────────────

// Cache the session cookie so we don't log in on every request
let sessionJar: CookieJar | null = null;

async function fetchWithCookies(
  url: string,
  options: RequestInit & { jar: CookieJar },
): Promise<{ res: Response; jar: CookieJar }> {
  const headers = new Headers(options.headers);
  if (options.jar.size > 0) headers.set('Cookie', cookieHeader(options.jar));

  const res = await fetch(url, {
    ...options,
    headers,
    redirect: 'manual',
  });

  const incoming = parseCookies(res.headers);
  const jar = mergeCookies(options.jar, incoming);
  return { res, jar };
}

async function login(): Promise<CookieJar> {
  let jar: CookieJar = new Map();

  // Step 1: kick off OIDC flow — solarweb.com redirects to login.fronius.com
  const { res: r1, jar: j1 } = await fetchWithCookies(
    'https://www.solarweb.com/Account/ExternalLogin',
    { jar },
  );
  jar = j1;

  const froniusUrl = r1.headers.get('location') ?? '';
  if (!froniusUrl) throw new Error('No redirect from ExternalLogin');

  // Step 2: GET the Fronius login page to get sessionDataKey
  const { res: r2, jar: j2 } = await fetchWithCookies(froniusUrl, { jar });
  jar = j2;

  const loginPageUrl = r2.headers.get('location') ?? froniusUrl;
  // sessionDataKey might be in the URL already or after a further redirect
  let sessionDataKey = new URL(loginPageUrl).searchParams.get('sessionDataKey');

  if (!sessionDataKey) {
    // Follow one more redirect if needed
    const { res: r2b, jar: j2b } = await fetchWithCookies(loginPageUrl, {
      jar,
    });
    jar = j2b;
    const finalUrl = r2b.headers.get('location') ?? loginPageUrl;
    sessionDataKey = new URL(finalUrl).searchParams.get('sessionDataKey');
    if (!sessionDataKey) {
      const body = await r2b.text();
      const match = /sessionDataKey=(?<key>[^&"]+)/.exec(body);
      sessionDataKey = match?.groups?.key ?? null;
    }
  }

  if (!sessionDataKey) {
    throw new Error('Could not extract sessionDataKey from Fronius login');
  }

  // Step 3: POST credentials to Fronius commonauth
  const body = new URLSearchParams({
    username: USERNAME ?? '',
    password: PASSWORD ?? '',
    sessionDataKey,
    chkRemember: 'on',
  });
  const { res: r3, jar: j3 } = await fetchWithCookies(
    'https://login.fronius.com/commonauth',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      jar,
    },
  );
  jar = j3;

  if (r3.status !== 302) {
    throw new Error(`Fronius auth failed: HTTP ${r3.status}`);
  }

  // Step 4: follow redirect chain back to solarweb.com
  let next = r3.headers.get('location') ?? '';
  /* eslint-disable no-await-in-loop -- sequential redirect chain, cannot be parallelised */
  for (let i = 0; i < 6 && next; i++) {
    const url = next.startsWith('http')
      ? next
      : `https://login.fronius.com${next}`;
    const { res, jar: j } = await fetchWithCookies(url, { method: 'GET', jar });
    jar = j;
    next = res.headers.get('location') ?? '';
    if (url.includes('solarweb.com') && res.status === 200) break;
    if (
      url.includes('solarweb.com') &&
      res.status !== 302 && // POST form_post OIDC response (code + id_token in body)
      res.headers.get('content-type')?.includes('html')
    ) {
      const html = await res.text();
      const form = /action="(?<action>[^"]+)"/.exec(html);
      const inputs: Record<string, string> = {};
      for (const m of html.matchAll(
        /name="(?<name>[^"]+)"[^>]*value="(?<value>[^"]*)"/g,
      )) {
        if (m.groups?.name) inputs[m.groups.name] = m.groups.value ?? '';
      }
      if (form?.groups?.action) {
        const formBody = new URLSearchParams(inputs);
        const { res: postRes, jar: postJar } = await fetchWithCookies(
          form.groups.action,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formBody.toString(),
            jar,
          },
        );
        jar = postJar;
        next = postRes.headers.get('location') ?? '';
      }
    }
  }
  /* eslint-enable no-await-in-loop */

  if (!jar.has('.ASPXAUTH') && !jar.has('solarweb') && jar.size < 2) {
    throw new Error('Login succeeded but no session cookie received');
  }
  return jar;
}

async function getSessionJar(): Promise<CookieJar> {
  // eslint-disable-next-line require-atomic-updates
  if (!sessionJar) sessionJar = await login();
  return sessionJar;
}

// ─── Chart data fetching ──────────────────────────────────────────────────────

interface SolarWebChartResponse {
  settings?: unknown;
  chartData?: {
    series?: Array<{
      data?: Array<[number, number]>;
      name?: string;
    }>;
  };
  // Some responses use a flat structure
  feedinEnergy?: number;
  gridEnergy?: number;
  consumedEnergy?: number;
  producedEnergy?: number;
}

async function fetchView(
  jar: CookieJar,
  year: number,
  month: number,
  day: number,
  view: string,
): Promise<number> {
  const url = `https://www.solarweb.com/Chart/GetChartNew?pvSystemId=${PV_SYSTEM_ID}&year=${year}&month=${month}&day=${day}&interval=day&view=${view}&_=${Date.now()}`;
  const res = await fetch(url, {
    headers: { Cookie: cookieHeader(jar) },
  });

  if (res.status === 401 || res.status === 302) {
    sessionJar = null;
    throw new Error('Session expired');
  }
  if (!res.ok) throw new Error(`Chart fetch failed: ${res.status} for ${view}`);

  const json = (await res.json()) as SolarWebChartResponse;

  // Try flat fields first
  if (view === 'production' && json.producedEnergy !== undefined) {
    return json.producedEnergy / 1000;
  }
  if (view === 'feedin' && json.feedinEnergy !== undefined) {
    return json.feedinEnergy / 1000;
  }
  if (view === 'consumption' && json.consumedEnergy !== undefined) {
    return json.consumedEnergy / 1000;
  }
  if (view === 'grid' && json.gridEnergy !== undefined) {
    return json.gridEnergy / 1000;
  }

  // Fall back to summing series data points (Wh → kWh)
  const series = json.chartData?.series ?? [];
  let total = 0;
  for (const s of series) {
    for (const [, v] of s.data ?? []) total += v;
  }
  return total / 1000;
}

async function syncDay(date: string): Promise<void> {
  const [year, month, day] = date.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const jar = await getSessionJar();

  const [production_kwh, export_kwh, import_kwh] = await Promise.all([
    fetchView(jar, year, month, day, 'production'),
    fetchView(jar, year, month, day, 'feedin'),
    fetchView(jar, year, month, day, 'grid'),
  ]);

  const self_consumption_kwh = Math.max(0, production_kwh - export_kwh);
  db.upsertDailyStats(
    date,
    production_kwh,
    export_kwh,
    import_kwh,
    self_consumption_kwh,
  );
}

export async function scrapeAllHistory(): Promise<{
  synced: number;
  errors: number;
  startDate: string;
}> {
  if (!PV_SYSTEM_ID || !USERNAME || !PASSWORD) {
    return { synced: 0, errors: 0, startDate: '' };
  }

  const startDate =
    HISTORY_START ??
    new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
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
      // Reset session on auth errors so next iteration re-logs in
      if (!sessionJar) await login().catch(() => null);
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 500);
    });
  }
  /* eslint-enable no-await-in-loop */

  return { synced, errors, startDate };
}
