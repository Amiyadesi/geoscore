import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-crawler-policy-'));
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
  'src/modules/technical_seo.ts',
  'src/lib/audit-core.ts',
  'src/lib/audit-pages.ts',
  'src/lib/types.ts',
], { stdio: 'inherit' });

const require = createRequire(import.meta.url);
const technical = require(path.join(tmpDir, 'modules', 'technical_seo.js'));
const core = require(path.join(tmpDir, 'lib', 'audit-core.js'));

function context() {
  return {
    site_archetype: 'personal_blog',
    industry_vertical: 'technology',
    business_model: 'content',
    entity: { name: 'Sayori', type: 'Person', source: 'schema' },
    locality: null,
    locale: 'en',
    root_domain: 'sayori.org',
    page_types: ['home'],
    confidence: 0.95,
    evidence: [],
  };
}

function page() {
  return {
    url: 'https://blog.sayori.org/',
    final_url: 'https://blog.sayori.org/',
    page_type: 'home',
    source: 'requested',
    status: 'complete',
    html: '<html><head><title>Sayori</title></head><body><main><h1>Sayori</h1></main></body></html>',
    headers: new Headers(),
    response_ms: 100,
    status_code: 200,
  };
}

function normalizedCrawlerCheck(policy) {
  return core.buildNormalizedChecks(context(), [page()], {
    technical_seo: {
      status: 'ok',
      data: {
        crawler_policy_v2: policy,
        blocked_ai_bots: [
          ...policy.search_index.blocked,
          ...policy.training.blocked,
          ...policy.user_fetch.blocked,
        ],
        page_meta: {},
        h1_tags: [],
      },
    },
  }).find(item => item.id === 'geo.ai_crawler_policy');
}

describe('Crawler Policy v2', () => {
  it('counts only truly blocking external scripts in the document head', async () => {
    const html = `<!doctype html><html><head>
      <script src="/blocking.js"></script>
      <script src="/deferred.js" defer></script>
      <script src="/module.js" type="module"></script>
    </head><body><main><h1>Example</h1></main><script src="/body.js"></script></body></html>`;
    const fetcher = async () => new Response('', { status: 404 });
    const result = await technical.runTechnicalSeo(
      'example.com', html, new Headers(), 10, 'https://example.com/', { fetcher },
    );

    assert.equal(result.render_blocking_scripts, 1);
  });

  it('separates search, training, and user-triggered bot groups', () => {
    const policy = technical.buildCrawlerPolicyV2(`User-agent: GPTBot\nDisallow: /\n\nUser-agent: ChatGPT-User\nDisallow: /\n\nUser-agent: OAI-SearchBot\nAllow: /`);

    assert.deepEqual(policy.search_index.blocked, []);
    assert.deepEqual(policy.training.blocked, ['GPTBot']);
    assert.deepEqual(policy.user_fetch.blocked, ['ChatGPT-User']);
    assert.equal(policy.training_opt_out, true);
  });

  it('keeps a training-only opt-out neutral and zero weight', () => {
    const policy = technical.buildCrawlerPolicyV2('User-agent: GPTBot\nDisallow: /');
    const check = normalizedCrawlerCheck(policy);

    assert.equal(check.status, 'pass');
    assert.equal(check.weight, 0);
    assert.match(check.evidence.join(' '), /publisher choice: GPTBot/);
    assert.equal(core.scoreChecks([check]).overall.score, null);
  });

  it('reports an explicit search crawler block as informational risk only', () => {
    const policy = technical.buildCrawlerPolicyV2('User-agent: OAI-SearchBot\nDisallow: /');
    const check = normalizedCrawlerCheck(policy);

    assert.equal(check.status, 'fail');
    assert.equal(check.weight, 0);
    assert.match(check.evidence.join(' '), /Search\/index crawlers blocked: OAI-SearchBot/);
    assert.deepEqual(core.buildRecommendations(context(), [check]), []);
  });

  it('marks an unavailable robots response unknown instead of treating it as allowed', () => {
    const policy = technical.buildCrawlerPolicyV2('', 'error');
    const check = normalizedCrawlerCheck(policy);
    assert.equal(check.status, 'unknown');
    assert.equal(policy.search_index.status, 'unknown');
  });

  it('does not execute legacy predicted or keyword modules in new audit source', () => {
    const source = fs.readFileSync('src/routes/audit.ts', 'utf8');
    assert.doesNotMatch(source, /runGeoPredicted|detectVertical|detectLocation|runKeywords/);
    assert.match(source, /modules\.geo_predicted = \{ status: 'skipped'/);
    assert.match(source, /modules\.keywords = \{ status: 'skipped'/);
    assert.match(source, /buildPredictedVisibility\(undefined/);
  });
});
