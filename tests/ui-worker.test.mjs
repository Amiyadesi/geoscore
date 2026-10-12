import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { afterEach, test } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-ui-worker-'));
fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"type":"commonjs"}\n');
execFileSync(process.execPath, [
  path.join('node_modules', 'typescript', 'bin', 'tsc'),
  '--target', 'ES2022',
  '--module', 'CommonJS',
  '--moduleResolution', 'node',
  '--lib', 'ES2022',
  '--types', '@cloudflare/workers-types',
  '--skipLibCheck',
  '--outDir', tmpDir,
  'ui-worker/index.ts',
], { stdio: 'inherit' });

const require = createRequire(import.meta.url);
const worker = require(path.join(tmpDir, 'index.js')).default;
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('UI worker maps the clean docs route to the static docs entrypoint', async () => {
  let upstreamUrl = '';
  globalThis.fetch = async request => {
    upstreamUrl = request instanceof Request ? request.url : String(request);
    return new Response('<h1>Docs</h1>', { headers: { 'Content-Type': 'text/html' } });
  };

  const response = await worker.fetch(
    new Request('https://geo.sayori.org/docs?lang=zh', { headers: { Accept: 'text/html' } }),
    { UPSTREAM_ORIGIN: 'https://sayori-geoscore.pages.dev' },
  );

  assert.equal(upstreamUrl, 'https://sayori-geoscore.pages.dev/docs/index.html?lang=zh');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-GeoScore-UI-Proxy'), 'sayori-geoscore-ui');
});

test('missing pages preserve the upstream 404 instead of becoming a soft 404', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('Not found', { status: 404 }); };
  const response = await worker.fetch(new Request('https://geo.sayori.org/missing', { headers: { Accept: 'text/html' } }), { UPSTREAM_ORIGIN: 'https://sayori-geoscore.pages.dev' });
  assert.equal(response.status, 404);
  assert.equal(calls, 1);
});
