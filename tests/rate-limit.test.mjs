import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-rate-limit-'));
execFileSync(process.execPath, [
  path.join('node_modules', 'typescript', 'bin', 'tsc'),
  '--target', 'ES2022', '--module', 'CommonJS', '--moduleResolution', 'node',
  '--lib', 'ES2022', '--types', '@cloudflare/workers-types', '--strict', '--skipLibCheck',
  '--outDir', outDir, 'src/lib/rate-limit.ts', 'src/lib/types.ts',
], { stdio: 'inherit' });
const require = createRequire(import.meta.url);
const { auditRateLimit, getBrowserFingerprint } = require(path.join(outDir, 'rate-limit.js'));

function env() {
  const values = new Map();
  return {
    AUDIT_RATE_LIMIT_PER_HOUR: '2',
    BUDGET_KV: {
      get: async key => values.get(key) ?? null,
      put: async (key, value) => { values.set(key, value); },
    },
  };
}

test('browser fingerprint is accepted only as a bounded hash-like identifier', () => {
  assert.equal(getBrowserFingerprint(new Request('https://api.example/a?visitor_id=' + 'A'.repeat(32))), 'a'.repeat(32));
  assert.equal(getBrowserFingerprint(new Request('https://api.example/a?visitor_id=Chrome')), null);
});

test('audit quota applies to both the source IP and browser fingerprint', async () => {
  const firstEnv = env();
  const fingerprint = 'b'.repeat(32);
  assert.equal((await auditRateLimit(firstEnv, '198.51.100.10', fingerprint)).limited, false);
  assert.equal((await auditRateLimit(firstEnv, '198.51.100.11', fingerprint)).limited, false);
  assert.equal((await auditRateLimit(firstEnv, '198.51.100.12', fingerprint)).limited, true);

  const secondEnv = env();
  assert.equal((await auditRateLimit(secondEnv, '203.0.113.10', fingerprint)).limited, false);
  assert.equal((await auditRateLimit(secondEnv, '203.0.113.10', 'c'.repeat(32))).limited, false);
  assert.equal((await auditRateLimit(secondEnv, '203.0.113.10', 'd'.repeat(32))).limited, true);
});
