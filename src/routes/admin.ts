import {
  adminAllowlist,
  adminCookieHeader,
  adminSessionFromRequest,
  clearAdminCookieHeader,
  githubOAuthConfigured,
  isAllowedAdminLogin,
  oauthCallbackUrl,
  safeNextUrl,
  sessionSecret,
  signAdminSession,
} from '../lib/admin-auth';
import { requireAdmin } from '../lib/security';
import {
  exchangeGscAuthorizationCode,
  googleSearchConsoleAuthorizationUrl,
  googleSearchConsoleConfigured,
  googleSearchConsoleStatus,
  GoogleSearchConsoleError,
  inspectGoogleSearchConsoleUrl,
  listGoogleSearchConsoleProperties,
  loadGoogleSearchPerformance,
  saveGscConnection,
} from '../lib/google-search-console';
import type { Env } from '../lib/types';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};
const OAUTH_STATE_TTL_SECONDS = 600;
const GSC_OAUTH_STATE_TTL_SECONDS = 600;
const DEFAULT_BROWSER_BUDGET_SECONDS = 540;

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

function redirect(location: string, headers: HeadersInit = {}): Response {
  return new Response(null, { status: 302, headers: { Location: location, ...headers } });
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToBase64Url(value);
}

function errorRedirect(next: string, code: string): string {
  const target = new URL(next);
  target.searchParams.set('error', code);
  return target.toString();
}

function queryRedirect(next: string, name: string, value: string): string {
  const target = new URL(next);
  target.searchParams.set(name, value);
  return target.toString();
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function githubLogin(req: Request, env: Env): Promise<Response> {
  if (!githubOAuthConfigured(env)) return json({ error: 'GitHub OAuth is not configured' }, 503);
  const url = new URL(req.url);
  const state = randomToken();
  const next = safeNextUrl(url.searchParams.get('next'), env);
  try {
    await env.BUDGET_KV.put(`admin:oauth:${state}`, next, { expirationTtl: OAUTH_STATE_TTL_SECONDS });
  } catch {
    return json({ error: 'OAuth state storage is unavailable' }, 503);
  }

  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', env.GITHUB_CLIENT_ID!);
  authorize.searchParams.set('redirect_uri', oauthCallbackUrl(env));
  authorize.searchParams.set('scope', 'read:user');
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('allow_signup', 'false');
  return redirect(authorize.toString());
}

async function githubCallback(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const state = url.searchParams.get('state')?.trim() ?? '';
  const code = url.searchParams.get('code')?.trim() ?? '';
  if (!state || !code) return json({ error: 'OAuth code and state are required' }, 400);

  let next: string | null = null;
  try {
    next = await env.BUDGET_KV.get(`admin:oauth:${state}`);
    await env.BUDGET_KV.delete(`admin:oauth:${state}`);
  } catch {
    return json({ error: 'OAuth state storage is unavailable' }, 503);
  }
  if (!next) return json({ error: 'OAuth state is invalid or expired' }, 400);
  next = safeNextUrl(next, env);
  if (!githubOAuthConfigured(env) || !sessionSecret(env)) {
    return redirect(errorRedirect(next, 'oauth_not_configured'));
  }

  try {
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: oauthCallbackUrl(env),
      }),
    });
    const tokenBody = await responseJson(tokenResponse);
    const accessToken = typeof tokenBody.access_token === 'string' ? tokenBody.access_token : '';
    if (!tokenResponse.ok || !accessToken) return redirect(errorRedirect(next, 'oauth_failed'));

    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'sayori-geoscore-admin',
      },
    });
    const userBody = await responseJson(userResponse);
    const login = typeof userBody.login === 'string' ? userBody.login.trim() : '';
    if (!userResponse.ok || !login) return redirect(errorRedirect(next, 'oauth_failed'));
    if (!isAllowedAdminLogin(login, env)) return redirect(errorRedirect(next, 'forbidden'));

    const now = Math.floor(Date.now() / 1000);
    const token = await signAdminSession({
      login,
      iat: now,
      exp: now + 14 * 24 * 60 * 60,
    }, sessionSecret(env)!);
    return redirect(next, { 'Set-Cookie': adminCookieHeader(token, env) });
  } catch {
    return redirect(errorRedirect(next, 'oauth_failed'));
  }
}

async function sessionStatus(req: Request, env: Env): Promise<Response> {
  const session = await adminSessionFromRequest(req, env);
  return json({
    authenticated: Boolean(session),
    login: session?.login ?? null,
    github_oauth: githubOAuthConfigured(env),
    allowlist: adminAllowlist(env),
    full_access: Boolean(session),
  });
}

function gscError(error: unknown): Response {
  if (error instanceof GoogleSearchConsoleError) {
    return json({ error: error.code, message: error.message }, error.status);
  }
  return json({ error: 'GSC_UNAVAILABLE', message: 'Google Search Console is unavailable' }, 502);
}

