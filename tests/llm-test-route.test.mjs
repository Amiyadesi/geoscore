import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const cacheDir = path.join('node_modules', '.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const tmpDir = fs.mkdtempSync(path.join(cacheDir, 'geoscore-llm-test-route-'));
fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"type":"commonjs"}\n');

execFileSync(
  process.execPath,
  [
    path.join('node_modules', 'typescript', 'bin', 'tsc'),
    '--target', 'ES2022',
    '--module', 'CommonJS',
    '--moduleResolution', 'node',
    '--lib', 'ES2022',
    '--types', '@cloudflare/workers-types',
    '--strict',
    '--skipLibCheck',
    '--outDir', tmpDir,
    'src/index.ts',
  ],
  { stdio: 'inherit' },
);

const require = createRequire(import.meta.url);
const worker = require(path.resolve(tmpDir, 'index.js')).default;

function makeEnv() {
  return {
    ADMIN_TOKEN: 'admin-test-token',
    OPENROUTER_API_KEY: 'openrouter-test-key',
    PUBLIC_APP_URL: 'https://geo.sayori.org',
    PUBLIC_API_URL: 'https://geo-api.sayori.org',
    ALLOWED_ORIGINS: '',
    AUDIT_KV: {
      async get() { return null; },
      async put() {},
    },
    AI: {
      async run() { throw new Error('Workers AI unavailable'); },
    },
  };
}

function makeApiEnv() {
  return {
    ...makeEnv(),
    API_KEY: 'api-test-key',
    API_BASE_URL: 'https://generic-api.example/v1',
    API_MODEL: 'generic-free-model',
    OPENROUTER_API_KEY: undefined,
  };
}

describe('LLM admin test route', () => {
  it('reports OpenRouter independently without requiring Groq', async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    globalThis.fetch = async (rawUrl, init) => {
      requests.push({ url: String(rawUrl), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' } }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    try {
      const denied = await worker.fetch(
        new Request('https://geo-api.sayori.org/api/llm-test'),
        makeEnv(),
        { waitUntil() {}, passThroughOnException() {} },
      );
      assert.equal(denied.status, 401);
      assert.equal(requests.length, 0);

      const response = await worker.fetch(
        new Request('https://geo-api.sayori.org/api/llm-test', {
          headers: { Authorization: 'Bearer admin-test-token' },
        }),
        makeEnv(),
        { waitUntil() {}, passThroughOnException() {} },
      );
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.configuration.external_api_configured, false);
      assert.equal(body.internal_ai.ok, false);
      assert.equal(body.external_secondary.ok, false);
      assert.equal(body.external_reserve.ok, true);
      assert.doesNotMatch(JSON.stringify(body), /groq|openrouter/i);
      assert.equal(requests.length, 3);
      for (const request of requests) {
        assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions');
        assert.equal(request.headers.get('HTTP-Referer'), 'https://geo.sayori.org');
        assert.equal(request.headers.get('X-Title'), 'Sayori GeoScore');
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('reports generic API_KEY only through the admin diagnostic', async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    globalThis.fetch = async (rawUrl, init) => {
      requests.push({ url: String(rawUrl), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' } }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    try {
      const response = await worker.fetch(
        new Request('https://geo-api.sayori.org/api/llm-test', {
          headers: { Authorization: 'Bearer admin-test-token' },
        }),
        makeApiEnv(),
        { waitUntil() {}, passThroughOnException() {} },
      );
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.configuration.external_api_configured, true);
      assert.equal(body.external_primary.ok, true);
      assert.equal(body.external_secondary.ok, false);
      assert.equal(body.external_reserve.ok, false);
      assert.doesNotMatch(JSON.stringify(body), /groq|openrouter/i);
      assert.equal(requests.length, 3);
      for (const request of requests) {
        assert.equal(request.url, 'https://generic-api.example/v1/chat/completions');
        assert.equal(request.headers.get('Authorization'), 'Bearer api-test-key');
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
