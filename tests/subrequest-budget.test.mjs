import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-subrequest-budget-'));
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
    'src/lib/http.ts',
    'src/lib/security.ts',
    'src/lib/subrequest-budget.ts',
  ],
  { stdio: 'inherit' },
);

const require = createRequire(import.meta.url);
const {
  SubrequestBudget,
  SubrequestBudgetExceeded,
  budgetedFetcher,
} = require(path.join(tmpDir, 'lib', 'subrequest-budget.js'));

describe('subrequest budget', () => {
  it('counts every native fetch including redirect hops', async () => {
    const originalFetch = globalThis.fetch;
    const requested = [];
    globalThis.fetch = async (url) => {
      requested.push(String(url));
      if (requested.length === 1) {
        return new Response(null, { status: 302, headers: { Location: '/final' } });
      }
      return new Response('ok', { status: 200 });
    };

    try {
      const budget = new SubrequestBudget(3, 'audit');
      const response = await budgetedFetcher(budget)(`https://example.com/start`);

      assert.equal(response.status, 200);
      assert.deepEqual(requested, ['https://example.com/start', 'https://example.com/final']);
      assert.equal(budget.snapshot().used, 2);
      assert.equal(budget.snapshot().remaining, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('charges child and parent budgets in the same consume operation', () => {
    const parent = new SubrequestBudget(4, 'audit');
    const child = parent.child('optional', 2);

    child.consume('w3c:validator');

    assert.equal(parent.snapshot().used, 1);
    assert.equal(child.snapshot().used, 1);
    assert.equal(parent.snapshot().children[0]?.used, 1);
  });

  it('does not increment a child when the shared parent is exhausted', () => {
    const parent = new SubrequestBudget(1, 'audit');
    const child = parent.child('optional', 2);
    parent.consume('core:homepage');

    assert.throws(
      () => child.consume('w3c:validator'),
      (error) => {
        assert.ok(error instanceof SubrequestBudgetExceeded);
        assert.equal(error.code, 'SUBREQUEST_BUDGET_EXCEEDED');
        assert.equal(error.scope, 'audit');
        return true;
      },
    );
    assert.equal(parent.snapshot().used, 1);
    assert.equal(child.snapshot().used, 0);
  });

  it('rejects before issuing a native fetch after the budget is exhausted', async () => {
    const originalFetch = globalThis.fetch;
    let nativeFetches = 0;
    globalThis.fetch = async () => {
      nativeFetches += 1;
      return new Response('unexpected', { status: 200 });
    };

    try {
      const budget = new SubrequestBudget(0, 'audit');
      await assert.rejects(
        budgetedFetcher(budget)('https://example.com/'),
        (error) => {
          assert.ok(error instanceof SubrequestBudgetExceeded);
          assert.equal(error.code, 'SUBREQUEST_BUDGET_EXCEEDED');
          return true;
        },
      );
      assert.equal(nativeFetches, 0);
      assert.equal(budget.snapshot().used, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
