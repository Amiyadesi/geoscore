import type { Env } from './types';

const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SITES_URL = 'https://www.googleapis.com/webmasters/v3/sites';
const INSPECTION_URL = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';

type GscEnv = Pick<Env, 'DB' | 'ADMIN_SESSION_SECRET' | 'GSC_CLIENT_ID' | 'GSC_CLIENT_SECRET' | 'PUBLIC_API_URL'>;
type Fetcher = typeof fetch;

interface ConnectionRow {
  refresh_token_ciphertext: string;
  scopes: string;
  connected_at: number | string;
  updated_at: number | string;
}

interface ConnectionState {
  row: ConnectionRow | null;
  storageReady: boolean;
}

export class GoogleSearchConsoleError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = 'GoogleSearchConsoleError';
  }
}

function responseObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return responseObject(await response.json());
  } catch {
    return {};
  }
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode('geoscore:gsc:refresh:v1:' + secret),
  );
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptGscRefreshToken(refreshToken: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(secret),
    new TextEncoder().encode(refreshToken),
  ));
  const packed = new Uint8Array(iv.length + ciphertext.length);
  packed.set(iv);
  packed.set(ciphertext, iv.length);
  return bytesToBase64Url(packed);
}

export async function decryptGscRefreshToken(ciphertext: string, secret: string): Promise<string> {
  const packed = base64UrlToBytes(ciphertext);
  if (packed.length <= 28) throw new Error('Invalid encrypted refresh token');
  const clear = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: packed.slice(0, 12) },
    await encryptionKey(secret),
    packed.slice(12),
  );
  return new TextDecoder().decode(clear);
}

export function googleSearchConsoleConfigured(env: GscEnv): boolean {
  return Boolean(env.GSC_CLIENT_ID?.trim() && env.GSC_CLIENT_SECRET?.trim() && env.ADMIN_SESSION_SECRET?.trim());
}

export function googleSearchConsoleCallbackUrl(env: GscEnv): string {
  return new URL('/api/admin/gsc/callback', env.PUBLIC_API_URL || 'https://geo-api.sayori.org').toString();
}

export function googleSearchConsoleAuthorizationUrl(env: GscEnv, state: string): string {
  const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorize.searchParams.set('client_id', env.GSC_CLIENT_ID ?? '');
  authorize.searchParams.set('redirect_uri', googleSearchConsoleCallbackUrl(env));
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('scope', GSC_SCOPE);
  authorize.searchParams.set('access_type', 'offline');
  authorize.searchParams.set('include_granted_scopes', 'true');
  authorize.searchParams.set('prompt', 'consent');
  authorize.searchParams.set('state', state);
  return authorize.toString();
}

async function connectionState(env: GscEnv): Promise<ConnectionState> {
  try {
    return {
      row: await env.DB.prepare(
        'SELECT refresh_token_ciphertext, scopes, connected_at, updated_at ' +
        'FROM google_search_console_connections WHERE id = 1',
      ).first<ConnectionRow>(),
      storageReady: true,
    };
  } catch {
    // A storage or migration failure must be visible instead of looking like a
    // normal disconnected account.
    return { row: null, storageReady: false };
  }
}

export async function googleSearchConsoleStatus(env: GscEnv): Promise<{
  configured: boolean;
  connected: boolean;
  storage_ready: boolean;
  callback_url: string;
  scope: string;
  connected_at: number | null;
  updated_at: number | null;
}> {
  const state = await connectionState(env);
  const row = state.row;
  return {
    configured: googleSearchConsoleConfigured(env),
    connected: Boolean(row),
    storage_ready: state.storageReady,
    callback_url: googleSearchConsoleCallbackUrl(env),
    scope: GSC_SCOPE,
    connected_at: row ? numberValue(row.connected_at) : null,
    updated_at: row ? numberValue(row.updated_at) : null,
  };
}

export async function exchangeGscAuthorizationCode(
  env: GscEnv,
  code: string,
  fetcher: Fetcher = fetch,
): Promise<{ refresh_token: string; scope: string }> {
  if (!googleSearchConsoleConfigured(env)) {
    throw new GoogleSearchConsoleError('GSC_NOT_CONFIGURED', 'Google Search Console OAuth is not configured', 503);
  }
  const response = await fetcher(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GSC_CLIENT_ID!,
      client_secret: env.GSC_CLIENT_SECRET!,
      code,
      grant_type: 'authorization_code',
      redirect_uri: googleSearchConsoleCallbackUrl(env),
    }),
  });
  const data = await responseJson(response);
  const refreshToken = typeof data.refresh_token === 'string' ? data.refresh_token : '';
  if (!response.ok || !refreshToken) {
    throw new GoogleSearchConsoleError(
      'GSC_OAUTH_FAILED',
      typeof data.error_description === 'string' ? data.error_description : 'Google did not return a refresh token',
      502,
    );
  }
  return {
    refresh_token: refreshToken,
    scope: typeof data.scope === 'string' ? data.scope : GSC_SCOPE,
  };
}