async function gscConnect(req: Request, env: Env): Promise<Response> {
  if (!googleSearchConsoleConfigured(env)) {
    return json({ error: 'GSC_NOT_CONFIGURED', message: 'Google Search Console OAuth is not configured' }, 503);
  }
  const url = new URL(req.url);
  const state = randomToken();
  const next = safeNextUrl(url.searchParams.get('next'), env);
  try {
    await env.BUDGET_KV.put('admin:gsc:oauth:' + state, next, { expirationTtl: GSC_OAUTH_STATE_TTL_SECONDS });
  } catch {
    return json({ error: 'GSC_STATE_UNAVAILABLE', message: 'OAuth state storage is unavailable' }, 503);
  }
  return redirect(googleSearchConsoleAuthorizationUrl(env, state));
}

async function gscCallback(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const state = url.searchParams.get('state')?.trim() ?? '';
  const code = url.searchParams.get('code')?.trim() ?? '';
  if (!state || !code) {
    return redirect(queryRedirect(safeNextUrl(null, env), 'gsc_error', 'invalid_state'));
  }

  let next: string | null = null;
  try {
    next = await env.BUDGET_KV.get('admin:gsc:oauth:' + state);
    await env.BUDGET_KV.delete('admin:gsc:oauth:' + state);
  } catch {
    return redirect(queryRedirect(safeNextUrl(null, env), 'gsc_error', 'state_unavailable'));
  }
  if (!next) return redirect(queryRedirect(safeNextUrl(null, env), 'gsc_error', 'invalid_state'));
  next = safeNextUrl(next, env);

  try {
    const token = await exchangeGscAuthorizationCode(env, code);
    await saveGscConnection(env, token.refresh_token, token.scope);
    return redirect(queryRedirect(next, 'gsc', 'connected'));
  } catch (error) {
    const codeValue = error instanceof GoogleSearchConsoleError ? error.code.toLowerCase() : 'unavailable';
    return redirect(queryRedirect(next, 'gsc_error', codeValue));
  }
}

async function gscPerformance(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const siteUrl = url.searchParams.get('site_url')?.trim() ?? '';
  if (!siteUrl || siteUrl.length > 2048) return json({ error: 'GSC_SITE_REQUIRED' }, 400);
  const days = Number.parseInt(url.searchParams.get('days') ?? '28', 10);
  try {
    return json(await loadGoogleSearchPerformance(env, siteUrl, days));
  } catch (error) {
    return gscError(error);
  }
}

async function gscInspect(req: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await req.json();
    body = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return json({ error: 'INVALID_JSON' }, 400);
  }
  const siteUrl = typeof body.site_url === 'string' ? body.site_url.trim() : '';
  const inspectionUrl = typeof body.inspection_url === 'string' ? body.inspection_url.trim() : '';
  if (!siteUrl || !inspectionUrl || siteUrl.length > 2048 || inspectionUrl.length > 2048) {
    return json({ error: 'GSC_INSPECTION_URL_REQUIRED' }, 400);
  }
  try {
    return json(await inspectGoogleSearchConsoleUrl(env, siteUrl, inspectionUrl));
  } catch (error) {
    return gscError(error);
  }
}

function logout(env: Env): Response {
  return json({ ok: true }, 200, { 'Set-Cookie': clearAdminCookieHeader(env) });
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function utcDayStart(date = new Date()): number {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 1000);
}

