import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, it, afterEach } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-admin-route-'));
fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"type":"commonjs"}\n');
fs.symlinkSync(path.resolve('node_modules'), path.join(tmpDir, 'node_modules'), 'junction');
execFileSync(process.execPath, [
  path.join('node_modules', 'typescript', 'bin', 'tsc'),
  '--target', 'ES2022', '--module', 'CommonJS', '--moduleResolution', 'node',
  '--lib', 'ES2022', '--types', '@cloudflare/workers-types', '--skipLibCheck',
  '--rootDir', 'src', '--outDir', tmpDir,
  'src/routes/admin.ts', 'src/lib/security.ts', 'src/lib/admin-auth.ts',
  'src/lib/google-search-console.ts', 'src/lib/types.ts',
], { stdio: 'inherit' });

const require = createRequire(import.meta.url);
const { handleAdmin } = require(path.join(tmpDir, 'routes', 'admin.js'));
const { inspectionUrlBelongsToProperty } = require(path.join(tmpDir, 'lib', 'google-search-console.js'));

function makeKv() {
  const values = new Map();
  const ttls = new Map();
  return {
    values,
    ttls,
    async get(key) { return values.get(key) ?? null; },
    async put(key, value, options) { values.set(key, value); ttls.set(key, options); },
    async delete(key) { values.delete(key); },
  };
}

function makeDb() {
  let gscConnection = null;
  return {
    get gscConnection() { return gscConnection; },
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...next) { values = next; return statement; },
        async first() {
          if (/FROM google_search_console_connections/i.test(sql)) return gscConnection;
          if (/COUNT\(DISTINCT business_id\)/i.test(sql)) return { count: 3 };
          if (/COUNT\(\*\).*businesses/i.test(sql)) return { count: 4 };
          if (/COUNT\(\*\).*created_at/i.test(sql)) return { count: 2 };
          if (/COUNT\(\*\).*monitor_projects/i.test(sql)) return { count: 1 };
          return null;
        },
        async all() {
          if (/GROUP BY status/i.test(sql)) return { results: [{ status: 'complete', count: 5 }] };
          if (/LEFT JOIN businesses/i.test(sql)) return { results: [{ id: 'audit_1', status: 'complete', foundation_score: 80, weakness_score: 70, created_at: 1, completed_at: 2, domain: 'example.com' }] };
          return { results: [] };
        },
        async run() {
          if (/INSERT INTO google_search_console_connections/i.test(sql)) {
            gscConnection = {
              refresh_token_ciphertext: values[0],
              scopes: values[1],
              connected_at: 100,
              updated_at: 100,
            };
          } else if (/DELETE FROM google_search_console_connections/i.test(sql)) {
            gscConnection = null;
          }
          return { success: true };
        },
      };
      return statement;
    },
  };
}