export async function saveGscConnection(env: GscEnv, refreshToken: string, scopes: string): Promise<void> {
  const secret = env.ADMIN_SESSION_SECRET?.trim();
  if (!secret) throw new GoogleSearchConsoleError('GSC_NOT_CONFIGURED', 'Admin session secret is not configured', 503);
  const encrypted = await encryptGscRefreshToken(refreshToken, secret);
  try {
    await env.DB.prepare(
      'INSERT INTO google_search_console_connections ' +
      '(id, refresh_token_ciphertext, scopes, connected_at, updated_at) ' +
      'VALUES (1, ?, ?, unixepoch(), unixepoch()) ' +
      'ON CONFLICT(id) DO UPDATE SET ' +
      'refresh_token_ciphertext = excluded.refresh_token_ciphertext, ' +
      'scopes = excluded.scopes, updated_at = unixepoch()',
    ).bind(encrypted, scopes).run();
  } catch {
    throw new GoogleSearchConsoleError('GSC_STORAGE_UNAVAILABLE', 'Google Search Console storage is not ready; apply the D1 migration', 503);
  }
}

async function accessToken(env: GscEnv, fetcher: Fetcher): Promise<string> {
  if (!googleSearchConsoleConfigured(env)) {
    throw new GoogleSearchConsoleError('GSC_NOT_CONFIGURED', 'Google Search Console OAuth is not configured', 503);
  }
  const state = await connectionState(env);
  if (!state.storageReady) {
    throw new GoogleSearchConsoleError('GSC_STORAGE_UNAVAILABLE', 'Google Search Console storage is not ready; apply the D1 migration', 503);
  }
  const row = state.row;
  if (!row) throw new GoogleSearchConsoleError('GSC_NOT_CONNECTED', 'Google Search Console is not connected', 409);

  let refreshToken = '';
  try {
    refreshToken = await decryptGscRefreshToken(row.refresh_token_ciphertext, env.ADMIN_SESSION_SECRET!);
  } catch {
    throw new GoogleSearchConsoleError('GSC_RECONNECT_REQUIRED', 'Stored Google authorization cannot be decrypted; reconnect it', 409);
  }
  const response = await fetcher(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GSC_CLIENT_ID!,
      client_secret: env.GSC_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await responseJson(response);
  const token = typeof data.access_token === 'string' ? data.access_token : '';
  if (!response.ok || !token) {
    throw new GoogleSearchConsoleError('GSC_RECONNECT_REQUIRED', 'Google authorization expired or was revoked', 409);
  }
  return token;
}

async function googleJson(
  url: string,
  token: string,
  init: RequestInit,
  fetcher: Fetcher,
): Promise<Record<string, unknown>> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', 'Bearer ' + token);
  headers.set('Accept', 'application/json');
  const response = await fetcher(url, { ...init, headers });
  const data = await responseJson(response);
  if (!response.ok) {
    const error = responseObject(data.error);
    throw new GoogleSearchConsoleError(
      'GSC_UPSTREAM_ERROR',
      typeof error.message === 'string' ? error.message : 'Google Search Console request failed',
      response.status === 429 ? 429 : 502,
    );
  }
  return data;
}

export async function listGoogleSearchConsoleProperties(env: GscEnv, fetcher: Fetcher = fetch): Promise<Array<{
  site_url: string;
  permission_level: string;
}>> {
  const token = await accessToken(env, fetcher);
  const data = await googleJson(SITES_URL, token, { method: 'GET' }, fetcher);
  const entries = Array.isArray(data.siteEntry) ? data.siteEntry : [];
  return entries.flatMap(value => {
    const item = responseObject(value);
    return typeof item.siteUrl === 'string'
      ? [{ site_url: item.siteUrl, permission_level: typeof item.permissionLevel === 'string' ? item.permissionLevel : 'unknown' }]
      : [];
  }).slice(0, 100);
}

