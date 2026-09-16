import type { Env } from './types';

type BingEnv = Pick<Env, 'BING_WEBMASTER_API_KEY'>;
type Fetcher = typeof fetch;

const API_BASE = 'https://ssl.bing.com/webmaster/api.svc/json/';

export class BingWebmasterError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'BingWebmasterError';
  }
}

function text(value: unknown, maxLength = 2048): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function number(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function date(value: unknown): string | null {
  const raw = text(value, 80);
  const legacy = /^\/Date\((-?\d+)/.exec(raw);
  const parsed = legacy ? new Date(Number(legacy[1])) : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function configuredKey(env: BingEnv): string {
  const key = env.BING_WEBMASTER_API_KEY?.trim() ?? '';
  if (!key) throw new BingWebmasterError('BING_NOT_CONFIGURED', 'Bing Webmaster API is not configured', 503);
  return key;
}

async function request(method: string, env: BingEnv, params: Record<string, string>, fetcher: Fetcher): Promise<unknown[]> {
  const url = new URL(method, API_BASE);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set('apikey', configuredKey(env));

  let response: Response;
  try {
    response = await fetcher(url.toString(), { headers: { Accept: 'application/json' } });
  } catch {
    throw new BingWebmasterError('BING_UNAVAILABLE', 'Bing Webmaster API is unavailable', 502);
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    // Handled as a malformed upstream response below.
  }
  if (!response.ok) {
    const authError = response.status === 401 || response.status === 403;
    throw new BingWebmasterError(
      authError ? 'BING_AUTH_ERROR' : 'BING_UPSTREAM_ERROR',
      authError ? 'Bing Webmaster API rejected the configured key' : 'Bing Webmaster API request failed',
      502,
    );
  }
  if (!Array.isArray(body.d)) {
    throw new BingWebmasterError('BING_INVALID_RESPONSE', 'Bing Webmaster API returned an invalid response', 502);
  }
  return body.d;
}

export function bingWebmasterConfigured(env: BingEnv): boolean {
  return Boolean(env.BING_WEBMASTER_API_KEY?.trim());
}

export async function listBingWebmasterSites(env: BingEnv, fetcher: Fetcher = fetch): Promise<Array<{
  url: string;
  is_verified: boolean;
}>> {
  const rows = await request('GetUserSites', env, {}, fetcher);
  return rows.flatMap(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
    const item = row as Record<string, unknown>;
    const url = text(item.Url);
    return url ? [{ url, is_verified: item.IsVerified === true }] : [];
  }).slice(0, 100);
}

export async function loadBingWebmasterPerformance(
  env: BingEnv,
  siteUrl: string,
  fetcher: Fetcher = fetch,
): Promise<{
  site_url: string;
  totals: { clicks: number; impressions: number };
  start_date: string | null;
  end_date: string | null;
  traffic: Array<{ date: string | null; clicks: number; impressions: number }>;
  queries: Array<{
    query: string;
    date: string | null;
    clicks: number;
    impressions: number;
    avg_click_position: number;
    avg_impression_position: number;
  }>;
  limitation: string;
}> {
  const [trafficRows, queryRows] = await Promise.all([
    request('GetRankAndTrafficStats', env, { siteUrl }, fetcher),
    request('GetQueryStats', env, { siteUrl }, fetcher),
  ]);
  const traffic = trafficRows.flatMap(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
    const item = row as Record<string, unknown>;
    return [{ date: date(item.Date), clicks: number(item.Clicks), impressions: number(item.Impressions) }];
  }).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 400);
  const queries = queryRows.flatMap(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
    const item = row as Record<string, unknown>;
    const query = text(item.Query, 500);
    return query ? [{
      query,
      date: date(item.Date),
      clicks: number(item.Clicks),
      impressions: number(item.Impressions),
      avg_click_position: number(item.AvgClickPosition),
      avg_impression_position: number(item.AvgImpressionPosition),
    }] : [];
  }).slice(0, 200);
  return {
    site_url: siteUrl,
    totals: traffic.reduce((sum, row) => ({
      clicks: sum.clicks + row.clicks,
      impressions: sum.impressions + row.impressions,
    }), { clicks: 0, impressions: 0 }),
    start_date: traffic.at(-1)?.date ?? null,
    end_date: traffic[0]?.date ?? null,
    traffic,
    queries,
    limitation: 'Bing data is owner-only and does not affect the public audit score.',
  };
}
