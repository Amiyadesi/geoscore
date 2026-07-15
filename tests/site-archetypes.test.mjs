import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-site-archetypes-'));
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
  ],
  { stdio: 'inherit' },
);

const require = createRequire(import.meta.url);
const core = require(path.join(tmpDir, 'lib', 'audit-core.js'));

function fixture(name) {
  return fs.readFileSync(path.join(here, 'fixtures', `${name}.html`), 'utf8');
}

function page(domain, html, pathName = '/', pageType = 'home') {
  return {
    url: `https://${domain}${pathName}`,
    final_url: `https://${domain}${pathName}`,
    page_type: pageType,
    source: 'requested',
    status: 'complete',
    title: 'Fixture',
    locale: html.match(/<html[^>]+lang="([^"]+)"/i)?.[1],
    html,
    headers: new Headers(),
    response_ms: 1,
    status_code: 200,
  };
}

describe('golden site archetype fixtures', () => {
  const cases = [
    ['saas', 'app.example.com', 'saas', 'Orbit Notes', 'Organization'],
    ['ecommerce', 'shop.example.com', 'ecommerce', 'Northwind Tea', 'Brand'],
    ['local-business', 'dentist.example.com', 'local_business', 'Harbour Dental Clinic', 'Dentist'],
    ['news-media', 'news.example.com', 'news_media', 'River City Dispatch', 'NewsMediaOrganization'],
    ['chinese-personal-blog', 'blog.example.com', 'personal_blog', '小林', 'Person'],
    ['unknown', 'unknown.example.com', 'unknown', null, null],
  ];

  for (const [name, domain, expectedArchetype, expectedEntity, expectedEntityType] of cases) {
    it(`classifies ${name} from strong site evidence`, () => {
      const html = fixture(name);
      const context = core.buildAuditContext({
        domain,
        pages: [page(domain, html)],
        industryVertical: name === 'chinese-personal-blog' ? 'cloudflare' : 'artificial_intelligence',
      });

      assert.equal(context.site_archetype, expectedArchetype);
      assert.equal(context.entity?.name ?? null, expectedEntity);
      assert.equal(context.entity?.type ?? null, expectedEntityType);
      assert.equal(context.root_domain, 'example.com');
      assert.equal(context.industry_vertical, name === 'chinese-personal-blog' ? 'cloudflare' : 'artificial_intelligence');
      if (name === 'chinese-personal-blog') assert.equal(context.locale, 'zh-CN');
      if (name === 'unknown') assert.ok(context.confidence < 0.3);
    });
  }

  it('keeps request-local hints isolated from the underlying evidence', () => {
    const html = fixture('saas');
    const hinted = core.buildAuditContext({
      domain: 'app.example.com',
      pages: [page('app.example.com', html)],
      archetypeHint: 'documentation',
    });
    const unhinted = core.buildAuditContext({
      domain: 'app.example.com',
      pages: [page('app.example.com', html)],
    });

    assert.equal(hinted.site_archetype, 'documentation');
    assert.equal(unhinted.site_archetype, 'saas');
    assert.match(hinted.evidence[0]?.value ?? '', /archetype_hint=documentation/);
  });

  it('keeps homepage Blog and Person evidence ahead of weak words from sampled pages', () => {
    const domain = 'blog.sayori.org';
    const home = `<!doctype html><html lang="zh-CN"><head><title>Amiya的书桌</title>
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
        {"@type":"WebSite","name":"Amiya的书桌","url":"https://blog.sayori.org/"},
        {"@type":"Blog","name":"Amiya的书桌","url":"https://blog.sayori.org/"},
        {"@type":"Person","name":"Amiya_desi","url":"https://sayori.org/"},
        {"@type":"Organization","name":"Amiya的书桌","url":"https://blog.sayori.org/"}
      ]}</script></head><body><h1>Amiya的书桌</h1></body></html>`;
    const sampledPages = [
      page(domain, home),
      page(domain, '<html lang="zh-CN"><body><h1>关于我</h1><p>我也参与开源 community 的讨论。</p></body></html>', '/about/', 'about'),
      page(domain, '<html lang="zh-CN"><body><article><h1>社区观察</h1><p>An article about community building.</p></article></body></html>', '/posts/community-notes/', 'article'),
      page(domain, '<html lang="zh-CN"><body><h1>文章归档</h1><a href="/posts/community-notes/">归档文章</a></body></html>', '/archives/', 'archive'),
      page(domain, '<html lang="zh-CN"><body><h1>第 2 页</h1><p>More writing and community links.</p></body></html>', '/page/2/', 'listing'),
    ];

    const context = core.buildAuditContext({ domain, pages: sampledPages });

    assert.equal(context.site_archetype, 'personal_blog');
    assert.equal(context.entity?.name, 'Amiya_desi');
    assert.equal(context.entity?.type, 'Person');
    assert.match(context.evidence[0]?.value ?? '', /Blog and Person JSON-LD/);
  });

  it('keeps a product platform identity ahead of sampled article and author schema', () => {
    const domain = 'stripe.com';
    const context = core.buildAuditContext({
      domain,
      pages: [
        page(domain, fixture('stripe-home')),
        page(domain, fixture('stripe-blog'), '/blog/introducing-agentic-commerce', 'article'),
        page(domain, fixture('stripe-docs'), '/docs/api', 'documentation'),
      ],
      industryVertical: 'finance',
    });

    assert.equal(context.site_archetype, 'saas');
    assert.equal(context.entity?.name, 'Stripe');
    assert.notEqual(context.entity?.name, 'Patrick Collison');
    assert.equal(context.business_model, 'software');
    assert.equal(context.industry_vertical, 'finance');
    assert.match(context.evidence[0]?.value ?? '', /product|platform|pricing|application/i);
  });
});
