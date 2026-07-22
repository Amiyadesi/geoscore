import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-checkpoint-'));
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
    'src/lib/audit-checkpoint.ts',
    'src/lib/cache.ts',
    'src/lib/types.ts',
  ],
  { stdio: 'inherit' },
);

const require = createRequire(import.meta.url);
const checkpoint = require(path.join(tmpDir, 'lib', 'audit-checkpoint.js'));
const cache = require(path.join(tmpDir, 'lib', 'cache.js'));

const scope = {
  domain: 'example.com',
  mode: 'site',
  target_url: 'https://example.com/',
  archetype_hint: null,
  score_version: '2.4.7',
};

function page(html = '<main><h1>Example</h1><p>Stable page evidence</p></main>') {
  return {
    url: 'https://example.com/',
    final_url: 'https://example.com/',
    status: 'complete',
    status_code: 200,
    html,
  };
}

describe('interrupted audit checkpoints', () => {
  it('reuses server results only when scope and freshly fetched pages match', async () => {
    const saved = checkpoint.buildAuditCheckpoint(
      scope,
      'audit_partial_1',
      12,
      await checkpoint.fingerprintAuditPages([page()]),
      { technical_seo: { status: 'ok', data: { title: true } } },
      1_000,
    );

    assert.equal(await checkpoint.isReusableCheckpoint(saved, scope, [page()], 2_000), true);
    assert.equal(await checkpoint.isReusableCheckpoint(saved, { ...scope, mode: 'url' }, [page()], 2_000), false);
    assert.equal(await checkpoint.isReusableCheckpoint(saved, { ...scope, score_version: '2.4.8' }, [page()], 2_000), false);
    assert.equal(await checkpoint.isReusableCheckpoint(saved, scope, [page('<main>Changed</main>')], 2_000), false);
  });

  it('ignores request-scoped tokens while retaining semantic page changes', async () => {
    const first = page(`<!doctype html><html><head>
      <meta name="request-id" content="request-one">
      <meta name="description" content="Stable description">
      <script nonce="nonce-one">window.csrfToken = 'first'</script>
    </head><body><main data-cfemail="one"><h1>Stable title</h1><p>Stable text</p><a href="/mail#token-one">Email</a></main></body></html>`);
    const second = page(`<!doctype html><html><head>
      <meta name="request-id" content="request-two">
      <meta name="description" content="Stable description">
      <script nonce="nonce-two">window.csrfToken = 'second'</script>
    </head><body><main data-cfemail="two"><h1>Stable title</h1><p>Stable text</p><a href="/mail#token-two">Email</a></main></body></html>`);
    const saved = checkpoint.buildAuditCheckpoint(
      scope,
      'audit_partial_volatile',
      12,
      await checkpoint.fingerprintAuditPages([first]),
      {},
      1_000,
    );

    assert.equal(await checkpoint.isReusableCheckpoint(saved, scope, [second], 2_000), true);
    assert.equal(await checkpoint.isReusableCheckpoint(saved, scope, [page('<main><h1>Changed title</h1></main>')], 2_000), false);
  });

  it('expires partial evidence and retries failed modules', async () => {
    const saved = checkpoint.buildAuditCheckpoint(
      scope,
      'audit_partial_2',
      12,
      await checkpoint.fingerprintAuditPages([page()]),
      {},
      1_000,
    );

    assert.equal(await checkpoint.isReusableCheckpoint(saved, scope, [page()], saved.expires_at), false);
    assert.equal(checkpoint.checkpointMatchesScope({ ...saved, expires_at: Number.NaN }, scope, 2_000), false);
    assert.equal(checkpoint.isReusableModule({ status: 'ok', data: {} }), true);
    assert.equal(checkpoint.isReusableModule({ status: 'partial', data: {} }), true);
    assert.equal(checkpoint.isReusableModule({ status: 'partial', error: 'quota', data: { status: 'error' } }), false);
    assert.equal(checkpoint.isReusableModule({ status: 'skipped' }), false);
    assert.equal(checkpoint.isReusableModule({ status: 'failed', error: 'timeout' }), false);
    assert.equal(checkpoint.canReuseCheckpointModule('authority', { status: 'ok', data: {} }, false), true);
    assert.equal(checkpoint.canReuseCheckpointModule('technical_seo', { status: 'ok', data: {} }, false), false);
  });

  it('round-trips partial evidence through the scoped server KV key', async () => {
    const values = new Map();
    const env = {
      AUDIT_KV: {
        get: async key => values.get(key) ?? null,
        put: async (key, value) => values.set(key, value),
        delete: async key => values.delete(key),
      },
    };
    const saved = checkpoint.buildAuditCheckpoint(
      scope,
      'audit_partial_kv',
      12,
      await checkpoint.fingerprintAuditPages([page()]),
      { authority: { status: 'ok', data: { source: 'rdap' } } },
    );

    await cache.setPartialAudit(env, scope.domain, { mode: 'site' }, saved);
    assert.equal((await cache.getPartialAudit(env, scope.domain, { mode: 'site' }))?.audit_id, 'audit_partial_kv');
    assert.equal(await cache.getPartialAudit(env, scope.domain, { mode: 'url' }), null);
    await cache.clearPartialAudit(env, scope.domain, { mode: 'site' });
    assert.equal(await cache.getPartialAudit(env, scope.domain, { mode: 'site' }), null);
  });

  it('combines verified modules across several interrupted invocations', async () => {
    const fingerprints = await checkpoint.fingerprintAuditPages([page()]);
    const first = checkpoint.buildAuditCheckpoint(
      scope,
      'audit_partial_first',
      12,
      fingerprints,
      { authority: { status: 'ok', data: { source: 'rdap' } } },
      1_000,
    );
    const pagesMatch = checkpoint.checkpointMatchesPageFingerprints(first, fingerprints);
    const resumed = Object.fromEntries(Object.entries(first.modules).filter(([name, result]) => (
      checkpoint.canReuseCheckpointModule(name, result, pagesMatch)
    )));
    const second = checkpoint.buildAuditCheckpoint(
      scope,
      'audit_partial_second',
      12,
      fingerprints,
      {
        ...resumed,
        technical_seo: { status: 'ok', data: { title: true } },
        html_validator: { status: 'failed', error: 'timeout' },
      },
      2_000,
    );

    assert.deepEqual(Object.keys(second.modules).sort(), ['authority', 'html_validator', 'technical_seo']);
    assert.equal(checkpoint.canReuseCheckpointModule('authority', second.modules.authority, true), true);
    assert.equal(checkpoint.canReuseCheckpointModule('technical_seo', second.modules.technical_seo, true), true);
    assert.equal(checkpoint.canReuseCheckpointModule('html_validator', second.modules.html_validator, true), false);
  });
});
