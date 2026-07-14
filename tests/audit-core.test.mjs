import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-audit-core-'));
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
    'src/modules/content_quality.ts',
    'src/modules/authority.ts',
  ],
  { stdio: 'inherit' },
);

const require = createRequire(import.meta.url);
const core = require(path.join(tmpDir, 'lib', 'audit-core.js'));
const pages = require(path.join(tmpDir, 'lib', 'audit-pages.js'));
const cache = require(path.join(tmpDir, 'lib', 'cache.js'));
const { runContentQuality } = require(path.join(tmpDir, 'modules', 'content_quality.js'));
const { runAuthority } = require(path.join(tmpDir, 'modules', 'authority.js'));

const PERSONAL_BLOG_HTML = `<!doctype html>
<html lang="zh-CN"><head><title>纱世里的个人博客</title>
<link rel="canonical" href="https://blog.sayori.org/">
<meta name="description" content="个人随笔、技术笔记与项目记录。">
<script type="application/ld+json">{
  "@context":"https://schema.org",
  "@graph":[
    {"@type":"WebSite","name":"纱世里的小站","url":"https://blog.sayori.org/"},
    {"@type":"Blog","name":"纱世里的博客"},
    {"@type":"Person","name":"Sayori","url":"https://sayori.org/"},
    {"@type":"FAQPage","mainEntity":[]}
  ]
}</script></head><body><nav>${'<a href="/posts/example">文章</a>'.repeat(180)}</nav>
<main><h1>个人博客</h1><p>记录 AI、Cloudflare 和编程实践，但这里不是 SaaS 产品。</p></main></body></html>`;

function page(url, html, pageType = 'home') {
  return {
    url,
    page_type: pageType,
    source: 'requested',
    status: 'complete',
    title: 'Example',
    locale: 'zh-CN',
    html,
  };
}

