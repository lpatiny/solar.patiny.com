/* eslint-disable camelcase -- API response fields use snake_case */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { db } from '../db/Database.ts';
import type { SolarwebReadingRow } from '../db/rows.ts';

// ─── Sync progress (readable by the status endpoint) ─────────────────────────

export interface SyncProgress {
  running: boolean;
  currentDate: string | null;
  synced: number;
  errors: number;
  total: number;
  startDate: string;
}

let progress: SyncProgress = {
  running: false,
  currentDate: null,
  synced: 0,
  errors: 0,
  total: 0,
  startDate: '',
};

/** Returns a snapshot of the current history-sync progress. */
export function getSyncProgress(): SyncProgress {
  return { ...progress };
}

const PV_SYSTEM_ID = process.env.SOLARWEB_PV_SYSTEM_ID;
const USERNAME = process.env.SOLARWEB_USERNAME;
const PASSWORD = process.env.SOLARWEB_PASSWORD;
const HISTORY_START = process.env.SOLARWEB_HISTORY_START;

const DEBUG = process.env.SOLARWEB_DEBUG === 'true';

function dbg(msg: string) {
  if (DEBUG) process.stderr.write(`[solarweb] ${msg}\n`);
}

const SESSION_PATH = join(
  import.meta.dirname,
  '../../../data/solarweb-session.json',
);

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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
let lastLoginError: string | null = null;

export interface SessionStatus {
  hasSession: boolean;
  cookieKeys: string[];
  lastError: string | null;
  savedAt: string | null;
}

/** Returns the current SolarWeb session status without triggering a login. */
export function getSessionStatus(): SessionStatus {
  const jar = sessionJar ?? loadSession();
  const hasSession =
    jar !== null && (jar.has('.ASPXAUTH') || jar.has('.AspNet.Auth'));

  let savedAt: string | null = null;
  try {
    if (existsSync(SESSION_PATH)) {
      savedAt = statSync(SESSION_PATH).mtime.toISOString();
    }
  } catch {
    /* non-critical */
  }

  return {
    hasSession,
    cookieKeys: jar ? [...jar.keys()] : [],
    lastError: lastLoginError,
    savedAt,
  };
}

/**
 * Import a SolarWeb session from a raw `document.cookie` string pasted by the
 * user after manually logging in to solarweb.com in their browser.
 * Throws if the required session cookie is not present.
 * @param rawCookieHeader
 */
export function importSession(rawCookieHeader: string): void {
  const jar: CookieJar = new Map();
  for (const part of rawCookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key) jar.set(key, val);
  }
  if (!jar.has('.ASPXAUTH') && !jar.has('.AspNet.Auth')) {
    throw new Error(
      `No SolarWeb session cookie found in pasted string. Got: ${[...jar.keys()].join(', ')}`,
    );
  }
  sessionJar = jar;
  lastLoginError = null;
  saveSession(jar);
}

function saveSession(jar: CookieJar): void {
  try {
    mkdirSync(dirname(SESSION_PATH), { recursive: true });
    writeFileSync(
      SESSION_PATH,
      JSON.stringify(Object.fromEntries(jar)),
      'utf8',
    );
  } catch {
    // non-critical — in-memory session is still usable
  }
}

function loadSession(): CookieJar | null {
  try {
    if (!existsSync(SESSION_PATH)) return null;
    const raw = JSON.parse(readFileSync(SESSION_PATH, 'utf8')) as Record<
      string,
      string
    >;
    return new Map(Object.entries(raw));
  } catch {
    return null;
  }
}

