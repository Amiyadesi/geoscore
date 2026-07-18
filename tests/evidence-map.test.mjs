import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-evidence-map-'));
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
  'src/routes/evidence-map.ts',
  'src/lib/search-gateway.ts',
  'src/lib/query-evidence.ts',
  'src/lib/audit-core.ts',
  'src/lib/audit-pages.ts',
  'src/lib/types.ts',
], { stdio: 'inherit' });

const require = createRequire(import.meta.url);
const { handleEvidenceMap } = require(path.join(tmpDir, 'routes', 'evidence-map.js'));
const { requestEvidenceSearch } = require(path.join(tmpDir, 'lib', 'search-gateway.js'));
const { planEvidenceQueries } = require(path.join(tmpDir, 'lib', 'query-evidence.js'));

const AUDIT_ID = '01JGEOSCORE23EVIDENCEMAP';
const SCORE_SUMMARY = {
  score_version: '2.2.0',
  seo: { score: 72, coverage: 0.8 },
  geo: { score: 68, coverage: 0.75 },
  overall: { score: 70, coverage: 0.78 },
};

function storedAudit() {
  return {
    audit_id: AUDIT_ID,
    domain: 'blog.sayori.org',
    score_version: '2.2.0',
    audit_context: {
      site_archetype: 'personal_blog',
      industry_vertical: 'technology',
      business_model: 'content',
      entity: { name: 'Sayori', type: 'Person', source: 'json_ld' },
      locality: null,
      locale: 'en-US',
      root_domain: 'sayori.org',
      page_types: ['home', 'about', 'article'],
      confidence: 0.95,
      evidence: [],
    },
    pages_audited: [
      { url: 'https://blog.sayori.org/', final_url: 'https://blog.sayori.org/', page_type: 'home', status: 'complete' },
      { url: 'https://blog.sayori.org/posts/evidence', final_url: 'https://blog.sayori.org/posts/evidence', page_type: 'article', status: 'complete' },
    ],
    checks: [{ id: 'seo.title', status: 'pass' }],
    normalized_checks: [{ id: 'seo.title', status: 'pass' }],
    score_summary: structuredClone(SCORE_SUMMARY),
    seo_score: 72,
    geo_score: 68,
    overall_score: 70,
  };
}

function gatewayBody({ partial = false, degraded = false } = {}) {
  return {
    evidence_version: 'evidence-v1',
    request_id: 'evs_test',
    query_plan: {
      queries: ['Sayori blog articles', 'Sayori technology articles', 'blog.sayori.org article archive'],
      locale: 'en-US',
    },
    results: [
      {
        source_id: 'src_target',
        query: 'Sayori technology articles',
        matched_queries: ['Sayori technology articles'],
        provider: 'source-a',
        providers: ['source-a'],
        provider_rank: 2,
        provider_ranks: { 'source-a': 2 },
        url: 'https://blog.sayori.org/posts/evidence',
        canonical_url: 'https://blog.sayori.org/posts/evidence',
        title: 'Evidence article',
        snippet: 'An article about evidence-first audits.',
        retrieved_at: '2026-07-15T00:00:00Z',
        registrable_domain: 'sayori.org',
        fusion_score: 0.016,
        rerank_score: null,
        extract_status: 'complete',
        content_hash: 'sha256:test',
      },
      {
        source_id: 'src_external',
        query: 'Sayori blog articles',
        matched_queries: ['Sayori blog articles'],
        provider: 'source-b',
        providers: ['source-b'],
        provider_rank: 1,
        provider_ranks: { 'source-b': 1 },
        url: 'https://docs.example.com/evidence',
        canonical_url: 'https://docs.example.com/evidence',
        title: 'External evidence guide',
        snippet: 'A competing guide.',
        retrieved_at: '2026-07-15T00:00:00Z',
        registrable_domain: 'example.com',
        fusion_score: 0.017,
        rerank_score: null,
        extract_status: 'not_requested',
      },
    ],
    provider_runs: [
      { provider: 'source-a', query: 'Sayori technology articles', status: 'complete', latency_ms: 100, result_count: 1, cache_hit: false, error: null },
      { provider: 'source-b', query: 'Sayori blog articles', status: 'complete', latency_ms: 120, result_count: 1, cache_hit: true, error: null },
    ],
    usage: { provider_calls: 2, extract_pages: 1, cache_hits: 1, estimated_credits: 2, elapsed_ms: 300 },
    partial,
    degraded,
    errors: [],
  };
}