function env(overrides = {}) {
  return {
    PUBLIC_APP_URL: 'https://geo.sayori.org',
    PUBLIC_API_URL: 'https://geo-api.sayori.org',
    ADMIN_GITHUB_LOGINS: 'Amiyadesi',
    ADMIN_SESSION_SECRET: 'session-secret',
    GITHUB_CLIENT_ID: 'client-id',
    GITHUB_CLIENT_SECRET: 'client-secret',
    GSC_CLIENT_ID: 'gsc-client-id',
    GSC_CLIENT_SECRET: 'gsc-client-secret',
    ADMIN_TOKEN: 'owner-token',
    BUDGET_KV: makeKv(),
    DB: makeDb(),
    ...overrides,
  };
}

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('admin routes', () => {
  it('exposes public session state and protects overview', async () => {
    const current = env();
    const session = await handleAdmin(new Request('https://geo-api.sayori.org/api/admin/session'), current);
    assert.equal(session.status, 200);
    assert.deepEqual(await session.json(), {
      authenticated: false,
      login: null,
      github_oauth: true,
      allowlist: ['Amiyadesi'],
      full_access: false,
    });
    const denied = await handleAdmin(new Request('https://geo-api.sayori.org/api/admin/overview'), current);
    assert.equal(denied.status, 401);
  });

  it('stores bounded OAuth state and signs an allowlisted callback cookie', async () => {
    const current = env();
    const login = await handleAdmin(new Request('https://geo-api.sayori.org/api/admin/github/login?next=https%3A%2F%2Fgeo.sayori.org%2Fadmin.html'), current);
    assert.equal(login.status, 302);
    const authorize = new URL(login.headers.get('Location'));
    const state = authorize.searchParams.get('state');
    assert.ok(state);
    assert.equal(current.BUDGET_KV.ttls.get(`admin:oauth:${state}`).expirationTtl, 600);

    globalThis.__adminOriginalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => url.includes('access_token')
      ? Response.json({ access_token: 'github-token' })
      : Response.json({ login: 'Amiyadesi' });
    const callback = await handleAdmin(new Request(`https://geo-api.sayori.org/api/admin/github/callback?state=${state}&code=one-time`), current);
    assert.equal(callback.status, 302);
    assert.match(callback.headers.get('Set-Cookie'), /gs_admin=/);
    assert.match(callback.headers.get('Set-Cookie'), /Domain=\.sayori\.org/);

    const cookie = callback.headers.get('Set-Cookie').split(';', 1)[0];
    const authenticated = await handleAdmin(new Request('https://geo-api.sayori.org/api/admin/session', { headers: { Cookie: cookie } }), current);
    assert.equal((await authenticated.json()).full_access, true);
  });

  it('rejects a GitHub login outside the allowlist', async () => {
    const current = env();
    const login = await handleAdmin(new Request('https://geo-api.sayori.org/api/admin/github/login'), current);
    const state = new URL(login.headers.get('Location')).searchParams.get('state');
    globalThis.__adminOriginalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => url.includes('access_token')
      ? Response.json({ access_token: 'github-token' })
      : Response.json({ login: 'not-the-owner' });
    const callback = await handleAdmin(new Request(`https://geo-api.sayori.org/api/admin/github/callback?state=${state}&code=one-time`), current);
    assert.match(callback.headers.get('Location'), /error=forbidden/);
  });

  it('returns bounded overview data for an authenticated session', async () => {
    const current = env();
    const login = await handleAdmin(new Request('https://geo-api.sayori.org/api/admin/github/login'), current);
    const state = new URL(login.headers.get('Location')).searchParams.get('state');
    globalThis.__adminOriginalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => url.includes('access_token')
      ? Response.json({ access_token: 'github-token' })
      : Response.json({ login: 'Amiyadesi' });
    const callback = await handleAdmin(new Request(`https://geo-api.sayori.org/api/admin/github/callback?state=${state}&code=one-time`), current);
    const cookie = callback.headers.get('Set-Cookie').split(';', 1)[0];
    const overview = await handleAdmin(new Request('https://geo-api.sayori.org/api/admin/overview', { headers: { Cookie: cookie } }), current);
    const body = await overview.json();
    assert.equal(body.totals.unique_sites, 3);
    assert.equal(body.totals.audits_by_status.complete, 5);
    assert.equal(body.recent_audits[0].domain, 'example.com');
  });

  it('connects read-only Search Console and returns bounded owner data', async () => {
    const current = env();
    const headers = { Authorization: 'Bearer owner-token' };
    const initial = await handleAdmin(new Request('https://geo-api.sayori.org/api/admin/gsc/status', { headers }), current);
    assert.deepEqual(await initial.json(), {
      configured: true,
      connected: false,
      storage_ready: true,
      callback_url: 'https://geo-api.sayori.org/api/admin/gsc/callback',
      scope: 'https://www.googleapis.com/auth/webmasters.readonly',
      connected_at: null,
      updated_at: null,
    });

    const connect = await handleAdmin(new Request(
      'https://geo-api.sayori.org/api/admin/gsc/connect?next=https%3A%2F%2Fgeo.sayori.org%2Fadmin.html',
      { headers },
    ), current);
    const authorize = new URL(connect.headers.get('Location'));
    const state = authorize.searchParams.get('state');
    assert.equal(authorize.hostname, 'accounts.google.com');
    assert.equal(authorize.searchParams.get('scope'), 'https://www.googleapis.com/auth/webmasters.readonly');
    assert.equal(authorize.searchParams.get('access_type'), 'offline');
    assert.equal(current.BUDGET_KV.ttls.get('admin:gsc:oauth:' + state).expirationTtl, 600);

    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com/token')) {
        const params = new URLSearchParams(String(init.body));
        if (params.get('grant_type') === 'authorization_code') {
          return Response.json({
            refresh_token: 'never-store-me-in-plain-text',
            scope: 'https://www.googleapis.com/auth/webmasters.readonly',
          });
        }
        return Response.json({ access_token: 'short-lived-access-token', expires_in: 3600 });
      }
      if (url.endsWith('/webmasters/v3/sites')) {
        return Response.json({ siteEntry: [{ siteUrl: 'sc-domain:sayori.org', permissionLevel: 'siteOwner' }] });
      }
      if (url.includes('/searchAnalytics/query')) {
        const body = JSON.parse(String(init.body));
        if (!body.dimensions.length) return Response.json({ rows: [{ clicks: 12, impressions: 240, ctr: 0.05, position: 4.2 }] });
        if (body.dimensions[0] === 'query') return Response.json({ rows: [{ keys: ['geoscore'], clicks: 8, impressions: 100, ctr: 0.08, position: 2.5 }] });
        return Response.json({ rows: [{ keys: ['https://geo.sayori.org/'], clicks: 10, impressions: 180, ctr: 0.055, position: 3.1 }] });
      }
      if (url.includes('/urlInspection/index:inspect')) {
        return Response.json({ inspectionResult: { indexStatusResult: {
          verdict: 'PASS',
          coverageState: 'Submitted and indexed',
          pageFetchState: 'SUCCESSFUL',
          googleCanonical: 'https://geo.sayori.org/',
        } } });
      }
      throw new Error('Unexpected fetch: ' + url);
    };

    const callback = await handleAdmin(new Request(
      'https://geo-api.sayori.org/api/admin/gsc/callback?state=' + state + '&code=one-time',
      { headers },
    ), current);
    assert.equal(callback.status, 302);
    assert.match(callback.headers.get('Location'), /gsc=connected/);
    assert.ok(current.DB.gscConnection.refresh_token_ciphertext);
    assert.doesNotMatch(current.DB.gscConnection.refresh_token_ciphertext, /never-store-me/);

    const properties = await handleAdmin(new Request('https://geo-api.sayori.org/api/admin/gsc/properties', { headers }), current);
    assert.deepEqual((await properties.json()).properties, [
      { site_url: 'sc-domain:sayori.org', permission_level: 'siteOwner' },
    ]);

    const performance = await handleAdmin(new Request(
      'https://geo-api.sayori.org/api/admin/gsc/performance?site_url=sc-domain%3Asayori.org&days=28',
      { headers },
    ), current);
    const performanceBody = await performance.json();
    assert.equal(performanceBody.totals.clicks, 12);
    assert.equal(performanceBody.top_queries[0].query, 'geoscore');
    assert.equal(performanceBody.top_pages[0].page, 'https://geo.sayori.org/');

    const invalid = await handleAdmin(new Request('https://geo-api.sayori.org/api/admin/gsc/inspect', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_url: 'sc-domain:sayori.org', inspection_url: 'https://example.com/' }),
    }), current);
    assert.equal(invalid.status, 400);

    const inspected = await handleAdmin(new Request('https://geo-api.sayori.org/api/admin/gsc/inspect', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_url: 'sc-domain:sayori.org', inspection_url: 'https://geo.sayori.org/' }),
    }), current);
    assert.equal((await inspected.json()).index.verdict, 'PASS');
  });

  it('keeps URL-prefix inspection inside the selected path boundary', async () => {
    assert.equal(inspectionUrlBelongsToProperty('https://example.com/docs', 'https://example.com/docs/start'), true);
    assert.equal(inspectionUrlBelongsToProperty('https://example.com/docs', 'https://example.com/docs2'), false);
  });

  it('reports a missing Search Console migration instead of a false disconnected state', async () => {
    const current = env({
      DB: { prepare() { throw new Error('no such table: google_search_console_connections'); } },
    });
    const response = await handleAdmin(new Request('https://geo-api.sayori.org/api/admin/gsc/status', {
      headers: { Authorization: 'Bearer owner-token' },
    }), current);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).storage_ready, false);
  });
});