async function fetchWithCookies(
  url: string,
  options: RequestInit & { jar: CookieJar },
): Promise<{ res: Response; jar: CookieJar }> {
  const headers = new Headers(options.headers);
  headers.set('User-Agent', USER_AGENT);
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
  dbg('Step 1: GET /Account/ExternalLogin');
  const { res: r1, jar: j1 } = await fetchWithCookies(
    'https://www.solarweb.com/Account/ExternalLogin',
    { jar },
  );
  jar = j1;
  dbg(
    `  → HTTP ${r1.status}, Location: ${r1.headers.get('location') ?? '(none)'}, cookies: ${jar.size}`,
  );

  const froniusUrl = r1.headers.get('location') ?? '';
  if (!froniusUrl) throw new Error('No redirect from ExternalLogin');

  // Step 2: GET the Fronius login page to get sessionDataKey
  dbg(`Step 2: GET ${froniusUrl.slice(0, 80)}`);
  const { res: r2, jar: j2 } = await fetchWithCookies(froniusUrl, { jar });
  jar = j2;

  const loginPageUrl = r2.headers.get('location') ?? froniusUrl;
  dbg(
    `  → HTTP ${r2.status}, Location: ${loginPageUrl.slice(0, 80)}, cookies: ${jar.size}`,
  );

  // sessionDataKey might be in the URL already or after a further redirect
  let sessionDataKey = new URL(loginPageUrl).searchParams.get('sessionDataKey');
  dbg(`  sessionDataKey from URL: ${sessionDataKey ? 'found' : 'not found'}`);

  if (!sessionDataKey) {
    // Follow one more redirect if needed
    dbg(`Step 2b: GET ${loginPageUrl.slice(0, 80)}`);
    const { res: r2b, jar: j2b } = await fetchWithCookies(loginPageUrl, {
      jar,
    });
    jar = j2b;
    const finalUrl = r2b.headers.get('location') ?? loginPageUrl;
    dbg(`  → HTTP ${r2b.status}, Location: ${finalUrl.slice(0, 80)}`);
    sessionDataKey = new URL(finalUrl).searchParams.get('sessionDataKey');
    if (!sessionDataKey) {
      const body = await r2b.text();
      const match = /sessionDataKey=(?<key>[^&"]+)/.exec(body);
      sessionDataKey = match?.groups?.key ?? null;
      dbg(
        `  sessionDataKey from body: ${sessionDataKey ? 'found' : 'NOT FOUND'}`,
      );
    }
  }

  if (!sessionDataKey) {
    throw new Error('Could not extract sessionDataKey from Fronius login');
  }
  dbg(
    `Step 3: POST commonauth with sessionDataKey=${sessionDataKey.slice(0, 20)}…`,
  );

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
  dbg(
    `  → HTTP ${r3.status}, Location: ${(r3.headers.get('location') ?? '').slice(0, 80)}, cookies: ${jar.size}`,
  );

  if (r3.status !== 302) {
    throw new Error(`Fronius auth failed: HTTP ${r3.status}`);
  }

  // Step 4: follow redirect chain back to solarweb.com.
  // login.fronius.com/oauth2/authorize returns HTTP 200 with a form_post page that
  // submits the OIDC code to solarweb.com/Account/ExternalLoginCallback. That POST
  // returns a relative Location like /Account/ExternalLoginCallback?ReturnUrl=%2F
  // which must be resolved against solarweb.com, not login.fronius.com.
  let next = r3.headers.get('location') ?? '';
  let currentBase = 'https://login.fronius.com';
  /* eslint-disable no-await-in-loop -- sequential redirect chain, cannot be parallelised */
  for (let i = 0; i < 10 && next; i++) {
    const url = next.startsWith('http')
      ? next
      : new URL(next, currentBase).href;
    currentBase = new URL(url).origin;
    dbg(`Step 4.${i + 1}: GET ${url.slice(0, 80)}`);
    const { res, jar: j } = await fetchWithCookies(url, { method: 'GET', jar });
    jar = j;
    const rawLoc = res.headers.get('location') ?? '';
    next = rawLoc
      ? rawLoc.startsWith('http')
        ? rawLoc
        : new URL(rawLoc, url).href
      : '';
    dbg(
      `  → HTTP ${res.status}, Location: ${next.slice(0, 80)}, cookies: ${jar.size}`,
    );

    if (url.includes('solarweb.com') && res.status === 200) {
      dbg('  Reached solarweb.com with 200 — done');
      break;
    }

    // Handle form_post pages from any domain (login.fronius.com OR solarweb.com)
    if (
      res.status !== 302 &&
      !next &&
      res.headers.get('content-type')?.includes('html')
    ) {
      const html = await res.text();
      const form = /action="(?<action>[^"]+)"/.exec(html);
      dbg(
        `  form_post: action=${form?.groups?.action?.slice(0, 60) ?? 'NOT FOUND'}`,
      );
      const inputs: Record<string, string> = {};
      for (const m of html.matchAll(
        /name="(?<name>[^"]+)"[^>]*value="(?<value>[^"]*)"/g,
      )) {
        if (m.groups?.name) inputs[m.groups.name] = m.groups.value ?? '';
      }
      dbg(`  form inputs: ${Object.keys(inputs).join(', ')}`);
      if (form?.groups?.action) {
        const formAction = form.groups.action.startsWith('http')
          ? form.groups.action
          : new URL(form.groups.action, url).href;
        const formBody = new URLSearchParams(inputs);
        const { res: postRes, jar: postJar } = await fetchWithCookies(
          formAction,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formBody.toString(),
            jar,
          },
        );
        jar = postJar;
        currentBase = new URL(formAction).origin;
        const rawPostLoc = postRes.headers.get('location') ?? '';
        // Resolve relative Location against the form action's origin (solarweb.com)
        next = rawPostLoc
          ? rawPostLoc.startsWith('http')
            ? rawPostLoc
            : new URL(rawPostLoc, formAction).href
          : '';
        dbg(
          `  form POST → HTTP ${postRes.status}, Location: ${next.slice(0, 80)}, cookies: ${jar.size}`,
        );
      }
    }
  }
  /* eslint-enable no-await-in-loop */

  dbg(`Login complete. Cookie keys: ${[...jar.keys()].join(', ')}`);
  // SolarWeb uses .AspNet.Auth (ASP.NET Core); older deployments used .ASPXAUTH
  if (!jar.has('.ASPXAUTH') && !jar.has('.AspNet.Auth')) {
    lastLoginError =
      'CAPTCHA / Human Verification blocked login — solarweb.com session not established';
    throw new Error(
      `Login succeeded but no session cookie — solarweb.com session not established. Got: ${[...jar.keys()].join(', ')}`,
    );
  }
  lastLoginError = null;
  saveSession(jar);
  return jar;
}

