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
    assert.equal(first.version, '1.0.0');
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
