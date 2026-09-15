import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const root = path.resolve(import.meta.dirname, '..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-site-pass-'));
execFileSync(process.execPath, [
  path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
  '--target', 'ES2022', '--module', 'CommonJS', '--moduleResolution', 'node',
  '--lib', 'ES2022', '--types', '@cloudflare/workers-types', '--strict', '--skipLibCheck',
  '--outDir', outDir,
  'src/lib/site-pass.ts', 'src/lib/types.ts', 'src/lib/rate-limit.ts',
], { cwd: root, stdio: 'inherit' });
const require = createRequire(import.meta.url);
const { DEFAULT_AUDIT_LIMIT } = require(path.join(outDir, 'rate-limit.js'));
const { normalizePassDomain, hasActiveSitePass } = require(path.join(outDir, 'site-pass.js'));

test('free audit default limit is 2 per hour', () => {
  assert.equal(DEFAULT_AUDIT_LIMIT, 2);
});

test('normalizePassDomain strips www and lowercases', () => {
  assert.equal(normalizePassDomain('WWW.Example.COM'), 'example.com');
});

test('hasActiveSitePass follows pay.geo status payload', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ active: true, domain: 'example.com' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  try {
    assert.equal(await hasActiveSitePass({}, 'example.com'), true);
  } finally {
    globalThis.fetch = previous;
  }
});

test('wrangler free audit var is 2', () => {
  const wrangler = fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8');
  assert.match(wrangler, /"AUDIT_RATE_LIMIT_PER_HOUR": "2"/);
});

test('frontend download and monitor flows require Site Pass helpers', () => {
  const app = fs.readFileSync(path.join(root, 'frontend', 'app.js'), 'utf8');
  const monitoring = fs.readFileSync(path.join(root, 'frontend', 'monitoring.js'), 'utf8');
  const sitePass = fs.readFileSync(path.join(root, 'frontend', 'site-pass.js'), 'utf8');
  assert.match(app, /requirePass\?\.\('audit\.sitePass\.downloadLocked'\)/);
  assert.match(monitoring, /requirePass\?\.\('audit\.sitePass\.monitorLocked'\)/);
  assert.match(sitePass, /function requirePass/);
});