async function getSessionJar(): Promise<CookieJar> {
  if (!sessionJar) {
    sessionJar = loadSession();
    dbg(
      sessionJar
        ? 'Loaded session from disk'
        : 'No cached session on disk — logging in',
    );
  }
  // eslint-disable-next-line require-atomic-updates
  if (!sessionJar) sessionJar = await login();
  return sessionJar;
}

// ─── Chart data fetching ──────────────────────────────────────────────────────

interface ChartSeries {
  name?: string;
  data?: Array<[number, number]>;
}

interface SolarWebChartResponse {
  settings?: { series?: ChartSeries[] };
  sumValue?: string;
}

function seriesMap(series: ChartSeries[], name: string): Map<number, number> {
  return new Map(series.find((s) => s.name === name)?.data);
}

async function fetchProductionChart(
  jar: CookieJar,
  year: number,
  month: number,
  day: number,
): Promise<SolarWebChartResponse> {
  const url = `https://www.solarweb.com/Chart/GetChartNew?pvSystemId=${PV_SYSTEM_ID}&year=${year}&month=${month}&day=${day}&interval=day&view=production&_=${Date.now()}`;
  const res = await fetch(url, {
    headers: {
      Accept: '*/*',
      'Cache-Control': 'no-cache',
      Cookie: cookieHeader(jar),
      Pragma: 'no-cache',
      Referer: `https://www.solarweb.com/Chart/Chart?pvSystemId=${PV_SYSTEM_ID}`,
      'User-Agent': USER_AGENT,
      'X-Requested-With': 'XMLHttpRequest',
    },
    redirect: 'manual',
  });

  if (res.status === 401 || res.status === 302) {
    sessionJar = null;
    try {
      if (existsSync(SESSION_PATH)) writeFileSync(SESSION_PATH, '', 'utf8');
    } catch {
      /* non-critical */
    }
    dbg(`Session expired (${res.status}) for ${year}-${month}-${day}`);
    throw new Error('Session expired');
  }
  if (!res.ok) {
    throw new Error(
      `Chart fetch failed: ${res.status} for ${year}-${month}-${day}`,
    );
  }
  return res.json() as Promise<SolarWebChartResponse>;
}

