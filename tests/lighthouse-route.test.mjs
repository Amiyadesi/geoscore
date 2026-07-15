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

async function lighthouseResponse(overrides = {}, search = '') {
  const response = await worker.fetch(
    new Request(`https://geo-api.sayori.org/api/lighthouse?domain=blog.sayori.org${search}`),
    env(overrides),
    { waitUntil() {}, passThroughOnException() {} },
  );
  return { response, body: await response.json() };
}

function auditDatabase(initialAudit) {
  const state = { audit: structuredClone(initialAudit), updates: 0 };
  return {
    state,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              assert.match(sql, /SELECT full_json FROM audits/);
              return { full_json: JSON.stringify(state.audit) };
            },
            async run() {
              assert.match(sql, /UPDATE audits SET foundation_score/);
              state.audit = JSON.parse(values[2]);
              state.updates += 1;
              return { success: true };
            },
          };
        },
      };
    },
  };
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

  it('persists PageSpeed checks and recomputes an evidence audit when audit_id is provided', async () => {
    const auditId = '01JGEOSCORE2LIGHTHOUSE01';
    const database = auditDatabase({
      audit_id: auditId,
      domain: 'blog.sayori.org',
      score_version: '2.2.0',
      audit_context: {
        site_archetype: 'personal_blog',
        industry_vertical: 'technology',
        business_model: 'content',
        entity: { name: 'Amiya', type: 'Person', source: 'json_ld' },
        locality: null,
        locale: 'en',
        root_domain: 'sayori.org',
        page_types: ['home'],
        confidence: 0.95,
        evidence: [],
      },
      pages_audited: [{ url: 'https://blog.sayori.org/', page_type: 'home', status: 'complete' }],
      checks: [
        { id: 'seo.title', category: 'seo', title: 'Page title', localized_title: { en: 'Page title', zh: '页面标题' }, status: 'pass', severity: 'major', weight: 2, confidence: 1, source: 'technical_seo', evidence: ['title present'] },
        { id: 'seo.lab_performance', category: 'seo', title: 'PageSpeed lab performance', localized_title: { en: 'PageSpeed lab performance', zh: 'PageSpeed 实验室性能' }, status: 'unknown', severity: 'major', weight: 2, confidence: 0, source: 'Google PageSpeed Insights API', evidence: [] },
        { id: 'seo.lab_lcp', category: 'seo', title: 'Lab performance: LCP', localized_title: { en: 'Lab performance: LCP', zh: '实验室性能：LCP' }, status: 'unknown', severity: 'major', weight: 2, confidence: 0, source: 'Google PageSpeed Insights API', evidence: [] },
        { id: 'seo.lab_cls', category: 'seo', title: 'Lab performance: CLS', localized_title: { en: 'Lab performance: CLS', zh: '实验室性能：CLS' }, status: 'unknown', severity: 'major', weight: 2, confidence: 0, source: 'Google PageSpeed Insights API', evidence: [] },
        { id: 'seo.lab_tbt', category: 'seo', title: 'Lab performance: TBT', localized_title: { en: 'Lab performance: TBT', zh: '实验室性能：TBT' }, status: 'unknown', severity: 'minor', weight: 1, confidence: 0, source: 'Google PageSpeed Insights API', evidence: [] },
        { id: 'geo.entity_identity', category: 'geo', title: 'Entity identity clarity', localized_title: { en: 'Entity identity clarity', zh: '实体身份清晰度' }, status: 'pass', severity: 'major', weight: 3, confidence: 1, source: 'json_ld', evidence: ['Person: Amiya'] },
      ],
      modules: {},
      recommendations_v2: [],
    });

    await withFetchMock(async rawUrl => {
      const strategy = new URL(String(rawUrl)).searchParams.get('strategy');
      return new Response(JSON.stringify(psiBody(strategy === 'mobile' ? 0.72 : 0.93, strategy === 'mobile' ? 900 : 0)), { status: 200 });
    }, async () => {
      const { response, body } = await lighthouseResponse(
        { DB: database },
        `&audit_id=${auditId}`,
      );
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.audit_update.audit_id, auditId);
      assert.equal(database.state.updates, 1);
      assert.equal(database.state.audit.modules.lighthouse.status, 'ok');
      const checks = Object.fromEntries(database.state.audit.normalized_checks.map(item => [item.id, item]));
      assert.equal(checks['seo.lab_performance'].status, 'fail');
      assert.equal(checks['seo.lab_lcp'].status, 'fail');
      assert.equal(checks['seo.lab_cls'].status, 'pass');
      assert.equal(checks['seo.lab_tbt'].status, 'fail');
      assert.ok(database.state.audit.score_summary.seo.score < 100);
      assert.equal(database.state.audit.score_summary.seo.cap, 79);
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
