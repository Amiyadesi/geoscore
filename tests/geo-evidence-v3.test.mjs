import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-geo-evidence-v3-'));
fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"type":"commonjs"}\n');
fs.symlinkSync(path.resolve('node_modules'), path.join(tmpDir, 'node_modules'), 'junction');

execFileSync(
  process.execPath,
  [
    path.join('node_modules', 'typescript', 'bin', 'tsc'),
    '--target', 'ES2022',
    '--module', 'CommonJS',
    '--moduleResolution', 'node',
    '--esModuleInterop',
    '--lib', 'ES2022',
    '--types', '@cloudflare/workers-types',
    '--skipLibCheck',
    '--rootDir', 'src',
    '--outDir', tmpDir,
    'src/lib/audit-core.ts',
    'src/lib/audit-pages.ts',
    'src/lib/security.ts',
    'src/lib/cache.ts',
    'src/routes/audit.ts',
    'src/index.ts',
  ],
  { stdio: 'inherit' },
);

const require = createRequire(import.meta.url);
const core = require(path.join(tmpDir, 'lib', 'audit-core.js'));
const cache = require(path.join(tmpDir, 'lib', 'cache.js'));
const auditRoute = require(path.join(tmpDir, 'routes', 'audit.js'));
const worker = require(path.join(tmpDir, 'index.js'));

