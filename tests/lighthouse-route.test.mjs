import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const cacheDir = path.join('node_modules', '.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const tmpDir = fs.mkdtempSync(path.join(cacheDir, 'geoscore-lighthouse-route-'));
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

function env(overrides = {}) {
  return {
    PAGESPEED_API_KEY: 'invalid-test-key',
    PUBLIC_APP_URL: 'https://geo.sayori.org',
    PUBLIC_API_URL: 'https://geo-api.sayori.org',
    ALLOWED_ORIGINS: '',
    ...overrides,
  };
}

function psiBody(score, metricOffset = 0) {
  return {
    lighthouseResult: {
      categories: { performance: { score } },
      audits: {
        'largest-contentful-paint': { numericValue: 2100 + metricOffset },
        'cumulative-layout-shift': { numericValue: 0.05 },
        'first-contentful-paint': { numericValue: 1200 + metricOffset },
        'total-blocking-time': { numericValue: 180 + metricOffset },
        'speed-index': { numericValue: 1700 + metricOffset },
      },
    },
  };
}

async function withFetchMock(mock, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function lighthouseResponse(overrides = {}) {
  const response = await worker.fetch(
    new Request('https://geo-api.sayori.org/api/lighthouse?domain=blog.sayori.org'),
    env(overrides),
    { waitUntil() {}, passThroughOnException() {} },
  );
  return { response, body: await response.json() };
}

describe('Lighthouse API route', () => {
  it('returns complete numeric mobile and desktop results', async () => {
    await withFetchMock(async rawUrl => {
      const strategy = new URL(String(rawUrl)).searchParams.get('strategy');
      return new Response(JSON.stringify(psiBody(strategy === 'mobile' ? 0.82 : 0.95)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }, async () => {
      const { response, body } = await lighthouseResponse();
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.data.status, 'complete');
      assert.equal(body.data.mobile.status, 'complete');
      assert.equal(body.data.desktop.status, 'complete');
      assert.equal(body.data.mobile_score, 82);
      assert.equal(body.data.desktop_score, 95);
      assert.equal(body.data.score, 87);
    });
  });

  it('returns a partial success when one strategy fails', async () => {
    await withFetchMock(async rawUrl => {
      const strategy = new URL(String(rawUrl)).searchParams.get('strategy');
      if (strategy === 'mobile') {
        return new Response(JSON.stringify(psiBody(0.84)), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { message: 'Quota exceeded for quota metric' } }), { status: 429 });
    }, async () => {
      const { response, body } = await lighthouseResponse();
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.data.status, 'partial');
      assert.equal(body.data.mobile.score, 84);
      assert.equal(body.data.desktop.status, 'error');
      assert.equal(body.data.desktop.error.code, 'PAGESPEED_QUOTA_EXCEEDED');
      assert.equal(body.data.score, 84);
    });
  });

  it('returns a structured non-2xx error when both PageSpeed strategies reject the key', async () => {
    await withFetchMock(async () => new Response(JSON.stringify({
      error: {
        code: 400,
        message: 'API key not valid. Please pass a valid API key.',
        status: 'INVALID_ARGUMENT',
      },
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }), async () => {
      const { response, body } = await lighthouseResponse();
      assert.equal(response.status, 503);
      assert.equal(body.ok, false);
      assert.equal(body.error.code, 'PAGESPEED_AUTH_ERROR');
      assert.equal(body.error.retryable, false);
      assert.match(body.error.message, /API key not valid/);
      assert.equal(body.data, undefined);
      assert.equal(body.strategies.length, 2);
    });
  });

  it('returns a retryable quota error when both strategies are rate limited', async () => {
    await withFetchMock(async () => new Response(JSON.stringify({
      error: { message: 'Quota exceeded for quota metric pagespeedonline.googleapis.com/default' },
    }), { status: 429 }), async () => {
      const { response, body } = await lighthouseResponse();
      assert.equal(response.status, 503);
      assert.equal(body.error.code, 'PAGESPEED_QUOTA_EXCEEDED');
      assert.equal(body.error.retryable, true);
      assert.equal(body.strategies.every(item => item.status === 'error'), true);
    });
  });

  it('returns a retryable timeout error when both upstream calls time out', async () => {
    await withFetchMock(async () => { throw new DOMException('Request timed out', 'TimeoutError'); }, async () => {
      const { response, body } = await lighthouseResponse();
      assert.equal(response.status, 502);
      assert.equal(body.error.code, 'PAGESPEED_TIMEOUT');
      assert.equal(body.error.retryable, true);
    });
  });

  it('rejects HTTP 200 responses without a performance score', async () => {
    await withFetchMock(async () => new Response(JSON.stringify({
      lighthouseResult: { categories: { seo: { score: 1 } }, audits: {} },
    }), { status: 200 }), async () => {
      const { response, body } = await lighthouseResponse();
      assert.equal(response.status, 502);
      assert.equal(body.error.code, 'PAGESPEED_INVALID_RESPONSE');
      assert.match(body.error.message, /performance score/i);
    });
  });

  it('rejects malformed PageSpeed JSON as an invalid response', async () => {
    await withFetchMock(async () => new Response('{not-json', { status: 200 }), async () => {
      const { response, body } = await lighthouseResponse();
      assert.equal(response.status, 502);
      assert.equal(body.error.code, 'PAGESPEED_INVALID_RESPONSE');
      assert.match(body.error.message, /malformed JSON/i);
    });
  });

  it('rejects invalid audit mode, cross-root URL targets, and unknown archetype hints', async () => {
    const calls = [
      'https://geo-api.sayori.org/api/audit/blog.sayori.org?mode=all',
      'https://geo-api.sayori.org/api/audit/blog.sayori.org?mode=url&url=https%3A%2F%2Fexample.net%2Fpost',
      'https://geo-api.sayori.org/api/audit/blog.sayori.org?archetype_hint=saas-ish',
    ];
    for (const target of calls) {
      const response = await worker.fetch(new Request(target), env(), { waitUntil() {}, passThroughOnException() {} });
      assert.equal(response.status, 400, target);
    }
  });
});
