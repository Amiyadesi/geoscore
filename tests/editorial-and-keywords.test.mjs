import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-editorial-'));
fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"type":"commonjs"}\n');
fs.symlinkSync(path.resolve('node_modules'), path.join(tmpDir, 'node_modules'), 'junction');

execFileSync(
  process.execPath,
  [
    path.join('node_modules', 'typescript', 'bin', 'tsc'),
    '--target', 'ES2022',
    '--module', 'CommonJS',
    '--moduleResolution', 'node',
    '--lib', 'ES2022',
    '--types', '@cloudflare/workers-types',
    '--skipLibCheck',
    '--rootDir', 'src',
    '--outDir', tmpDir,
    'src/modules/schema_audit.ts',
    'src/modules/recommendations.ts',
    'src/modules/keywords.ts',
  ],
  { stdio: 'inherit' },
);

const require = createRequire(import.meta.url);
const { runSchemaAudit } = require(path.join(tmpDir, 'modules', 'schema_audit.js'));
const { runRecommendations } = require(path.join(tmpDir, 'modules', 'recommendations.js'));
const { runKeywords } = require(path.join(tmpDir, 'modules', 'keywords.js'));

const EDITORIAL_HTML = `<!doctype html>
<html lang="zh-CN"><head><title>Amiya's Desk</title>
<meta name="description" content="A personal archive of writing and project notes.">
<script type="application/ld+json">{
  "@context":"https://schema.org",
  "@graph":[
    {"@type":"WebSite","name":"Amiya's Desk","url":"https://sayori.org/"},
    {"@type":"Blog","name":"Amiya's Notes"},
    {"@type":"Person","name":"Amiya_desi"},
    {"@type":"Organization","name":"Amiya's Desk"},
    {"@type":"BreadcrumbList","itemListElement":[]},
    {"@type":"FAQPage","mainEntity":[]}
  ]
}</script></head><body><main><h1>A personal blog and project notes</h1>
<p>This page records original work, technical notes, and project context.</p>
<a href="https://example.net/pricing">A linked tool's pricing page</a></main></body></html>`;

function module(data, status = 'ok') {
  return { status, data };
}

function keywordEnv(aiRun) {
  return {
    AI: { run: aiRun },
    AUDIT_KV: { get: async () => null, put: async () => {} },
  };
}

describe('editorial classification and keyword degradation', () => {
  it('classifies Blog/Person/WebSite JSON-LD as editorial and does not require FAQPage', async () => {
    const audit = await runSchemaAudit('sayori.org', EDITORIAL_HTML);

    assert.equal(audit.site_type, 'editorial');
    assert.equal(audit.coverage.Entity, true);
    assert.equal(audit.coverage.WebSite, undefined);
    assert.equal(audit.coverage.BreadcrumbList, undefined);
    assert.equal(audit.coverage.FAQPage, undefined);
    assert.ok(audit.schemas_found.includes('FAQPage'));
  });

  it('accepts WebSite as the minimum entity identity without requiring FAQ or breadcrumb schema', async () => {
    const websiteOnly = '<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"NodeLoc","url":"https://nodeloc.com/"}</script></head><body><h1>NodeLoc community</h1></body></html>';
    const community = await runSchemaAudit('nodeloc.com', websiteOnly, [], 'community');
    const saas = await runSchemaAudit('app.example.com', websiteOnly, [], 'saas');

    for (const audit of [community, saas]) {
      assert.deepEqual(audit.coverage, { Entity: true });
      assert.equal(audit.score, 100);
      assert.doesNotMatch(audit.issues.join(' '), /FAQPage|BreadcrumbList|SoftwareApplication/);
    }
  });

  it('accepts valid unquoted JSON-LD type attributes', async () => {
    const html = '<html><head><script type=application/ld+json>{"@context":"https://schema.org","@type":"WebSite","name":"Kubernetes"}</script></head><body><h1>Kubernetes</h1></body></html>';
    const audit = await runSchemaAudit('kubernetes.io', html, [], 'documentation');

    assert.ok(audit.schemas_found.includes('WebSite'));
    assert.equal(audit.coverage.Entity, true);
  });

  it('scores only applicable schema coverage and does not reward unrelated schema types', async () => {
    const withFaq = await runSchemaAudit('sayori.org', EDITORIAL_HTML, [], 'personal_blog');
    const withoutFaq = await runSchemaAudit(
      'sayori.org',
      EDITORIAL_HTML.replace('{"@type":"FAQPage","mainEntity":[]}', '{"@type":"Service","name":"Unrelated legacy markup"}'),
      [],
      'personal_blog',
    );

    assert.equal(withFaq.score, 100);
    assert.equal(withoutFaq.score, 100);
  });

  it('uses neutral applicability for unknown sites and keeps personal blogs non-commercial', async () => {
    const neutral = await runSchemaAudit('example.com', '<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Example"}</script></head><body><h1>Example</h1></body></html>');
    assert.doesNotMatch(neutral.issues.join(' '), /LocalBusiness|Service|FAQPage/);

    const linkDenseBlog = EDITORIAL_HTML.replace('</main>', `${'<a href="/posts/example">Post</a>'.repeat(180)}</main>`);
    const blog = await runSchemaAudit('sayori.org', linkDenseBlog, [], 'personal_blog');
    assert.equal(blog.site_type, 'editorial');
    assert.doesNotMatch(blog.issues.join(' '), /LocalBusiness|Service|FAQPage/);
  });

  it('does not emit commercial schema, pricing, or FAQ recommendations for editorial sites', async () => {
    const schema = await runSchemaAudit('sayori.org', EDITORIAL_HTML);
    const recs = runRecommendations({
      technical_seo: module({ llms_txt_present: true, sitemap_url_count: 4, checks: [{ name: 'Open Graph tags complete', passed: true }] }),
      schema_audit: module(schema),
      authority: module({ indexed_page_count: null, wikipedia: false, wikidata_id: undefined }),
      geo_predicted: module({ citation_rate: 0, is_reliable: false }),
      keywords: module({ is_reliable: false }, 'skipped'),
      content_quality: module({ word_count: 650, has_phone: false, has_address: false, alt_coverage_pct: 100, issues: [] }),
    });
    const output = JSON.stringify(recs).toLowerCase();

    assert.doesNotMatch(output, /service|pricing|price|faqpage|localbusiness/);
    assert.doesNotMatch(output, /data for these areas is missing/);
  });

  it('returns an unreliable result instead of failing when the LLM is unavailable', async () => {
    const result = await runKeywords(
      'sayori.org',
      keywordEnv(async () => { throw new Error('AI unavailable'); }),
      EDITORIAL_HTML,
      null,
      null,
      { llmTimeoutMs: 20, searchTimeoutMs: 20 },
    );

    assert.equal(result.vertical, 'editorial');
    assert.equal(result.is_reliable, false);
    assert.ok(result.seed_queries.length > 0);
  });

  it('returns an unreliable result promptly when the LLM times out', async () => {
    const startedAt = Date.now();
    const result = await runKeywords(
      'sayori.org',
      keywordEnv(() => new Promise(() => {})),
      EDITORIAL_HTML,
      null,
      null,
      { llmTimeoutMs: 20, searchTimeoutMs: 20 },
    );

    assert.equal(result.is_reliable, false);
    assert.ok(Date.now() - startedAt < 500, 'keyword fallback should not wait for the outer module timeout');
  });
});