function auditPage(url, pageType, html) {
  return {
    url,
    final_url: url,
    page_type: pageType,
    source: 'requested',
    status: 'complete',
    title: html.match(/<title>([^<]+)/i)?.[1] ?? '',
    locale: html.match(/<html[^>]+lang=["']([^"']+)/i)?.[1] ?? 'en',
    html,
    headers: new Headers(),
    response_ms: 1,
    status_code: 200,
  };
}

const HOME_HTML = `<!doctype html><html lang="en"><head>
  <title>Ada Notes</title><meta property="og:site_name" content="Ada Notes">
  <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
    {"@type":"WebSite","name":"Ada Notes","url":"https://example.com/"},
    {"@type":"Blog","name":"Ada Notes"},
    {"@type":"Person","name":"Ada Lovelace","url":"https://example.com/about"}
  ]}</script></head><body><main><h1>Ada Notes</h1>
  <p>Technical essays, reproducible experiments, and source-backed notes about computing.</p>
  </main></body></html>`;

const ARTICLE_HTML = `<!doctype html><html lang="en"><head>
  <title>What is an evidence graph? | Ada Notes</title><meta property="og:site_name" content="Ada Notes">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"BlogPosting",
    "headline":"What is an evidence graph?","datePublished":"2026-06-01","dateModified":"2026-07-01",
    "author":{"@type":"Person","name":"Ada Lovelace","url":"https://example.com/about"}}
  </script></head><body><article><h1>What is an evidence graph?</h1>
  <p>An evidence graph connects each published claim to the source that supports it, so readers and machines can verify the answer directly.</p>
  <p>According to <a href="https://developers.google.com/search/docs">Google Search documentation</a>, structured evidence helps systems interpret a page; our sample retained 75% source coverage.</p>
  </article></body></html>`;

function baselineModules() {
  return {
    technical_seo: { status: 'ok', data: {
      page_meta: { title: 'Ada Notes', description: 'Evidence-backed technical essays.', canonical_url: 'https://example.com/', lang: 'en' },
      h1_tags: ['Ada Notes'], llms_txt_present: false, llms_txt_status: 'missing',
    } },
    content_quality: { status: 'ok', data: { has_noindex: false, word_count: 180, external_links: 1 } },
    schema_audit: { status: 'ok', data: { schemas_found: ['WebSite', 'Blog', 'Person', 'BlogPosting'], coverage: { Entity: true } } },
  };
}

describe('GEO Evidence v3 contract', () => {
  it('versions factual scoring and makes predicted checks score-inert', () => {
    assert.equal(core.SCORE_VERSION, '2.4.2');
    assert.match(cache.cacheKey('example.com'), /^recent:v21:/);

    const predicted = core.check({
      id: 'geo.predicted_test',
      category: 'geo',
      status: 'fail',
      weight: 99,
      confidence: 1,
      predicted: true,
    });
    assert.equal(predicted.weight, 0);

    const factual = core.check({ id: 'geo.fact', category: 'geo', status: 'pass', weight: 1 });
    const before = core.scoreChecks([factual]);
    const after = core.scoreChecks([factual, predicted]);
    assert.deepEqual(after, before);
  });

  it('exposes a stable factual check registry separate from predicted checks', () => {
    assert.ok(core.FACTUAL_CHECK_IDS.length > 27);
    assert.ok(core.FACTUAL_CHECK_IDS.includes('geo.claim_source_support'));
    assert.ok(core.FACTUAL_CHECK_IDS.includes('geo.statistic_provenance'));
    assert.ok(!core.FACTUAL_CHECK_IDS.includes('geo.predicted_citation'));
  });

  it('keeps the normalized output registry aligned with the factual contract', () => {
    const sampled = [auditPage('https://example.com/', 'home', HOME_HTML), auditPage('https://example.com/posts/evidence', 'article', ARTICLE_HTML)];
    const context = core.buildAuditContext({ domain: 'example.com', pages: sampled });
    const ids = core.buildNormalizedChecks(context, sampled, baselineModules()).map(item => item.id);
    assert.deepEqual(ids.filter(id => id !== 'geo.predicted_citation'), [...core.FACTUAL_CHECK_IDS]);
  });

  it('projects legacy AEO as factual GEO and isolates predicted visibility', () => {
    const summary = core.scoreChecks([
      core.check({ id: 'geo.fact', category: 'geo', status: 'pass', weight: 2 }),
      core.check({ id: 'geo.predicted_citation', category: 'geo', status: 'fail', weight: 99, predicted: true }),
    ]);
    const scores = auditRoute.projectLegacyScores(summary, {});
    assert.equal(scores.aeo_score, summary.geo.score);
    assert.equal(scores.legacy_score_metadata.aeo_score.deprecated, true);
    assert.equal(scores.legacy_score_metadata.aeo_score.projection, 'score_summary.geo.score');

    const predicted = auditRoute.buildPredictedVisibility({
      status: 'ok',
      data: {
        is_reliable: true,
        citation_rate: 0.5,
        avg_confidence: 0.7,
        queries: [{ query: 'what is Ada Notes?', cited: true, confidence: 0.7, reasoning: 'Evidence match' }],
      },
    }, 'en');
    assert.equal(predicted.predicted, true);
    assert.equal(predicted.affects_score, false);
    assert.equal(predicted.questions[0].predicted_citation, true);
    assert.equal(predicted.score_weight, 0);
  });

  it('keeps the Worker entry export surface compatible with the module runtime', () => {
    for (const [name, value] of Object.entries(worker)) {
      if (name === 'default') continue;
      assert.equal(
        typeof value,
        'function',
        `Worker named export ${name} must be a function or ExportedHandler`,
      );
    }
  });

  it('serves non-stale public product facts from /api/meta', async () => {
    const meta = worker.buildPublicMeta({ AUDIT_RATE_LIMIT_PER_HOUR: '11' });
    assert.equal(meta.version, '2.4.3');
    assert.equal(meta.score_version, '2.4.2');
    assert.equal(meta.snapshot_version, '1.0.0');
    assert.equal(meta.max_pages, 5);
    assert.deepEqual(meta.audit_modes, ['site', 'url']);
    assert.equal(meta.rate_limit.fresh_audits, 11);
    assert.equal(meta.checks.factual, core.FACTUAL_CHECK_IDS.length);
    assert.equal(meta.checks.scoring + meta.checks.informational, meta.checks.factual);
    assert.equal(meta.checks.predicted, 1);
    assert.equal(meta.scoring.severity_caps.critical, 49);
    assert.equal(meta.scoring.severity_caps.major, 79);
    assert.equal(meta.scoring.severity_caps.minor, 94);
    assert.deepEqual(meta.scoring.repeated_failure_caps, {
      critical: { step: 10, floor: 19 },
      major: { step: 10, floor: 49 },
    });
    assert.equal(meta.scoring.minimum_overall_coverage, 0.6);
    assert.equal(meta.scoring.minimum_overall_confidence, 0.5);
    assert.ok(meta.capabilities.optional_modules_not_run.includes('broken_links'));
    assert.equal(meta.capabilities.full_markdown_repair_report, true);
    assert.equal(meta.capabilities.lighthouse_score_merge, true);
    assert.equal(meta.limits.evidence_queries_per_project, 3);
    assert.equal(meta.limits.search_providers_per_query, 2);
    assert.equal(meta.limits.answer_providers_per_run, 1);
    assert.equal(meta.limits.monitoring_schedule, 'weekly');
    assert.equal(meta.limits.retained_snapshots, 12);
    assert.equal(meta.capabilities.query_evidence_map, true);
    assert.equal(meta.capabilities.accountless_monitoring, true);
    assert.equal(meta.capabilities.request_scoped_api_key, true);
    assert.equal(meta.capabilities.api_key_persistence, 'none');
    assert.equal(meta.capabilities.consumer_ai_citation_monitoring, false);
    assert.doesNotMatch(JSON.stringify(meta), /chatgpt|perplexity|google_ai/i);

    const env = { AUDIT_RATE_LIMIT_PER_HOUR: '11' };
    const response = await worker.default.fetch(new Request('https://geo-api.example/api/meta'), env, {});
    assert.equal(response.status, 200);
    assert.equal((await response.json()).score_version, '2.4.2');

    const openapiResponse = await worker.default.fetch(new Request('https://geo-api.example/openapi.json'), env, {});
    assert.equal(openapiResponse.status, 200);
    const openapi = await openapiResponse.json();
    assert.equal(openapi.info.version, '2.4.3');
    assert.equal(openapi.paths['/api/audit/{domain}'].get.responses['200'].description.length > 0, true);
    assert.ok(openapi.components.securitySchemes.ProjectToken);
    assert.ok(openapi.components.securitySchemes.RequestApiKey);
  });

  it('keeps public metadata provider-neutral and deletes the requested cache scope', async () => {
    const meta = JSON.stringify(worker.buildPublicMeta({ AUDIT_RATE_LIMIT_PER_HOUR: '8' }));
    assert.doesNotMatch(meta, /groq|openrouter|llama|chatgpt|perplexity|google_ai|api_base_url|api_model/i);

    const deleted = [];
    const env = {
      ADMIN_TOKEN: 'admin-test-token',
      AUDIT_KV: { async delete(key) { deleted.push(key); } },
    };
    const response = await worker.default.fetch(new Request(
      'https://geo-api.example/api/audit/blog.example.com/cache?mode=url&url=https%3A%2F%2Fblog.example.com%2Fposts%2Fone&archetype_hint=personal_blog',
      { method: 'DELETE', headers: { Authorization: 'Bearer admin-test-token' } },
    ), env, {});
    assert.equal(response.status, 200);
    assert.deepEqual(deleted, [cache.cacheKey('blog.example.com', {
      mode: 'url',
      targetUrl: 'https://blog.example.com/posts/one',
      archetypeHint: 'personal_blog',
    })]);

    const retiredMonitor = await worker.default.fetch(new Request(
      'https://geo-api.example/api/monitor',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    ), {}, {});
    assert.equal(retiredMonitor.status, 404);
  });

  it('does not turn zero-weight informational failures into repair tasks', () => {
    const context = core.buildAuditContext({
      domain: 'example.com',
      pages: [auditPage('https://example.com/', 'home', HOME_HTML)],
    });
    const recommendations = core.buildRecommendations(context, [
      core.check({ id: 'geo.llms_txt', category: 'geo', status: 'fail', weight: 0, evidence: ['optional file unavailable'] }),
      core.check({ id: 'seo.title', category: 'seo', status: 'fail', weight: 1, evidence: ['missing title'] }),
    ]);
    assert.deepEqual(recommendations.map(item => item.id), ['seo.title']);
  });

  it('passes entity consistency when sampled pages name the same schema entity', () => {
    const sampled = [
      auditPage('https://example.com/', 'home', HOME_HTML),
      auditPage('https://example.com/posts/evidence', 'article', ARTICLE_HTML),
    ];
    const context = core.buildAuditContext({ domain: 'example.com', pages: sampled });
    const checks = core.buildNormalizedChecks(context, sampled, baselineModules());
    const entityConsistency = checks.find(item => item.id === 'geo.entity_consistency');

    assert.equal(context.entity?.name, 'Ada Lovelace');
    assert.equal(entityConsistency?.status, 'pass');
    assert.match(entityConsistency?.evidence.join(' ') ?? '', /Ada Lovelace/);
  });

  it('treats trusted site-name suffix variants as the same cross-page identity', () => {
    const home = HOME_HTML.replaceAll('Ada Notes', 'Amiya');
    const article = ARTICLE_HTML.replaceAll('Ada Notes', "Amiya's Desk");
    const chinese = ARTICLE_HTML.replaceAll('Ada Notes', 'Amiya\u7684\u4e66\u684c');
    const sampled = [
      auditPage('https://example.com/', 'home', home),
      auditPage('https://example.com/posts/evidence', 'article', article),
      auditPage('https://example.com/posts/zh', 'article', chinese),
    ];
    const context = core.buildAuditContext({ domain: 'example.com', pages: sampled });
    const check = core.buildNormalizedChecks(context, sampled, baselineModules())
      .find(item => item.id === 'geo.cross_page_consistency');

    assert.equal(check?.status, 'pass');
  });

  it('emits evidence-first GEO content checks for an authored article', () => {
    const sampled = [
      auditPage('https://example.com/', 'home', HOME_HTML),
      auditPage('https://example.com/posts/evidence', 'article', ARTICLE_HTML),
    ];
    const context = core.buildAuditContext({ domain: 'example.com', pages: sampled });
    const checks = core.buildNormalizedChecks(context, sampled, baselineModules());
    const byId = Object.fromEntries(checks.map(item => [item.id, item]));

    assert.equal(byId['geo.author_signal']?.status, 'pass');
    assert.equal(byId['geo.extractability']?.status, 'pass');
    assert.equal(byId['geo.direct_answer']?.status, 'pass');
    assert.equal(byId['geo.claim_source_support']?.status, 'pass');
    assert.equal(byId['geo.statistic_provenance']?.status, 'pass');
    assert.equal(byId['geo.freshness']?.status, 'pass');
    assert.equal(byId['geo.cross_page_consistency']?.status, 'pass');
    assert.match(byId['geo.claim_source_support']?.evidence.join(' ') ?? '', /supported/i);
  });

  it('marks content-only checks not applicable instead of penalizing a product homepage', () => {
    const html = `<!doctype html><html lang="en"><head><title>Widget</title>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Widget"}</script>
      </head><body><main><h1>Widget</h1><p>A compact device for organizing a desk.</p></main></body></html>`;
    const sampled = [auditPage('https://shop.example.com/', 'home', html)];
    const context = core.buildAuditContext({ domain: 'shop.example.com', pages: sampled });
    const modules = baselineModules();
    modules.content_quality.data.external_links = 0;
    modules.technical_seo.data.llms_txt_present = false;
    modules.schema_audit.data.schemas_found = ['Product'];
    const byId = Object.fromEntries(core.buildNormalizedChecks(context, sampled, modules).map(item => [item.id, item]));

    for (const id of ['geo.direct_answer', 'geo.claim_source_support', 'geo.statistic_provenance', 'geo.freshness']) {
      assert.equal(byId[id]?.status, 'not_applicable', id);
    }
    assert.equal(byId['geo.source_links']?.status, 'not_applicable');
    assert.equal(byId['geo.source_links']?.weight, 0);
    assert.equal(byId['geo.llms_txt']?.status, 'not_applicable');
    assert.equal(byId['geo.llms_txt']?.weight, 0);
  });

  it('fails only on explicit conflicting entity and unsupported claim evidence', () => {
    const conflictingArticle = ARTICLE_HTML
      .replaceAll('Ada Lovelace', 'Grace Hopper')
      .replace('<a href="https://developers.google.com/search/docs">Google Search documentation</a>', 'Google Search documentation');
    const sampled = [
      auditPage('https://example.com/', 'home', HOME_HTML),
      auditPage('https://example.com/posts/evidence', 'article', conflictingArticle),
    ];
    const context = core.buildAuditContext({ domain: 'example.com', pages: sampled });
    const byId = Object.fromEntries(core.buildNormalizedChecks(context, sampled, baselineModules()).map(item => [item.id, item]));

    assert.equal(byId['geo.entity_consistency']?.status, 'fail');
    assert.equal(byId['geo.entity_consistency']?.page_url, 'https://example.com/posts/evidence');
    assert.equal(byId['geo.claim_source_support']?.status, 'fail');
    assert.equal(byId['geo.statistic_provenance']?.status, 'fail');
  });
});