async function syncDay(date: string): Promise<void> {
  const [year, month, day] = date.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const jar = await getSessionJar();
  const json = await fetchProductionChart(jar, year, month, day);

  const series = json.settings?.series ?? [];
  dbg(
    `${date}: series=[${series.map((s) => s.name).join(', ')}] points=${series[0]?.data?.length ?? 0}`,
  );

  const exportMap = seriesMap(series, 'Power to grid');
  const importMap = seriesMap(series, 'Consumption');
  const selfMap = seriesMap(series, 'Consumed directly');
  const battMap = seriesMap(series, 'Power to battery');
  const socMap = seriesMap(series, 'State of charge');

  // Use export series timestamps as anchor; all series share the same 5-min slots
  const timestamps = [...exportMap.keys()].toSorted((a, b) => a - b);
  if (timestamps.length === 0) return;

  const rows: SolarwebReadingRow[] = timestamps.map((tsMs) => {
    const exportW = exportMap.get(tsMs) ?? 0;
    const importW = importMap.get(tsMs) ?? 0;
    const selfW = selfMap.get(tsMs) ?? 0;
    const battW = battMap.get(tsMs) ?? 0;
    const socV = socMap.get(tsMs);
    return {
      timestamp: Math.floor(tsMs / 1000),
      production_w: exportW + selfW + battW,
      export_w: exportW,
      import_w: importW,
      self_consumption_w: selfW,
      battery_w: battW,
      battery_soc_pct: socV != null && socV > 0 ? socV : null,
    };
  });

  db.upsertSolarwebReadings(rows);
}

/** Scrapes yesterday and today from SolarWeb to keep recent stats current. */
export async function scrapeRecentDays(): Promise<void> {
  if (!PV_SYSTEM_ID || !USERNAME || !PASSWORD) return;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10);

  /* eslint-disable no-await-in-loop -- two sequential days, cannot be parallelised (shared session) */
  for (const date of [yesterday, today]) {
    try {
      await syncDay(date);
    } catch {
      // non-critical — local readings fallback is already in place
    }
  }
  /* eslint-enable no-await-in-loop */
}

/**
 * Scrapes daily energy stats from SolarWeb for all days since SOLARWEB_HISTORY_START.
 * @returns Object with counts of synced/errored days and the start date used.
 */
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
  const yesterday = new Date(Date.now() - 86_400_000)
    .toISOString()
    .slice(0, 10);

  const allDates: string[] = [];
  let cursor = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${today}T12:00:00Z`);
  while (cursor <= end) {
    allDates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }

  // Load existing slot counts and skip days that are already complete.
  // 288 = 24h × 12 five-minute slots; DST days can be ±12, so 270 is the safe floor.
  const COMPLETE_SLOTS = 270;
  const fromTs = Math.floor(
    new Date(`${startDate}T00:00:00Z`).getTime() / 1000,
  );
  const toTs = Math.floor(new Date(`${today}T23:59:59Z`).getTime() / 1000);
  const existingCounts = db.getSolarwebDayCounts(fromTs, toTs);
  const dates = allDates.filter(
    (date) =>
      date >= yesterday || (existingCounts.get(date) ?? 0) < COMPLETE_SLOTS,
  );

  dbg(
    `Starting sync of ${dates.length}/${allDates.length} days from ${startDate} to ${today} (${allDates.length - dates.length} already complete)`,
  );

  progress = {
    running: true,
    currentDate: null,
    synced: 0,
    errors: 0,
    total: dates.length,
    startDate: `${startDate} (${allDates.length - dates.length} already complete)`,
  };

  const MAX_CONSECUTIVE_LOGIN_FAILURES = 3;
  let consecutiveLoginFailures = 0;

  /* eslint-disable no-await-in-loop -- sequential to avoid rate-limiting */
  for (const date of dates) {
    progress.currentDate = date;
    try {
      await syncDay(date);
      progress.synced++;
      consecutiveLoginFailures = 0;
    } catch (error_) {
      progress.errors++;
      dbg(
        `Error on ${date}: ${error_ instanceof Error ? error_.message : String(error_)}`,
      );
      if (!sessionJar) {
        // eslint-disable-next-line require-atomic-updates
        sessionJar = await login().catch(() => null);
        if (!sessionJar) {
          consecutiveLoginFailures++;
          if (consecutiveLoginFailures >= MAX_CONSECUTIVE_LOGIN_FAILURES) {
            dbg(
              `Aborting history sync after ${consecutiveLoginFailures} consecutive login failures (CAPTCHA or credentials issue)`,
            );
            process.stderr.write(
              `[solarweb] History sync aborted: login failed ${consecutiveLoginFailures} times in a row. CAPTCHA or credential issue — will retry on next scheduled sync.\n`,
            );
            break;
          }
        }
      }
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 500);
    });
  }
  /* eslint-enable no-await-in-loop */

  const { synced, errors } = progress;
  progress = {
    running: false,
    currentDate: null,
    synced,
    errors,
    total: dates.length,
    startDate,
  };
  dbg(`Sync complete: ${synced} synced, ${errors} errors`);
  return { synced, errors, startDate };
}
