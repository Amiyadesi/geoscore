import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-score-calibration-'));
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
const calibration = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'score-calibration.json'), 'utf8'));

function auditPage(profile) {
  const html = fs.readFileSync(path.join(here, 'fixtures', `${profile.fixture}.html`), 'utf8');
  return {
    url: `https://${profile.domain}/`,
    final_url: `https://${profile.domain}/`,
    page_type: 'home',
    source: 'requested',
    status: 'complete',
    title: 'Golden fixture',
    locale: html.match(/<html[^>]+lang="([^"]+)"/i)?.[1],
    html,
    headers: new Headers(),
    response_ms: 1,
    status_code: 200,
  };
}

function checksFor(profile) {
  return calibration.baseline_checks.map(item => core.check({
    ...item,
    status: profile.overrides[item.id] ?? profile.default_status ?? 'pass',
    confidence: 1,
  }));
}

describe('GeoScore 2.4 golden-site score calibration', () => {
  for (const profile of calibration.profiles) {
    it(`${profile.name} stays inside its evidence-backed score band`, () => {
      const context = core.buildAuditContext({ domain: profile.domain, pages: [auditPage(profile)] });
      const summary = core.scoreChecks(checksFor(profile));

      assert.equal(context.site_archetype, profile.archetype);
      assert.equal(summary.status, profile.expected.status);
      assert.equal(summary.overall.score, profile.expected.score);
      assert.equal(summary.overall.cap, profile.expected.cap);
    });
  }

  it('tightens repeated critical and major failures without changing check weights', () => {
    const checks = checksFor(calibration.profiles[0]);
    const weights = checks.map(item => item.weight);

    assert.equal(core.SCORE_VERSION, '2.4.2');
    assert.deepEqual(core.SCORE_POLICY.repeated_failure_caps, {
      critical: { step: 10, floor: 19 },
      major: { step: 10, floor: 49 },
    });
    core.scoreChecks(checks);
    assert.deepEqual(checks.map(item => item.weight), weights);
  });
});
