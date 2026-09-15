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
  'src/routes/admin.ts', 'src/lib/security.ts', 'src/lib/admin-auth.ts', 'src/lib/types.ts',
], { stdio: 'inherit' });

const require = createRequire(import.meta.url);
const { handleAdmin } = require(path.join(tmpDir, 'routes', 'admin.js'));

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
  return {
    prepare(sql) {
      const statement = {
        bind() { return statement; },
        async first() {
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
});
