import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-query-evidence-'));
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
    '--skipLibCheck',
    '--rootDir', 'src',
    '--outDir', tmpDir,
    'src/lib/query-evidence.ts',
    'src/lib/audit-core.ts',
    'src/lib/audit-pages.ts',
  ],
  { stdio: 'inherit' },
);

const require = createRequire(import.meta.url);
const evidence = require(path.join(tmpDir, 'lib', 'query-evidence.js'));

function context(overrides = {}) {
  return {
    site_archetype: 'unknown',
    industry_vertical: null,
    business_model: null,
    entity: { name: 'Example', type: 'Organization', source: 'schema' },
    locality: null,
    locale: 'en-US',
    root_domain: 'example.com',
    page_types: ['home'],
    confidence: 0.9,
    evidence: [],
    ...overrides,
  };
}

describe('AuditContext-only evidence query planner', () => {
  it('is deterministic, versioned, and capped at three queries', () => {
    const input = context({
      site_archetype: 'saas',
      industry_vertical: 'team collaboration',
      business_model: 'subscription',
      page_types: ['home', 'docs', 'pricing'],
    });
    const first = evidence.planEvidenceQueries(input);
    const second = evidence.planEvidenceQueries(structuredClone(input));

    assert.deepEqual(first, second);
    assert.equal(first.version, '1.1.0');
    assert.equal(first.generated_from, 'audit_context');
    assert.ok(first.queries.length > 0);
    assert.ok(first.queries.length <= evidence.MAX_FREE_EVIDENCE_QUERIES);
    assert.equal(new Set(first.queries.map(item => item.query.toLowerCase())).size, first.queries.length);
  });

  it('never invents commercial intent for personal blogs or editorial sites', () => {
    const prohibited = /price|pricing|package|service|purchase|buy|comparison|套餐|价格|购买|服务|产品对比/i;
    for (const site_archetype of ['personal_blog', 'editorial']) {
      const plan = evidence.planEvidenceQueries(context({
        site_archetype,
        industry_vertical: 'AI and Cloudflare',
        business_model: 'subscription pricing packages',
        entity: { name: 'Sayori', type: 'Person', source: 'schema' },
        root_domain: 'sayori.org',
        page_types: ['home', 'about', 'article'],
      }));

      assert.equal(plan.queries.length, 3);
      assert.doesNotMatch(JSON.stringify(plan.queries), prohibited);
      assert.deepEqual(plan.queries.map(item => item.intent), ['branded', 'informational', 'navigational']);
    }
  });

  it('uses Chinese templates from the audited locale without changing intent rules', () => {
    const plan = evidence.planEvidenceQueries(context({
      site_archetype: 'personal_blog',
      locale: 'zh-CN',
      entity: { name: '纱世里', type: 'Person', source: 'schema' },
      industry_vertical: '技术',
      root_domain: 'sayori.org',
      page_types: ['home', 'about', 'article'],
    }));

    assert.ok(plan.queries.every(item => /[\u4e00-\u9fff]/.test(item.query)));
    assert.match(plan.queries[0].query, /博客 文章/);
    assert.match(plan.queries[2].query, /关于 作者/);
  });

  it('spends exactly one free query on a brand-free rung and lists the rungs it did not run', () => {
    const plan = evidence.planEvidenceQueries(context({
      site_archetype: 'saas',
      industry_vertical: 'team collaboration',
      entity: { name: 'Acme Tools', type: 'Organization', source: 'schema' },
      root_domain: 'acmetools.com',
      locale: 'zh-CN',
    }));

    const brandFree = plan.queries.filter(item => item.brand_free);
    assert.ok(brandFree.some(item => item.rung === 1 && item.query === 'team collaboration 厂商'));
    assert.ok(brandFree.every(item => !/Acme Tools|acmetools\.com/i.test(item.query)));

    // The brand-anchored query stays first so the answer snapshot keeps its target.
    assert.equal(plan.queries[0].brand_free, false);
    assert.match(plan.queries[0].query, /Acme Tools/);
    assert.equal(plan.queries.length, evidence.MAX_FREE_EVIDENCE_QUERIES);
    assert.deepEqual(plan.queries.map(item => item.rung_label), ['branded', 'field', 'field']);

    // The vaguest rung stays unrun, and unprobed nodes are instructions, not observations.
    assert.equal(plan.queries.some(item => item.rung === 0), false);
    assert.deepEqual(plan.unprobed_rungs, [{
      rung: 0,
      rung_label: 'generic',
      intent: 'informational',
      query: '厂商',
    }]);
  });

  it('never invents a field probe when the audit has no field evidence', () => {
    const plan = evidence.planEvidenceQueries(context({ industry_vertical: null }));

    assert.deepEqual(plan.unprobed_rungs, []);
    assert.equal(plan.queries.some(item => item.brand_free), false);
    assert.ok(plan.queries.every(item => item.rung >= 2));
  });

  it('classifies stored monitoring queries back onto the rungs from the query text', () => {
    const contextInput = context({
      site_archetype: 'personal_blog',
      entity: { name: 'Sayori', type: 'Person', source: 'schema' },
      root_domain: 'sayori.org',
    });

    assert.equal(evidence.classifyEvidenceQuery('technology author', 'informational', contextInput).rung, 1);
    assert.equal(evidence.classifyEvidenceQuery('Sayori blog articles', 'informational', contextInput).rung, 2);
    assert.equal(evidence.classifyEvidenceQuery('Sayori about author', 'navigational', contextInput).rung, 3);
    assert.equal(evidence.classifyEvidenceQuery('sayori.org', 'navigational', contextInput).brand_free, false);
  });

  it('adds local intent only when a local archetype has locality evidence', () => {
    const local = evidence.planEvidenceQueries(context({
      site_archetype: 'local_business',
      industry_vertical: 'dentist',
      locality: 'Shanghai',
    }));
    const blog = evidence.planEvidenceQueries(context({
      site_archetype: 'personal_blog',
      locality: 'Shanghai',
    }));

    assert.ok(local.queries.some(item => item.intent === 'local' && item.query.includes('Shanghai')));
    assert.ok(blog.queries.every(item => item.intent !== 'local'));
  });
});