function dateKey(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

function metricRow(value: unknown): {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
} {
  const row = responseObject(value);
  return {
    keys: Array.isArray(row.keys) ? row.keys.filter((key): key is string => typeof key === 'string') : [],
    clicks: numberValue(row.clicks),
    impressions: numberValue(row.impressions),
    ctr: numberValue(row.ctr),
    position: numberValue(row.position),
  };
}

export async function loadGoogleSearchPerformance(
  env: GscEnv,
  siteUrl: string,
  requestedDays = 28,
  fetcher: Fetcher = fetch,
): Promise<Record<string, unknown>> {
  const days = Math.min(90, Math.max(1, Math.trunc(requestedDays) || 28));
  const endDate = dateKey(1);
  const startDate = dateKey(days);
  const token = await accessToken(env, fetcher);
  const endpoint = 'https://www.googleapis.com/webmasters/v3/sites/' +
    encodeURIComponent(siteUrl) + '/searchAnalytics/query';
  const query = async (dimensions: string[], rowLimit: number) => googleJson(endpoint, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate, endDate, dimensions, type: 'web', rowLimit }),
  }, fetcher);
  const [totals, queries, pages] = await Promise.all([
    query([], 1),
    query(['query'], 10),
    query(['page'], 10),
  ]);
  const totalRow = metricRow(Array.isArray(totals.rows) ? totals.rows[0] : null);
  return {
    site_url: siteUrl,
    start_date: startDate,
    end_date: endDate,
    days,
    totals: {
      clicks: totalRow.clicks,
      impressions: totalRow.impressions,
      ctr: totalRow.ctr,
      position: totalRow.position,
    },
    top_queries: (Array.isArray(queries.rows) ? queries.rows : []).map(value => {
      const row = metricRow(value);
      return { query: row.keys[0] ?? '', clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position };
    }),
    top_pages: (Array.isArray(pages.rows) ? pages.rows : []).map(value => {
      const row = metricRow(value);
      return { page: row.keys[0] ?? '', clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position };
    }),
    limitation: 'Search Analytics returns top rows and may omit low-volume data.',
  };
}

export function inspectionUrlBelongsToProperty(siteUrl: string, inspectionUrl: string): boolean {
  try {
    const inspected = new URL(inspectionUrl);
    if (!['http:', 'https:'].includes(inspected.protocol)) return false;
    if (siteUrl.startsWith('sc-domain:')) {
      const domain = siteUrl.slice('sc-domain:'.length).trim().toLowerCase();
      const host = inspected.hostname.toLowerCase();
      return Boolean(domain) && (host === domain || host.endsWith('.' + domain));
    }
    const property = new URL(siteUrl);
    if (inspected.origin !== property.origin) return false;
    const prefix = property.pathname.endsWith('/')
      ? property.pathname
      : property.pathname + '/';
    return inspected.pathname === property.pathname
      || inspected.pathname.startsWith(prefix);
  } catch {
    return false;
  }
}

export async function inspectGoogleSearchConsoleUrl(
  env: GscEnv,
  siteUrl: string,
  inspectionUrl: string,
  fetcher: Fetcher = fetch,
): Promise<Record<string, unknown>> {
  if (!inspectionUrlBelongsToProperty(siteUrl, inspectionUrl)) {
    throw new GoogleSearchConsoleError('GSC_INVALID_URL', 'Inspection URL is outside the selected property', 400);
  }
  const token = await accessToken(env, fetcher);
  const data = await googleJson(INSPECTION_URL, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inspectionUrl, siteUrl, languageCode: 'zh-CN' }),
  }, fetcher);
  const result = responseObject(data.inspectionResult);
  const index = responseObject(result.indexStatusResult);
  const mobile = responseObject(result.mobileUsabilityResult);
  const rich = responseObject(result.richResultsResult);
  return {
    site_url: siteUrl,
    inspection_url: inspectionUrl,
    inspection_result_link: typeof result.inspectionResultLink === 'string' ? result.inspectionResultLink : null,
    index: {
      verdict: index.verdict ?? null,
      coverage_state: index.coverageState ?? null,
      robots_txt_state: index.robotsTxtState ?? null,
      indexing_state: index.indexingState ?? null,
      page_fetch_state: index.pageFetchState ?? null,
      last_crawl_time: index.lastCrawlTime ?? null,
      user_canonical: index.userCanonical ?? null,
      google_canonical: index.googleCanonical ?? null,
    },
    mobile_usability_verdict: mobile.verdict ?? null,
    rich_results_verdict: rich.verdict ?? null,
    limitation: 'URL Inspection reports Google indexed version, not a live URL test.',
  };
}