describe('GeoScore 2 audit core', () => {
  it('uses the public suffix list for registrable roots', () => {
    assert.equal(pages.registrableRoot('blog.example.co.uk'), 'example.co.uk');
    assert.equal(pages.registrableRoot('www.city.kawasaki.jp'), 'city.kawasaki.jp');
  });

  it('hashes the full target URL in scoped cache keys', () => {
    const prefix = `https://example.com/${'a'.repeat(400)}`;
    const first = cache.cacheKey('example.com', { mode: 'url', targetUrl: `${prefix}?v=1` });
    const second = cache.cacheKey('example.com', { mode: 'url', targetUrl: `${prefix}?v=2` });
    assert.notEqual(first, second);
    assert.ok(first.length < 200);
  });

  it('keeps URL-mode targets on the submitted registrable root', () => {
    assert.equal(
      pages.validateAuditTargetUrl('https://blog.example.co.uk/post/1', 'www.example.co.uk'),
      'https://blog.example.co.uk/post/1',
    );
    assert.equal(pages.validateAuditTargetUrl('https://example.net/post/1', 'example.co.uk'), null);
    assert.equal(pages.validateAuditTargetUrl('http://127.0.0.1/post/1', 'example.co.uk'), null);
  });

  it('blocks a cross-root redirect before issuing the redirected request', async () => {
    const originalFetch = globalThis.fetch;
    const requested = [];
    globalThis.fetch = async url => {
      requested.push(String(url));
      return new Response('', { status: 302, headers: { Location: 'https://evil.example.net/landing' } });
    };
    try {
      const result = await pages.fetchAuditPage({ url: 'https://example.com/', page_type: 'home', source: 'requested' });
      assert.equal(result.status, 'error');
      assert.match(result.error, /outside the submitted registrable domain/i);
      assert.deepEqual(requested, ['https://example.com/']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('classifies schema-backed personal blogs before link density and industry words', () => {
    const context = core.buildAuditContext({
      domain: 'blog.sayori.org',
      pages: [page('https://blog.sayori.org/', PERSONAL_BLOG_HTML)],
      industryVertical: 'technology',
    });

    assert.equal(context.site_archetype, 'personal_blog');
    assert.equal(context.industry_vertical, 'technology');
    assert.equal(context.entity?.name, 'Sayori');
    assert.equal(context.root_domain, 'sayori.org');
    assert.equal(context.locale, 'zh-CN');
  });

  it('scores only known applicable checks and reports insufficient evidence', () => {
    const scored = core.scoreChecks([
      core.check({ id: 'pass', category: 'seo', status: 'pass', weight: 2, confidence: 1 }),
      core.check({ id: 'fail', category: 'seo', status: 'fail', weight: 1, confidence: 0.8 }),
      core.check({ id: 'unknown', category: 'seo', status: 'unknown', weight: 3 }),
      core.check({ id: 'error', category: 'seo', status: 'error', weight: 4 }),
      core.check({ id: 'na', category: 'seo', status: 'not_applicable', weight: 100 }),
    ]);

    assert.equal(scored.seo.score, 67);
    assert.equal(scored.seo.coverage, 0.3);
    assert.equal(scored.status, 'insufficient_evidence');
    assert.equal(scored.overall.score, null);
  });

  it('establishes a monitor baseline instead of comparing versions or low coverage', () => {
    const current = { score_version: '2.0.0', score: 72, coverage: 0.8, confidence: 0.9 };
    assert.equal(core.canCompareMonitorBaseline(null, current), false);
    assert.equal(core.canCompareMonitorBaseline({ ...current, score_version: '1.0.0' }, current), false);
    assert.equal(core.canCompareMonitorBaseline({ ...current, coverage: 0.3 }, current), false);
    assert.equal(core.canCompareMonitorBaseline({ ...current, score: 65 }, current), true);
  });

  it('creates recommendations only from failures and never invents blog commerce work', () => {
    const context = core.buildAuditContext({
      domain: 'blog.sayori.org',
      pages: [page('https://blog.sayori.org/', PERSONAL_BLOG_HTML)],
    });
    const checks = [
      core.check({ id: 'seo.meta_description', category: 'seo', status: 'fail', weight: 2, evidence: ['Missing description'], pageUrl: 'https://blog.sayori.org/post' }),
      core.check({ id: 'schema.faq', category: 'geo', status: 'pass', weight: 1, evidence: ['FAQPage found'] }),
      core.check({ id: 'schema.service', category: 'geo', status: 'not_applicable', weight: 1 }),
    ];
    const output = JSON.stringify(core.buildRecommendations(context, checks)).toLowerCase();

    assert.match(output, /meta description/);
    assert.doesNotMatch(output, /faqpage|service|pricing|package|localbusiness/);
  });

  it('emits stable English and Chinese check and recommendation templates', () => {
    const context = core.buildAuditContext({
      domain: 'blog.sayori.org',
      pages: [page('https://blog.sayori.org/', PERSONAL_BLOG_HTML)],
    });
    const titleCheck = core.check({
      id: 'seo.title',
      category: 'seo',
      title: '页面标题',
      status: 'fail',
      weight: 2,
      evidence: ['No title found'],
    });
    const [recommendation] = core.buildRecommendations(context, [titleCheck]);

    assert.deepEqual(titleCheck.localized_title, { en: 'Page title', zh: '页面标题' });
    assert.equal(recommendation.title, recommendation.localized.zh.title);
    assert.match(recommendation.localized.en.title, /unique page title/i);
    assert.match(recommendation.localized.en.fix, /title/i);
    assert.match(recommendation.localized.zh.fix, /添加简洁/);
    assert.match(recommendation.localized.zh.verify, /重新审计/);
  });

  it('separates schema existence from archetype fit without inventing blog commerce work', () => {
    const context = core.buildAuditContext({
      domain: 'blog.sayori.org',
      pages: [page('https://blog.sayori.org/', PERSONAL_BLOG_HTML)],
    });
    const modules = {
      technical_seo: { status: 'ok', data: {
        page_meta: {
          title: '纱世里的个人博客',
          description: '个人随笔、技术笔记与项目记录。',
          canonical_url: 'https://blog.sayori.org/',
          lang: 'zh-CN',
        },
        h1_tags: ['个人博客'],
        llms_txt_present: true,
      } },
      content_quality: { status: 'ok', data: { has_noindex: false, word_count: 180, external_links: 1 } },
      schema_audit: { status: 'ok', data: {
        schemas_found: ['WebSite', 'Person', 'FAQPage'],
        coverage: { Entity: true, WebSite: true, BreadcrumbList: false },
      } },
      robots_sitemap: { status: 'ok', data: {
        robots_txt: { exists: true, fetch_status: 'ok', blocks_all: false, blocks_googlebot: false },
        sitemap: { exists: true, fetch_status: 'ok', url: 'https://blog.sayori.org/sitemap.xml' },
      } },
    };

    const checks = core.buildNormalizedChecks(context, [page('https://blog.sayori.org/', PERSONAL_BLOG_HTML)], modules);
    const byId = Object.fromEntries(checks.map(item => [item.id, item]));
    assert.equal(byId['seo.schema_presence'].status, 'pass');
    assert.equal(byId['seo.schema_fit'].status, 'fail');
    assert.match(byId['seo.schema_fit'].evidence.join(' '), /BreadcrumbList/);

    const schemaRecommendation = core.buildRecommendations(context, checks)
      .find(item => item.id === 'seo.schema_fit');
    assert.ok(schemaRecommendation);
    const output = JSON.stringify(schemaRecommendation).toLowerCase();
    assert.match(output, /breadcrumblist/);
    assert.doesNotMatch(output, /faqpage|service|pricing|price|package|localbusiness/);
  });

  it('preserves the concrete robots.txt blocking evidence in the normalized failure', () => {
    const context = core.buildAuditContext({
      domain: 'blog.sayori.org',
      pages: [page('https://blog.sayori.org/', PERSONAL_BLOG_HTML)],
    });
    const checks = core.buildNormalizedChecks(context, [page('https://blog.sayori.org/', PERSONAL_BLOG_HTML)], {
      robots_sitemap: { status: 'ok', data: {
        robots_txt: { exists: true, fetch_status: 'complete', blocks_all: false, blocks_googlebot: true },
        sitemap: { exists: true, fetch_status: 'complete', url: 'https://blog.sayori.org/sitemap.xml' },
      } },
    });
    const robots = checks.find(item => item.id === 'seo.robots');

    assert.equal(robots?.status, 'fail');
    assert.match(robots?.evidence.join(' ') ?? '', /Googlebot/);
  });

  it('uses concrete remediation templates for core SEO failures', () => {
    const context = core.buildAuditContext({
      domain: 'blog.sayori.org',
      pages: [page('https://blog.sayori.org/', PERSONAL_BLOG_HTML)],
    });
    const recommendations = core.buildRecommendations(context, [
      core.check({ id: 'seo.robots', category: 'seo', status: 'fail', weight: 2, evidence: ['robots.txt blocks Googlebot with Disallow: /'] }),
      core.check({ id: 'seo.title', category: 'seo', status: 'fail', weight: 2, evidence: ['No title found'] }),
      core.check({ id: 'seo.h1', category: 'seo', status: 'fail', weight: 2, evidence: ['0 H1 elements'] }),
      core.check({ id: 'seo.html_conformance', category: 'seo', status: 'fail', weight: 1, evidence: ['error at line 12: Stray end tag'] }),
    ]);
    const byId = Object.fromEntries(recommendations.map(item => [item.id, item]));

    assert.match(byId['seo.robots'].fix, /Disallow/);
    assert.match(byId['seo.title'].fix, /title/i);
    assert.match(byId['seo.h1'].fix, /H1/);
    assert.match(byId['seo.html_conformance'].verify, /W3C Nu/);
  });

  it('selects representative pages deterministically and stays within five pages', () => {
    const links = [
      'https://example.com/about',
      'https://example.com/posts/z-last',
      'https://example.com/posts/a-first',
      'https://example.com/docs/getting-started',
      'https://example.com/products/widget',
      'https://other.example.net/posts/nope',
    ];
    const first = pages.selectAuditPageCandidates('https://example.com/', links, links);
    const second = pages.selectAuditPageCandidates('https://example.com/', [...links].reverse(), [...links].reverse());

    assert.deepEqual(first, second);
    assert.ok(first.length <= 4, 'homepage plus candidates must stay within five total pages');
    assert.equal(first[0]?.page_type, 'about');

    const withoutAbout = links.filter(link => !link.endsWith('/about'));
    const representativeOnly = pages.selectAuditPageCandidates('https://example.com/', withoutAbout, withoutAbout);
    assert.ok(representativeOnly.length <= 3, 'without About, only three representative pages may be added');
  });

  it('does not present English Flesch readability as valid for Chinese content', async () => {
    const html = `<html lang="zh-CN"><body><main><h1>中文文章</h1><p>${'这是一段用于验证中文内容可读性和正文提取的文章。'.repeat(40)}</p></main></body></html>`;
    const result = await runContentQuality('example.com', html);

    assert.ok(result.word_count > 100);
    assert.equal(result.readability.applicable, false);
    assert.equal(result.readability.method, 'not_applicable');
    assert.equal(result.readability.flesch_ease, null);
    assert.equal(result.readability.grade_level, null);
  });

  it('does not score empty fallback data when the primary page is blocked', () => {
    const blockedPage = {
      url: 'https://blocked.example.com/',
      page_type: 'home',
      source: 'requested',
      status: 'error',
      error: 'Bot challenge detected',
      html: '',
      headers: new Headers(),
      response_ms: 10,
      status_code: 403,
      final_url: 'https://blocked.example.com/',
    };
    const context = core.buildAuditContext({ domain: 'blocked.example.com', pages: [blockedPage] });
    const modules = {
      technical_seo: { status: 'ok', data: { page_meta: {}, h1_tags: [], llms_txt_present: false } },
      content_quality: { status: 'ok', data: { has_noindex: false, word_count: 0, external_links: 0 } },
      schema_audit: { status: 'ok', data: { schemas_found: [] } },
      robots_sitemap: {
        status: 'ok',
        data: {
          robots_txt: { exists: false, fetch_status: 'blocked', blocks_all: false, blocks_googlebot: false },
          sitemap: { exists: false, fetch_status: 'blocked' },
        },
      },
    };
    const checks = core.buildNormalizedChecks(context, [blockedPage], modules);
    const byId = Object.fromEntries(checks.map(item => [item.id, item]));

    for (const id of ['seo.indexability', 'seo.canonical', 'seo.title', 'seo.meta_description', 'seo.h1', 'seo.language', 'seo.schema_presence', 'geo.extractability', 'geo.source_links']) {
      assert.equal(byId[id].status, 'unknown', id);
    }
    assert.equal(byId['seo.robots'].status, 'unknown');
    assert.equal(byId['seo.sitemap'].status, 'unknown');
    assert.equal(core.scoreChecks(checks).overall.score, null);
    assert.doesNotMatch(JSON.stringify(core.buildRecommendations(context, checks)), /meta description|extractable/i);
  });

  it('accepts knowledge-graph matches only when the official website shares the root domain', async () => {
    const originalFetch = globalThis.fetch;
    const mockAuthorityFetch = officialUrl => async rawUrl => {
      const url = String(rawUrl);
      if (url.includes('/cdx/search/cdx')) {
        return new Response(JSON.stringify([['timestamp'], ['20200101000000']]), { status: 200 });
      }
      if (url.includes('wbsearchentities')) {
        return new Response(JSON.stringify({ search: [{ id: 'Q1', label: 'Example', description: 'software company', match: { type: 'label' } }] }), { status: 200 });
      }
      if (url.includes('Special:EntityData/Q1.json')) {
        return new Response(JSON.stringify({ entities: { Q1: {
          claims: { P856: [{ mainsnak: { datavalue: { value: officialUrl } } }] },
          sitelinks: { enwiki: { title: 'Example' } },
        } } }), { status: 200 });
      }
      if (url.includes('/domain/example.com')) {
        return new Response(JSON.stringify({ events: [{ eventAction: 'registration', eventDate: '2020-01-01T00:00:00Z' }] }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };

    try {
      globalThis.fetch = mockAuthorityFetch('https://unrelated.example.net/');
      const unrelated = await runAuthority('example.com', 'Example');
      assert.equal(unrelated.wikidata_id, null);
      assert.equal(unrelated.wikipedia, false);
      assert.equal(unrelated.entity_verified_domain, false);

      globalThis.fetch = mockAuthorityFetch('https://www.example.com/');
      const verified = await runAuthority('example.com', 'Example');
      assert.equal(verified.wikidata_id, 'Q1');
      assert.equal(verified.wikipedia, true);
      assert.equal(verified.entity_verified_domain, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
