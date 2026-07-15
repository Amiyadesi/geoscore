import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-repair-groups-'));
fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"type":"commonjs"}\n');
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
  'src/lib/repair-groups.ts',
  'src/lib/fix-pack.ts',
  'src/lib/audit-core.ts',
  'src/lib/audit-pages.ts',
  'src/lib/types.ts',
], { stdio: 'inherit' });

const require = createRequire(import.meta.url);
const repair = require(path.join(tmpDir, 'lib', 'repair-groups.js'));
const fixes = require(path.join(tmpDir, 'lib', 'fix-pack.js'));

const PAGE = 'https://example.com/post';

function check(id, evidence, pageUrl = PAGE) {
  return {
    id,
    category: 'seo',
    title: id,
    localized_title: { en: id, zh: id },
    status: 'fail',
    severity: 'major',
    weight: 2,
    confidence: 0.9,
    source: 'html',
    page_url: pageUrl,
    evidence: [evidence],
  };
}

function recommendation(id, fix, verify, pageUrl = PAGE) {
  const copy = { title: `Fix ${id}`, why: `Why ${id}`, fix, verify };
  return {
    id,
    template_id: id,
    category: 'seo',
    severity: 'major',
    priority: 80,
    title: copy.title,
    page_url: pageUrl,
    evidence: `Evidence ${id}`,
    source: 'html',
    confidence: 0.9,
    why: copy.why,
    fix,
    verify,
    what_to_do: fix,
    validation: verify,
    impact: 'high',
    effort: 'low',
    localized: { en: copy, zh: { title: `修复 ${id}`, why: `原因 ${id}`, fix: `中文 ${fix}`, verify: `中文 ${verify}` } },
  };
}

describe('root-cause repair groups', () => {
  it('groups same-stage failures on one page and preserves every evidence and verification item', () => {
    const checks = [
      check('seo.title', 'title missing'),
      check('seo.meta_description', 'description missing'),
      check('seo.robots', 'robots blocks indexing', 'https://example.com/robots.txt'),
    ];
    const recommendations = [
      recommendation('seo.title', 'Add title', 'Verify title'),
      recommendation('seo.meta_description', 'Add description', 'Verify description'),
      recommendation('seo.robots', 'Allow crawling', 'Verify robots', 'https://example.com/robots.txt'),
    ];
    const groups = repair.buildRepairGroups(checks, recommendations);
    const parse = groups.find(group => group.stage === 'parse');
    const discovery = groups.find(group => group.stage === 'discovery');

    assert.equal(groups.length, 2);
    assert.deepEqual(parse.check_ids, ['seo.meta_description', 'seo.title']);
    assert.deepEqual(parse.evidence_items.flatMap(item => item.observed).sort(), ['description missing', 'title missing']);
    assert.deepEqual(parse.verification_steps.sort(), ['Verify description', 'Verify title']);
    assert.deepEqual(discovery.check_ids, ['seo.robots']);
  });

  it('resolves a group through the existing recommendation_id field and returns a complete FixPack', () => {
    const checks = [
      check('seo.title', 'title missing'),
      check('seo.meta_description', 'description missing'),
    ];
    const recommendations = [
      recommendation('seo.title', 'Add title', 'Verify title'),
      recommendation('seo.meta_description', 'Add description', 'Verify description'),
    ];
    const groups = repair.buildRepairGroups(checks, recommendations);
    const audit = {
      audit_id: '01JGEOSCORE23REPAIRGROUP',
      domain: 'example.com',
      audit_context: { locale: 'en' },
      checks,
      recommendations_v2: recommendations,
      repair_groups: groups,
    };
    const resolved = fixes.resolveFixPackSource(audit, groups[0].id);
    assert.equal(resolved.error, null);
    const pack = fixes.buildFixPack(resolved.source, 'en', 'handoff_prompt');

    assert.equal(pack.recommendation_id, groups[0].id);
    assert.equal(pack.repair_group.stage, 'parse');
    assert.deepEqual(pack.repair_group.check_ids, groups[0].check_ids);
    assert.deepEqual(pack.evidence_items.map(item => item.check_id).sort(), ['seo.meta_description', 'seo.title']);
    assert.deepEqual(pack.fix_steps.sort(), ['Add description', 'Add title']);
    assert.deepEqual(pack.verify.sort(), ['Verify description', 'Verify title']);
    assert.match(pack.handoff_prompt, /title missing/);
    assert.match(pack.handoff_prompt, /description missing/);
    assert.match(pack.handoff_prompt, /Verify title/);
    assert.match(pack.handoff_prompt, /Verify description/);
  });
});
