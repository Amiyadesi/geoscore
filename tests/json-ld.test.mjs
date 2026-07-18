import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-json-ld-'));
fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"type":"commonjs"}\n');
execFileSync(process.execPath, [
  path.join('node_modules', 'typescript', 'bin', 'tsc'),
  '--target', 'ES2022',
  '--module', 'CommonJS',
  '--moduleResolution', 'node',
  '--lib', 'ES2022',
  '--skipLibCheck',
  '--rootDir', 'src',
  '--outDir', tmpDir,
  'src/lib/json-ld.ts',
], { stdio: 'inherit' });

const require = createRequire(import.meta.url);
const { extractJsonLdBlocks } = require(path.join(tmpDir, 'lib', 'json-ld.js'));

test('extracts quoted, unquoted and case-insensitive JSON-LD script types', () => {
  const html = `
    <script type="application/ld+json">{"quoted":true}</script>
    <script TYPE='APPLICATION/LD+JSON'>{"single":true}</script>
    <script defer type=application/ld+json>{"unquoted":true}</script>
    <script type="application/json">{"wrong":true}</script>`;

  assert.deepEqual(extractJsonLdBlocks(html), [
    '{"quoted":true}',
    '{"single":true}',
    '{"unquoted":true}',
  ]);
});

test('keeps malformed JSON-LD bodies available for schema diagnostics', () => {
  assert.deepEqual(
    extractJsonLdBlocks('<script type=application/ld+json>{broken</script>'),
    ['{broken'],
  );
});
