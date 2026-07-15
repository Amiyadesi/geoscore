import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { afterEach, describe, it } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-answer-models-'));
fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"type":"commonjs"}\n');
fs.symlinkSync(path.resolve('node_modules'), path.join(tmpDir, 'node_modules'), 'junction');

execFileSync(process.execPath, [
  path.join('node_modules', 'typescript', 'bin', 'tsc'),
  '--target', 'ES2022',
  '--module', 'CommonJS',
  '--moduleResolution', 'node',
  '--lib', 'ES2022',
  '--types', '@cloudflare/workers-types',
  '--strict',
  '--skipLibCheck',
  '--rootDir', 'src',
  '--outDir', tmpDir,
  'src/routes/answer-models.ts',
  'src/lib/search-gateway.ts',
  'src/lib/query-evidence.ts',
  'src/lib/security.ts',
  'src/lib/types.ts',
], { stdio: 'inherit' });

const require = createRequire(import.meta.url);
const { handleAnswerModels } = require(path.join(tmpDir, 'routes', 'answer-models.js'));
const { requestAnswerModels } = require(path.join(tmpDir, 'lib', 'search-gateway.js'));

const API_KEY = 'request-scoped-answer-key-value';
const API_BASE_URL = 'https://api.example.com/v1';
const env = {
  SEARCH_GATEWAY_URL: 'https://gateway.example.com/base-path',
  SEARCH_GATEWAY_API_KEY: 'gateway-server-secret',
};

afterEach(() => {
  delete globalThis.__answerModelsFetch;
});

describe('request-scoped answer model listing', () => {
  it('uses the fixed gateway path and returns only bounded unique model IDs', async () => {
    const originalFetch = globalThis.fetch;
    let captured;
    globalThis.fetch = async (url, init = {}) => {
      captured = { url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) };
      return Response.json({
        success: true,
        models: ['model-a', 'model-a', 'org/model-b', '', 'x'.repeat(201)],
        api_base_url: API_BASE_URL,
        ownership: { secret: API_KEY },
      });
    };
    try {
      const result = await requestAnswerModels(env, { apiKey: API_KEY, apiBaseUrl: API_BASE_URL });

      assert.equal(result.status, 'complete');
      assert.deepEqual(result.models, ['model-a', 'org/model-b']);
      assert.equal(captured.url, 'https://gateway.example.com/v1/answer-models');
      assert.equal(captured.headers.get('X-Answer-API-Key'), API_KEY);
      assert.equal(captured.headers.get('X-API-Key'), 'gateway-server-secret');
      assert.deepEqual(captured.body, { api_base_url: API_BASE_URL });
      assert.doesNotMatch(JSON.stringify(result), new RegExp(API_KEY));
      assert.doesNotMatch(JSON.stringify(result), new RegExp(API_BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('exposes a public provider-neutral route and rejects incomplete or unsafe config before proxying', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return Response.json({ success: true, models: [] }); };
    try {
      const cases = [
        { headers: {}, body: { api_base_url: API_BASE_URL } },
        { headers: { 'X-API-Key': API_KEY }, body: {} },
        { headers: { 'X-API-Key': API_KEY }, body: { api_base_url: 'http://api.example.com/v1' } },
        { headers: { 'X-API-Key': API_KEY }, body: { api_base_url: 'https://127.0.0.1/v1' } },
        { headers: { 'X-API-Key': API_KEY }, body: { api_base_url: API_BASE_URL, api_key: 'misplaced-secret' } },
      ];
      for (const item of cases) {
        const response = await handleAnswerModels(new Request('https://geo-api.example/api/answer-models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...item.headers },
          body: JSON.stringify(item.body),
        }), env);
        const text = await response.text();
        assert.equal(response.status, 400);
        assert.doesNotMatch(text, /request-scoped-answer-key-value|api\.example\.com|misplaced-secret/);
      }
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns sanitized stable errors without echoing upstream bodies or request config', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
      success: false,
      error: `rejected ${API_KEY} at ${API_BASE_URL}`,
      detail: { code: 'ANSWER_API_AUTH_ERROR', retryable: false, credential: API_KEY },
      code: 'ANSWER_API_AUTH_ERROR',
      retryable: false,
    }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    try {
      const response = await handleAnswerModels(new Request('https://geo-api.example/api/answer-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify({ api_base_url: API_BASE_URL }),
      }), env);
      const text = await response.text();
      const body = JSON.parse(text);

      assert.equal(response.status, 401);
      assert.equal(body.error.code, 'ANSWER_API_AUTH_ERROR');
      assert.equal(body.error.retryable, false);
      assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message', 'retryable']);
      assert.doesNotMatch(text, new RegExp(API_KEY));
      assert.doesNotMatch(text, /api\.example\.com|credential/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('is wired through the shared search limiter rather than a generic proxy', () => {
    const source = fs.readFileSync('src/index.ts', 'utf8');
    assert.match(source, /pathname === '\/api\/answer-models'/);
    assert.match(source, /searchRateLimit\(env, ip\)/);
    assert.match(source, /handleAnswerModels\(req, env\)/);
    assert.doesNotMatch(source, /\/api\/proxy|client_endpoint/i);
  });
});