function answerBody(model = 'configured-default', echo = '') {
  return {
    success: true,
    snapshot_version: '1.0.0',
    request_id: echo ? `ans_${echo}` : 'ans_test',
    observed_at: '2026-07-15T00:00:00Z',
    api_id: 'api',
    model,
    observations: [{
      query: 'Sayori blog articles',
      status: 'complete',
      api_id: 'api',
      model,
      answer: echo ? `answer ${echo}` : 'A dated API answer observation.',
      citations: [],
      observed_at: '2026-07-15T00:00:00Z',
      latency_ms: 10,
      error: null,
    }],
    usage: { api_calls: 1, successful_calls: 1, elapsed_ms: 10, provider_usage: {} },
    partial: false,
    degraded: false,
    zero_persistence: true,
    limitations: [echo ? `limitation ${echo}` : 'API-only observation.'],
    errors: [],
  };
}

function database(initialAudit = storedAudit()) {
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
              assert.match(sql, /UPDATE audits SET full_json/);
              state.audit = JSON.parse(values[0]);
              state.updates += 1;
              return { success: true };
            },
          };
        },
      };
    },
  };
}

function env(db = database(), overrides = {}) {
  return {
    DB: db,
    SEARCH_GATEWAY_URL: 'https://gateway.example.com/base-path',
    SEARCH_GATEWAY_API_KEY: 'server-secret-value',
    ...overrides,
  };
}

