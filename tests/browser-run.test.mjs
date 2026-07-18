import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-browser-run-'));
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
    'src/lib/audit-pages.ts',
    'src/lib/bot-detection.ts',
    'src/lib/http.ts',
    'src/lib/security.ts',
    'src/lib/subrequest-budget.ts',
    'src/lib/types.ts',
  ],
  { stdio: 'inherit' },
);

const require = createRequire(import.meta.url);
const {
  buildBrowserAllowRequestPattern,
  detectJavaScriptShell,
  fetchAuditPage,
} = require(path.join(tmpDir, 'lib', 'audit-pages.js'));

const candidate = {
  url: 'https://www.example.com/',
  page_type: 'home',
  source: 'requested',
};
const challengeHtml = '<!doctype html><html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>';
const siteGroundChallengeHtml = `<!doctype html><html><head>
  <meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2F&y=ipc:test">
  </head><body></body></html>`;
const renderedHtml = `<!doctype html><html lang="en"><head><title>Rendered example</title></head><body><main><h1>Example</h1><p>${'Useful rendered content. '.repeat(20)}</p></main></body></html>`;

function challengeFetcher() {
  return Promise.resolve(new Response(challengeHtml, {
    status: 403,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  }));
}

function memoryKv(initial = null) {
  let value = initial;
  const calls = { get: 0, put: 0, key: null, value: null };
  return {
    calls,
    async get(key) {
      calls.get += 1;
      calls.key = key;
      return value;
    },
    async put(key, next) {
      calls.put += 1;
      calls.key = key;
      calls.value = String(next);
      value = String(next);
    },
  };
}

function bindingWith(responseFactory) {
  const calls = [];
  return {
    calls,
    async quickAction(action, options) {
      calls.push({ action, options });
      return responseFactory(action, options);
    },
  };
}