async function overview(env: Env): Promise<Response> {
  const now = new Date();
  const todayStart = utcDayStart(now);
  const mondayStart = todayStart - ((now.getUTCDay() + 6) % 7) * 86_400;
  const dayKey = now.toISOString().slice(0, 10);

  const statusPromise = env.DB.prepare(
    'SELECT status, COUNT(*) AS count FROM audits GROUP BY status',
  ).all<{ status: string; count: number | string }>().catch(() => ({ results: [] }));
  const businessesPromise = env.DB.prepare(
    'SELECT COUNT(*) AS count FROM businesses',
  ).first<{ count: number | string }>().catch(() => null);
  const uniqueSitesPromise = env.DB.prepare(
    'SELECT COUNT(DISTINCT business_id) AS count FROM audits',
  ).first<{ count: number | string }>().catch(() => null);
  const todayPromise = env.DB.prepare(
    'SELECT COUNT(*) AS count FROM audits WHERE created_at >= ?',
  ).bind(todayStart).first<{ count: number | string }>().catch(() => null);
  const weekPromise = env.DB.prepare(
    'SELECT COUNT(*) AS count FROM audits WHERE created_at >= ?',
  ).bind(mondayStart).first<{ count: number | string }>().catch(() => null);
  const recentPromise = env.DB.prepare(
    `SELECT a.id, a.status, a.foundation_score, a.weakness_score,
            a.created_at, a.completed_at, b.domain
       FROM audits a
       LEFT JOIN businesses b ON b.id = a.business_id
      ORDER BY COALESCE(a.completed_at, a.created_at) DESC, a.id DESC
      LIMIT 25`,
  ).all<{
    id: string;
    status: string;
    foundation_score: number | null;
    weakness_score: number | null;
    created_at: number | string | null;
    completed_at: number | string | null;
    domain: string | null;
  }>().catch(() => ({ results: [] }));
  const monitorPromise = env.DB.prepare(
    'SELECT COUNT(*) AS count FROM monitor_projects',
  ).first<{ count: number | string }>().catch(() => null);

  const [statuses, businesses, uniqueSites, today, week, recent, monitors] = await Promise.all([
    statusPromise,
    businessesPromise,
    uniqueSitesPromise,
    todayPromise,
    weekPromise,
    recentPromise,
    monitorPromise,
  ]);

  const auditsByStatus: Record<string, number> = Object.fromEntries((statuses.results ?? []).map(row => [
    row.status || 'unknown',
    numberValue(row.count),
  ]));
  const browserBudget = positiveInt(env.DAILY_BROWSER_BUDGET_SECONDS, DEFAULT_BROWSER_BUDGET_SECONDS);
  let browserUsed = 0;
  let aiUsed = 0;
  try {
    const [browser, ai] = await Promise.all([
      env.BUDGET_KV.get(`browser:${dayKey}`),
      env.BUDGET_KV.get(`ai:${dayKey}`),
    ]);
    browserUsed = Math.max(0, numberValue(browser));
    aiUsed = Math.max(0, numberValue(ai));
  } catch {
    // The dashboard still exposes DB totals when budget KV is unavailable.
  }

  const todayAudits = numberValue(today?.count);
  const publicAuditCap = positiveInt(env.AUDIT_RATE_LIMIT_PER_HOUR, 2);
  return json({
    totals: {
      audits: Object.values(auditsByStatus).reduce((sum, count) => sum + numberValue(count), 0),
      audits_by_status: auditsByStatus,
      businesses: numberValue(businesses?.count),
      unique_sites: numberValue(uniqueSites?.count),
    },
    today: { audits: todayAudits, utc_date: dayKey },
    this_week: { audits: numberValue(week?.count), utc_start: new Date(mondayStart * 1000).toISOString() },
    quotas: {
      browser_run: {
        used_seconds: browserUsed,
        budget_seconds: browserBudget,
        remaining_seconds: Math.max(0, browserBudget - browserUsed),
      },
      public_audit: {
        limit_per_hour: publicAuditCap,
        today_audits: todayAudits,
        remaining_estimate: Math.max(0, publicAuditCap - todayAudits),
      },
      ai_counter: { used: aiUsed, utc_date: dayKey, informational: true },
    },
    monitor_projects: numberValue(monitors?.count),
    recent_audits: (recent.results ?? []).map(row => ({
      id: row.id,
      domain: row.domain,
      status: row.status,
      seo_score: row.foundation_score,
      geo_score: row.weakness_score,
      created_at: numberValue(row.created_at),
      completed_at: row.completed_at === null ? null : numberValue(row.completed_at),
    })),
  });
}

export async function handleAdmin(req: Request, env: Env): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  if (!pathname.startsWith('/api/admin')) return null;

  if (pathname === '/api/admin/github/login' && req.method === 'GET') return githubLogin(req, env);
  if (pathname === '/api/admin/github/callback' && req.method === 'GET') return githubCallback(req, env);
  if (pathname === '/api/admin/session' && req.method === 'GET') return sessionStatus(req, env);
  if (pathname === '/api/admin/logout' && (req.method === 'GET' || req.method === 'POST')) return logout(env);
  if (pathname.startsWith('/api/admin/gsc')) {
    const denied = await requireAdmin(req, env);
    if (denied) return denied;
    if (pathname === '/api/admin/gsc/connect' && req.method === 'GET') return gscConnect(req, env);
    if (pathname === '/api/admin/gsc/callback' && req.method === 'GET') return gscCallback(req, env);
    if (pathname === '/api/admin/gsc/status' && req.method === 'GET') {
      return json(await googleSearchConsoleStatus(env));
    }
    if (pathname === '/api/admin/gsc/properties' && req.method === 'GET') {
      try {
        return json({ properties: await listGoogleSearchConsoleProperties(env) });
      } catch (error) {
        return gscError(error);
      }
    }
    if (pathname === '/api/admin/gsc/performance' && req.method === 'GET') return gscPerformance(req, env);
    if (pathname === '/api/admin/gsc/inspect' && req.method === 'POST') return gscInspect(req, env);
  }
  if (pathname === '/api/admin/overview' && req.method === 'GET') {
    const denied = await requireAdmin(req, env);
    if (denied) return denied;
    return overview(env);
  }
  return json({ error: 'Not found' }, 404);
}