describe('Search Gateway Evidence v1 client and Evidence Map route', () => {
  it('posts only to the fixed Evidence v1 path with bounded server-owned settings', async () => {
    const originalFetch = globalThis.fetch;
    let captured;
    globalThis.fetch = async (url, options) => {
      captured = { url: String(url), options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify(gatewayBody()), { status: 200 });
    };
    try {
      const plan = planEvidenceQueries(storedAudit().audit_context);
      const result = await requestEvidenceSearch(env(), plan, {
        maxProviderCalls: 99,
        maxExtractPages: 99,
        maxResults: 99,
      });
      assert.equal(result.status, 'complete');
      assert.equal(captured.url, 'https://gateway.example.com/v1/evidence-search');
      assert.equal(captured.options.method, 'POST');
      assert.equal(captured.options.headers.Authorization, 'Bearer server-secret-value');
      assert.equal(captured.body.budget.max_provider_calls, 2);
      assert.equal(captured.body.budget.max_extract_pages, 5);
      assert.equal(captured.body.max_results, 8);
      assert.equal(captured.body.queries.length, 3);
      assert.equal('extract' in captured.body, false);
      assert.equal(captured.body.rerank, false);
      assert.doesNotMatch(JSON.stringify(captured.body), /server-secret-value/);
      assert.doesNotMatch(JSON.stringify(result), /server-secret-value/);

      const defaultResult = await requestEvidenceSearch(env(), plan);
      assert.equal(defaultResult.status, 'complete');
      assert.equal(captured.body.budget.max_provider_calls, 1);
      assert.equal(captured.body.budget.max_extract_pages, 0);
      assert.equal(captured.body.rerank, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('distinguishes partial, unavailable, auth, and malformed evidence states', async () => {
    const plan = planEvidenceQueries(storedAudit().audit_context);
    const unavailable = await requestEvidenceSearch(env(database(), {
      SEARCH_GATEWAY_URL: '',
      SEARCH_GATEWAY_API_KEY: '',
    }), plan);
    assert.equal(unavailable.status, 'unavailable');
    assert.equal(unavailable.error.code, 'GATEWAY_NOT_CONFIGURED');

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response(JSON.stringify(gatewayBody({ partial: true })), { status: 200 });
      assert.equal((await requestEvidenceSearch(env(), plan)).status, 'partial');

      globalThis.fetch = async () => new Response('credential server-secret-value rejected', { status: 401 });
      const auth = await requestEvidenceSearch(env(), plan);
      assert.equal(auth.error.code, 'GATEWAY_AUTH_ERROR');
      assert.doesNotMatch(JSON.stringify(auth), /server-secret-value/);

      globalThis.fetch = async () => new Response('{malformed', { status: 200 });
      assert.equal((await requestEvidenceSearch(env(), plan)).error.code, 'GATEWAY_INVALID_RESPONSE');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('persists a provenance-rich map without changing factual scores or checks', async () => {
    const db = database();
    const beforeScores = structuredClone(db.state.audit.score_summary);
    const beforeChecks = structuredClone(db.state.audit.normalized_checks);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => String(url).endsWith('/v1/evidence-search')
      ? Response.json(gatewayBody())
      : Response.json(answerBody());
    try {
      const response = await handleEvidenceMap(
        new Request(`https://geo-api.sayori.org/api/audits/${AUDIT_ID}/evidence-map`, { method: 'POST' }),
        AUDIT_ID,
        env(db),
      );
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.data.snapshot_version, '1.0.0');
      assert.equal(body.data.affects_score, false);
      assert.equal(body.data.target.appearances, 1);
      assert.deepEqual(body.data.target.mapped_pages, ['https://blog.sayori.org/posts/evidence']);
      assert.equal(body.data.sources[0].provider, 'source-a');
      assert.equal(body.data.sources[0].source_type, 'audited_site');
      assert.equal(body.data.sources[1].source_type, 'documentation');
      assert.equal(body.data.answer_snapshot.observations[0].model, 'configured-default');
      assert.equal(body.data.answer_snapshot.observations[0].provider, 'api');
      assert.deepEqual(body.data.diagnosis.map(item => item.stage).sort(), [
        'attribution', 'discovery', 'fetch', 'parse', 'retrieval', 'selection',
      ]);
      assert.equal(db.state.updates, 1);
      assert.deepEqual(db.state.audit.score_summary, beforeScores);
      assert.deepEqual(db.state.audit.normalized_checks, beforeChecks);
      assert.equal(db.state.audit.overall_score, 70);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('stores an explicit unavailable snapshot instead of inventing zero visibility', async () => {
    const db = database();
    const response = await handleEvidenceMap(
      new Request(`https://geo-api.sayori.org/api/audits/${AUDIT_ID}/evidence-map`, { method: 'POST' }),
      AUDIT_ID,
      env(db, { SEARCH_GATEWAY_URL: '', SEARCH_GATEWAY_API_KEY: '' }),
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.status, 'unavailable');
    assert.equal(body.data.gateway_error.code, 'GATEWAY_NOT_CONFIGURED');
    assert.equal(body.data.target.appearances, 0);
    assert.equal(body.data.affects_score, false);
    assert.equal(db.state.audit.overall_score, 70);
  });

  it('forwards complete request-scoped answer config once without persisting the key or base URL', async () => {
    const db = database();
    const apiKey = 'request-scoped-evidence-key-value';
    const apiBaseUrl = 'https://api.example.com/v1';
    const apiModel = 'org/custom-model';
    const captured = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      captured.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) });
      if (String(url).endsWith('/v1/evidence-search')) return Response.json(gatewayBody());
      return Response.json(answerBody(apiModel, `${apiKey} ${apiBaseUrl}`));
    };
    try {
      const response = await handleEvidenceMap(new Request(
        `https://geo-api.sayori.org/api/audits/${AUDIT_ID}/evidence-map`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
          body: JSON.stringify({ api_base_url: apiBaseUrl, api_model: apiModel }),
        },
      ), AUDIT_ID, env(db));
      const responseText = await response.text();
      const body = JSON.parse(responseText);
      const searchCall = captured.find(call => call.url.endsWith('/v1/evidence-search'));
      const answerCall = captured.find(call => call.url.endsWith('/v1/answer-snapshots'));

      assert.equal(response.status, 200);
      assert.equal(searchCall.body.queries.length, 3);
      assert.equal(answerCall.headers.get('X-Answer-API-Key'), apiKey);
      assert.equal(answerCall.body.api_base_url, apiBaseUrl);
      assert.equal(answerCall.body.api_model, apiModel);
      assert.deepEqual(answerCall.body.queries, ['Sayori blog articles']);
      assert.equal('budget' in answerCall.body, false);
      assert.equal(body.data.affects_score, false);
      assert.equal(body.data.answer_snapshot.observations[0].model, apiModel);
      assert.deepEqual(body.score_summary, SCORE_SUMMARY);
      assert.doesNotMatch(responseText, new RegExp(apiKey));
      assert.doesNotMatch(responseText, /api\.example\.com/);
      assert.doesNotMatch(JSON.stringify(db.state.audit), new RegExp(apiKey));
      assert.doesNotMatch(JSON.stringify(db.state.audit), /api\.example\.com/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('preserves a safe custom-answer failure from the gateway response', async () => {
    const db = database();
    const apiKey = 'request-scoped-evidence-key-value';
    const apiBaseUrl = 'https://api.example.com/v1';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async url => String(url).endsWith('/v1/evidence-search')
      ? Response.json(gatewayBody())
      : Response.json({
          success: false,
          observations: [{
            query: 'Sayori blog articles',
            status: 'error',
            error: {
              code: 'ANSWER_API_NO_FINAL_CONTENT',
              scope: 'answer_api',
              retryable: false,
              message: 'private upstream detail',
            },
          }],
          errors: [{
            code: 'ANSWER_API_NO_FINAL_CONTENT',
            scope: 'answer_api',
            retryable: false,
            message: 'private upstream detail',
          }],
        }, { status: 502 });
    try {
      const response = await handleEvidenceMap(new Request(
        `https://geo-api.sayori.org/api/audits/${AUDIT_ID}/evidence-map`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
          body: JSON.stringify({ api_base_url: apiBaseUrl, api_model: 'reasoning-model' }),
        },
      ), AUDIT_ID, env(db));
      const responseText = await response.text();
      const body = JSON.parse(responseText);

      assert.equal(response.status, 200);
      assert.equal(body.data.answer_gateway_error.code, 'ANSWER_API_NO_FINAL_CONTENT');
      assert.equal(body.data.answer_gateway_error.retryable, false);
      assert.match(body.data.answer_gateway_error.message, /final answer/i);
      assert.doesNotMatch(responseText, /private upstream detail/);
      assert.doesNotMatch(responseText, new RegExp(apiKey));
      assert.doesNotMatch(responseText, /api\.example\.com/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects missing or partial custom answer config before calling providers', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return Response.json({}); };
    try {
      const cases = [
        { headers: { 'X-API-Key': 'request-scoped-key-value' }, body: {} },
        { headers: {}, body: { api_base_url: 'https://api.example.com/v1', api_model: 'model-a' } },
        { headers: { 'X-API-Key': 'request-scoped-key-value' }, body: { api_base_url: 'https://api.example.com/v1' } },
        { headers: { 'X-API-Key': 'request-scoped-key-value' }, body: { api_model: 'model-a' } },
      ];
      for (const item of cases) {
        const db = database();
        const response = await handleEvidenceMap(new Request(
          `https://geo-api.sayori.org/api/audits/${AUDIT_ID}/evidence-map`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...item.headers },
            body: JSON.stringify(item.body),
          },
        ), AUDIT_ID, env(db));
        const text = await response.text();
        assert.equal(response.status, 400);
        assert.match(text, /CUSTOM_API_CONFIG_INCOMPLETE/);
        assert.equal(db.state.updates, 0);
      }
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('wires the POST route in the Worker without exposing a generic gateway proxy', () => {
    const source = fs.readFileSync('src/index.ts', 'utf8');
    assert.match(source, /\/api\\\/audits\\\/\(\[\^\/\]\+\)\\\/evidence-map/);
    assert.match(source, /handleEvidenceMap\(req, decodeURIComponent/);
    assert.doesNotMatch(source, /client_base_url|gateway_base_url/i);
  });
});