function successResponse(headers = {}) {
  return new Response(JSON.stringify({
    success: true,
    result: renderedHtml,
    meta: { status: 200, title: 'Rendered example' },
    errors: [],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function browserOptions(overrides = {}) {
  return {
    budgetKv: memoryKv(),
    dailyBudgetSeconds: 540,
    attemptState: { attempted: false },
    ...overrides,
  };
}

describe('Cloudflare Browser Run audit fallback', () => {
  it('declares the binding in the source config that prepare-cloudflare copies', () => {
    const config = JSON.parse(fs.readFileSync(path.resolve('wrangler.jsonc'), 'utf8'));
    const prepareSource = fs.readFileSync(path.resolve('scripts/prepare-cloudflare.mjs'), 'utf8');
    assert.deepEqual(config.browser, { binding: 'BROWSER' });
    assert.match(prepareSource, /const raw = await readFile\(CONFIG_PATH, 'utf8'\)/);
    assert.match(prepareSource, /const generated = raw\s*\.replace/);
  });

  it('reports a missing binding without attempting provider or budget storage', async () => {
    const kv = memoryKv();
    const page = await fetchAuditPage(candidate, challengeFetcher, {
      browserFallback: browserOptions({ binding: undefined, budgetKv: kv }),
    });

    assert.equal(page.status, 'error');
    assert.equal(page.browser_fallback?.status, 'skipped');
    assert.equal(page.browser_fallback?.error?.code, 'BROWSER_RUN_UNAVAILABLE');
    assert.equal(kv.calls.get, 0);
    assert.equal(kv.calls.put, 0);
  });

  it('does not call the provider when the daily reservation would exceed 540 seconds', async () => {
    const kv = memoryKv('530');
    const binding = bindingWith(() => successResponse());
    const page = await fetchAuditPage(candidate, challengeFetcher, {
      browserFallback: browserOptions({ binding, budgetKv: kv }),
    });

    assert.equal(page.status, 'error');
    assert.equal(page.browser_fallback?.error?.code, 'BROWSER_RUN_BUDGET_EXHAUSTED');
    assert.equal(binding.calls.length, 0);
    assert.equal(kv.calls.put, 0);
  });

  it('does not reserve daily time when the per-invocation subrequest budget is exhausted', async () => {
    const kv = memoryKv();
    const binding = bindingWith(() => successResponse());
    const page = await fetchAuditPage(candidate, challengeFetcher, {
      browserFallback: browserOptions({
        binding,
        budgetKv: kv,
        subrequestBudget: {
          consume() { throw new Error('no subrequests left'); },
          snapshot() { return { scope: 'test', limit: 0, used: 0, remaining: 0, children: [] }; },
        },
      }),
    });

    assert.equal(page.browser_fallback?.error?.code, 'BROWSER_RUN_SUBREQUEST_BUDGET_EXCEEDED');
    assert.equal(binding.calls.length, 0);
    assert.equal(kv.calls.get, 0);
    assert.equal(kv.calls.put, 0);
  });

  it('returns bounded rendered content and records provider usage metadata', async () => {
    const kv = memoryKv();
    const binding = bindingWith(() => successResponse({ 'X-Browser-Ms-Used': '1234' }));
    let consumed = 0;
    const page = await fetchAuditPage(candidate, challengeFetcher, {
      browserFallback: browserOptions({
        binding,
        budgetKv: kv,
        now: Date.UTC(2026, 6, 14, 12),
        subrequestBudget: {
          consume(label) {
            assert.equal(label, 'browser-run:content');
            consumed += 1;
          },
          snapshot() { return { scope: 'test', limit: 1, used: consumed, remaining: 1 - consumed, children: [] }; },
        },
      }),
    });

    assert.equal(page.status, 'complete');
    assert.equal(page.fetch_source, 'browser_run');
    assert.equal(page.provider, 'Cloudflare Browser Run');
    assert.equal(page.browser_ms_used, 1234);
    assert.equal(page.browser_fallback?.status, 'complete');
    assert.equal(page.browser_fallback?.reserved_seconds, 20);
    assert.equal(page.html, renderedHtml);
    assert.equal(page.headers.has('content-type'), false);
    assert.equal(consumed, 1);
    assert.equal(kv.calls.key, 'browser:2026-07-14');
    assert.equal(kv.calls.value, '20');
    assert.equal(binding.calls.length, 1);
    assert.equal(binding.calls[0].action, 'content');
    assert.equal(binding.calls[0].options.actionTimeout, 20_000);
    assert.equal(binding.calls[0].options.gotoOptions.waitUntil, 'networkidle2');
    assert.ok(binding.calls[0].options.rejectResourceTypes.includes('image'));
    assert.ok(binding.calls[0].options.rejectResourceTypes.includes('websocket'));
  });

  it('renders non-HTML 403 and Cloudflare 52x responses after challenge detection', async () => {
    const cases = [
      {
        status: 403,
        reason: 'HTTP 403 Forbidden — request blocked by server or WAF',
      },
      {
        status: 522,
        reason: 'Cloudflare origin error HTTP 522 — no real content served',
      },
    ];

    for (const testCase of cases) {
      const binding = bindingWith(() => successResponse());
      const page = await fetchAuditPage(candidate, () => Promise.resolve(new Response('blocked upstream', {
        status: testCase.status,
        headers: { 'content-type': 'application/json' },
      })), {
        browserFallback: browserOptions({ binding }),
      });

      assert.equal(page.status, 'complete');
      assert.equal(page.fetch_source, 'browser_run');
      assert.equal(page.fallback_reason, testCase.reason);
      assert.equal(binding.calls.length, 1);
    }
  });

  it('maps provider HTTP 429 to a retryable rate-limit error', async () => {
    const binding = bindingWith(() => new Response(JSON.stringify({
      success: false,
      errors: [{ code: 429, message: 'rate limited' }],
    }), { status: 429, headers: { 'content-type': 'application/json' } }));
    const page = await fetchAuditPage(candidate, challengeFetcher, {
      browserFallback: browserOptions({ binding }),
    });

    assert.equal(page.status, 'error');
    assert.equal(page.browser_fallback?.error?.code, 'BROWSER_RUN_RATE_LIMITED');
    assert.equal(page.browser_fallback?.error?.retryable, true);
  });

  it('uses the provider HTTP status even when a non-2xx body is malformed', async () => {
    const binding = bindingWith(() => new Response('<html>gateway error</html>', { status: 502 }));
    const page = await fetchAuditPage(candidate, challengeFetcher, {
      browserFallback: browserOptions({ binding }),
    });

    assert.equal(page.browser_fallback?.error?.code, 'BROWSER_RUN_UPSTREAM_ERROR');
    assert.equal(page.browser_fallback?.error?.retryable, true);
  });

  it('maps a malformed successful envelope to a stable invalid-response error', async () => {
    const binding = bindingWith(() => new Response('{not-json', { status: 200 }));
    const page = await fetchAuditPage(candidate, challengeFetcher, {
      browserFallback: browserOptions({ binding }),
    });

    assert.equal(page.browser_fallback?.error?.code, 'BROWSER_RUN_INVALID_RESPONSE');
  });

  it('maps Cloudflare upstream code 6002 to timeout without leaking tokens', async () => {
    const binding = bindingWith(() => new Response(JSON.stringify({
      success: false,
      errors: [{ code: 6002, message: 'timeout token=super-secret' }],
    }), { status: 200 }));
    const page = await fetchAuditPage(candidate, challengeFetcher, {
      browserFallback: browserOptions({ binding }),
    });

    assert.equal(page.browser_fallback?.error?.code, 'BROWSER_RUN_TIMEOUT');
    assert.equal(page.browser_fallback?.error?.upstream_code, '6002');
    assert.match(page.browser_fallback?.error?.message ?? '', /token=\[redacted\]/);
    assert.doesNotMatch(page.browser_fallback?.error?.message ?? '', /super-secret/);
  });

  it('rejects a success envelope whose rendered target status is an HTTP error', async () => {
    const binding = bindingWith(() => new Response(JSON.stringify({
      success: true,
      result: '<!doctype html><html><head><title>Missing</title></head><body><h1>Not found</h1></body></html>',
      meta: { status: 404 },
    }), { status: 200 }));
    const page = await fetchAuditPage(candidate, challengeFetcher, {
      browserFallback: browserOptions({ binding }),
    });

    assert.equal(page.status, 'error');
    assert.equal(page.browser_fallback?.error?.code, 'BROWSER_RUN_TARGET_HTTP_ERROR');
    assert.equal(page.browser_fallback?.error?.target_status, 404);
    assert.equal(page.browser_fallback?.error?.retryable, false);
  });

  it('times out a hung Quick Action using the bounded attempt hook', async () => {
    const binding = bindingWith(() => new Promise(() => {}));
    const page = await fetchAuditPage(candidate, challengeFetcher, {
      browserFallback: browserOptions({ binding, attemptTimeoutMs: 5 }),
    });

    assert.equal(page.browser_fallback?.error?.code, 'BROWSER_RUN_TIMEOUT');
    assert.equal(binding.calls.length, 1);
  });

  it('classifies oversized direct and Browser Run responses with stable codes', async () => {
    const directBinding = bindingWith(() => successResponse());
    const direct = await fetchAuditPage(candidate, () => Promise.resolve(new Response('x', {
      status: 200,
      headers: {
        'content-type': 'text/html',
        'content-length': String(2 * 1024 * 1024 + 1),
      },
    })), {
      browserFallback: browserOptions({ binding: directBinding }),
    });
    assert.equal(direct.error_code, 'AUDIT_RESPONSE_TOO_LARGE');
    assert.equal(directBinding.calls.length, 0);

    const envelopeBinding = bindingWith(() => new Response('x', {
      status: 200,
      headers: { 'content-length': String(3 * 1024 * 1024) },
    }));
    const envelope = await fetchAuditPage(candidate, challengeFetcher, {
      browserFallback: browserOptions({ binding: envelopeBinding }),
    });
    assert.equal(envelope.browser_fallback?.error?.code, 'BROWSER_RUN_RESPONSE_TOO_LARGE');
  });

  it('allows the registrable root and subdomains without matching evil suffixes', () => {
    const [source] = buildBrowserAllowRequestPattern('www.example.com');
    const pattern = new RegExp(source, 'i');
    assert.equal(pattern.test('https://example.com/'), true);
    assert.equal(pattern.test('https://www.example.com/path'), true);
    assert.equal(pattern.test('https://deep.blog.example.com/path'), true);
    assert.equal(pattern.test('https://example.com.evil.test/'), false);
    assert.equal(pattern.test('https://notexample.com/'), false);
  });

  it('never invokes Browser Run for a normal direct HTML success', async () => {
    const binding = bindingWith(() => successResponse());
    const page = await fetchAuditPage(candidate, () => Promise.resolve(new Response(renderedHtml, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })), {
      browserFallback: browserOptions({ binding }),
    });

    assert.equal(page.status, 'complete');
    assert.equal(page.fetch_source, 'http');
    assert.equal(binding.calls.length, 0);
  });

  it('rejects a Chinese access notice instead of auditing it as the real homepage', async () => {
    const noticeHtml = `<!doctype html><html lang="zh-CN"><head><title>提醒，ipv6已关闭 | NodeSeek</title></head>
      <body><main><img src="/notice.png"><p>提醒：当前 IPv6 入口已关闭，请切换网络后再访问</p></main></body></html>`;
    const page = await fetchAuditPage(candidate, () => Promise.resolve(new Response(noticeHtml, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })));

    assert.equal(page.status, 'error');
    assert.equal(page.error_code, 'AUDIT_BOT_CHALLENGE');
    assert.match(page.error ?? '', /interstitial|access notice/i);
  });

  it('rejects a SiteGround 202 verification page with a stable challenge error', async () => {
    const page = await fetchAuditPage(candidate, () => Promise.resolve(new Response(siteGroundChallengeHtml, {
      status: 202,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })));

    assert.equal(page.status, 'error');
    assert.equal(page.error_code, 'AUDIT_BOT_CHALLENGE');
    assert.equal(page.status_code, 202);
    assert.match(page.error ?? '', /siteground|challenge/i);
  });

  it('uses Browser Run once for a SiteGround 202 verification page', async () => {
    const binding = bindingWith(() => successResponse());
    const page = await fetchAuditPage(candidate, () => Promise.resolve(new Response(siteGroundChallengeHtml, {
      status: 202,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })), {
      browserFallback: browserOptions({ binding }),
    });

    assert.equal(page.status, 'complete');
    assert.equal(page.fetch_source, 'browser_run');
    assert.match(page.fallback_reason ?? '', /siteground|challenge/i);
    assert.equal(binding.calls.length, 1);
  });

  it('does not accept a SiteGround verification page returned by Browser Run', async () => {
    const binding = bindingWith(() => new Response(JSON.stringify({
      success: true,
      result: siteGroundChallengeHtml,
      meta: { status: 202 },
      errors: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const page = await fetchAuditPage(candidate, () => Promise.resolve(new Response(siteGroundChallengeHtml, {
      status: 202,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })), {
      browserFallback: browserOptions({ binding }),
    });

    assert.equal(page.status, 'error');
    assert.equal(page.error_code, 'AUDIT_BOT_CHALLENGE');
    assert.equal(page.browser_fallback?.error?.code, 'BROWSER_RUN_BOT_CHALLENGE');
    assert.equal(binding.calls.length, 1);
  });

  it('shares one attempt state so only the primary page can consume a render', async () => {
    const binding = bindingWith(() => successResponse());
    const state = { attempted: false };
    const options = browserOptions({ binding, attemptState: state });

    const primary = await fetchAuditPage(candidate, challengeFetcher, { browserFallback: options });
    const sampled = await fetchAuditPage({
      url: 'https://www.example.com/about',
      page_type: 'about',
      source: 'internal_link',
    }, challengeFetcher, { browserFallback: options });

    assert.equal(primary.fetch_source, 'browser_run');
    assert.equal(sampled.status, 'error');
    assert.equal(sampled.browser_fallback?.status, 'skipped');
    assert.equal(binding.calls.length, 1);

    const routeSource = fs.readFileSync(path.resolve('src/routes/audit.ts'), 'utf8');
    assert.equal((routeSource.match(/browserFallback:/g) ?? []).length, 1);
    assert.match(routeSource, /fetchAuditPage\(primaryCandidate, pageFetcher, \{/);
    assert.match(routeSource, /candidates\.map\(candidate => fetchAuditPage\(candidate, pageFetcher\)\)/);
  });

  it('detects an empty JavaScript app shell without flagging rendered content', () => {
    assert.equal(detectJavaScriptShell('<div id="root"></div><script src="/app.js"></script>'), true);
    assert.equal(detectJavaScriptShell(renderedHtml), false);
  });
});
