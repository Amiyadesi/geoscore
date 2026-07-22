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
  'src/modules/robots_sitemap.ts',
  'src/lib/audit-core.ts',
  'src/lib/audit-pages.ts',
  'src/lib/types.ts',
], { stdio: 'inherit' });

const require = createRequire(import.meta.url);
const technical = require(path.join(tmpDir, 'modules', 'technical_seo.js'));
const robotsSitemap = require(path.join(tmpDir, 'modules', 'robots_sitemap.js'));
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
  it('preserves apostrophes and attribute order in page metadata', async () => {
    const description = "Amiya's Desk is Amiya_desi's public home for writing, Godot projects, homelab and Cloudflare notes, Obsidian workflows, public services, and contact links.";
    const html = `<!doctype html><html lang="en"><head>
      <title>Amiya's Desk | Projects and Notes</title>
      <meta content="${description}" name="description">
      <meta content="Amiya's Desk" property="og:title">
      <meta property="og:description" content="Amiya_desi's public projects and notes">
      <link href="https://sayori.org/" rel="canonical">
    </head><body><main><h1>Amiya's Desk</h1></main></body></html>`;
    const result = await technical.runTechnicalSeo(
      'sayori.org', html, new Headers(), 10, 'https://sayori.org/',
      { fetcher: async () => new Response('', { status: 404 }) },
    );
    const descriptionCheck = result.checks.find(item => item.name.startsWith('Meta description'));

    assert.equal(result.page_meta.description, description);
    assert.equal(result.page_meta.og_title, "Amiya's Desk");
    assert.equal(result.page_meta.og_description, "Amiya_desi's public projects and notes");
    assert.equal(result.page_meta.canonical_url, 'https://sayori.org/');
    assert.equal(descriptionCheck?.passed, true);
    assert.equal(descriptionCheck?.detail, `${description.length} chars; target 100-170`);
  });

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

  it('keeps technology detection bounded and ignores product names in article copy', async () => {
    const mentionOnly = `<!doctype html><html><head><title>Payments guide</title></head><body>
      <main><h1>Compare payment platforms</h1><p>${'neutral introduction '.repeat(4000)}</p>
      <p>This article compares WooCommerce with hosted payment products.</p></main></body></html>`;
    const implementation = `<!doctype html><html><head><title>Store</title>
      <script src="/wp-content/plugins/woocommerce/assets/js/frontend/cart.js"></script>
      </head><body><main><h1>Store</h1></main></body></html>`;
    const fetcher = async () => new Response('', { status: 404 });

    const mentioned = await technical.runTechnicalSeo(
      'example.com', mentionOnly, new Headers(), 10, 'https://example.com/', { fetcher },
    );
    const implemented = await technical.runTechnicalSeo(
      'example.com', implementation, new Headers(), 10, 'https://example.com/', { fetcher },
    );

    assert.equal(mentioned.tech_stack.ecommerce, null);
    assert.equal(implemented.tech_stack.ecommerce, 'WooCommerce');
  });

  it('uses a language-aware title range for Chinese pages', async () => {
    const html = `<!doctype html><html lang="zh-CN"><head>
      <title>LINUX DO - 新的理想型社区</title>
      <meta name="description" content="一个开放、友好并持续讨论技术与生活的新型社区空间，欢迎认真交流与分享。">
    </head><body><main><h1>LINUX DO</h1><p>${'社区内容'.repeat(40)}</p></main></body></html>`;
    const result = await technical.runTechnicalSeo(
      'linux.do', html, new Headers(), 10, 'https://linux.do/',
      { fetcher: async () => new Response('', { status: 404 }) },
    );
    const titleCheck = result.checks.find(item => item.name.startsWith('Title tag length'));

    assert.equal(titleCheck?.passed, true);
    assert.match(titleCheck?.detail ?? '', /target 8-35/);
  });

  it('does not apply generic title length targets to a root-domain brand homepage', async () => {
    const html = '<!doctype html><html lang="en"><head><title>Streamly</title></head><body><main><h1>Streamly</h1><p>Watch and share videos.</p></main></body></html>';
    const result = await technical.runTechnicalSeo(
      'streamly.com', html, new Headers(), 10, 'https://streamly.com/',
      { fetcher: async () => new Response('', { status: 404 }) },
    );
    const titleCheck = result.checks.find(item => item.name.startsWith('Title tag length'));
    const normalized = core.buildNormalizedChecks(
      { ...context(), root_domain: 'streamly.com' },
      [{ ...page(), url: 'https://streamly.com/', final_url: 'https://streamly.com/', html, title: 'Streamly' }],
      { technical_seo: { status: 'ok', data: result } },
    ).find(item => item.id === 'seo.title_length');

    assert.equal(titleCheck?.passed, true);
    assert.doesNotMatch(result.issues.join(' '), /Title tag length/);
    assert.equal(normalized?.status, 'not_applicable');
  });

  it('uses a practical CJK range for meta descriptions', async () => {
    for (const description of ['站点摘要'.repeat(8), '页面内容介绍'.repeat(15)]) {
      const html = `<!doctype html><html lang="zh-CN"><head>
        <title>中文页面标题示例</title>
        <meta name="description" content="${description}">
      </head><body><main><h1>中文页面标题示例</h1></main></body></html>`;
      const result = await technical.runTechnicalSeo(
        'example.com', html, new Headers(), 10, 'https://example.com/',
        { fetcher: async () => new Response('', { status: 404 }) },
      );
      const descriptionCheck = result.checks.find(item => item.name.startsWith('Meta description'));

      assert.ok(description.length >= 31 && description.length <= 120);
      assert.equal(descriptionCheck?.passed, true, `${description.length} CJK chars should pass`);
    }
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

  it('treats an absent robots.txt as unknown and does not generate a repair task', async () => {
    const result = await robotsSitemap.runRobotsSitemap(
      'forum.monika.love', false, '',
      { fetcher: async () => new Response('', { status: 404 }) },
    );
    const checks = core.buildNormalizedChecks(context(), [page()], {
      robots_sitemap: { status: 'ok', data: result },
    });
    const robotsCheck = checks.find(item => item.id === 'seo.robots');

    assert.equal(result.robots_txt.fetch_status, 'missing');
    assert.doesNotMatch(result.issues.join(' '), /robots\.txt not found/i);
    assert.equal(robotsCheck?.status, 'unknown');
    assert.deepEqual(core.buildRecommendations(context(), checks).filter(item => item.id === 'seo.robots'), []);
  });

  it('does not execute legacy predicted or keyword modules in new audit source', () => {
    const source = fs.readFileSync('src/routes/audit.ts', 'utf8');
    assert.doesNotMatch(source, /runGeoPredicted|detectVertical|detectLocation|runKeywords/);
    assert.match(source, /modules\.geo_predicted \?\?= \{ status: 'skipped'/);
    assert.match(source, /modules\.keywords \?\?= \{ status: 'skipped'/);
    assert.match(source, /buildPredictedVisibility\(undefined/);
  });
});
