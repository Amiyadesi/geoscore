import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-external-evidence-'));
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
    'src/lib/audit-pages.ts',
    'src/lib/audit-core.ts',
    'src/modules/html_validator.ts',
    'src/modules/common_crawl.ts',
    'src/routes/audit.ts',
  ],
  { stdio: 'inherit' },
);

const require = createRequire(import.meta.url);
const htmlValidator = require(path.join(tmpDir, 'modules', 'html_validator.js'));
const commonCrawl = require(path.join(tmpDir, 'modules', 'common_crawl.js'));
const auditCore = require(path.join(tmpDir, 'lib', 'audit-core.js'));
const auditRoute = require(path.join(tmpDir, 'routes', 'audit.js'));

describe('optional provider module envelope', () => {
  it('preserves provider error evidence as a partial module result', async () => {
    const providerData = {
      status: 'error',
      source: 'Common Crawl Index',
      error: { code: 'COMMON_CRAWL_RATE_LIMITED', message: 'Provider rate limit reached' },
      retryable: true,
    };

    const result = await auditRoute.runModule('common_crawl', async () => providerData, 100);

    assert.equal(result.status, 'partial');
    assert.equal(result.error, providerData.error.message);
    assert.deepEqual(result.data, providerData);
  });
});

describe('W3C Nu HTML Checker evidence', () => {
  it('reports document errors as evidence-backed failures', async () => {
    const result = await htmlValidator.runHtmlValidation('https://example.com/post', {
      fetcher: async () => jsonResponse({
        url: 'https://example.com/post',
        messages: [{
          type: 'error',
          message: 'Element “img” is missing required attribute “alt”.',
          lastLine: 42,
          lastColumn: 9,
        }],
      }),
    });

    assert.equal(result.status, 'fail');
    assert.equal(result.summary.error_count, 1);
    assert.equal(result.source, 'W3C Nu HTML Checker');
    assert.equal(result.page_url, 'https://example.com/post');
    assert.match(result.evidence.join('\n'), /line 42/);
    assert.match(result.evidence.join('\n'), /missing required attribute/);
    assert.match(result.provenance.documentation, /validator\/validator/);
  });

  it('treats non-document errors as unknown even when document errors are also present', async () => {
    const result = await htmlValidator.runHtmlValidation('https://example.com/', {
      fetcher: async () => jsonResponse({
        messages: [
          { type: 'error', message: 'A document error reported before the fetch failed.' },
          { type: 'non-document-error', subType: 'io', message: 'HTTP resource not retrievable.' },
        ],
      }),
    });

    assert.equal(result.status, 'unknown');
    assert.equal(result.summary.indeterminate_count, 1);
    assert.equal(result.retryable, true);
    assert.notEqual(result.status, 'fail');
  });

  it('passes documents with warnings but no errors', async () => {
    const result = await htmlValidator.runHtmlValidation('https://example.com/', {
      fetcher: async () => jsonResponse({
        messages: [{ type: 'info', subType: 'warning', message: 'Consider adding a lang attribute.' }],
      }),
    });

    assert.equal(result.status, 'pass');
    assert.equal(result.summary.warning_count, 1);
    assert.equal(result.summary.error_count, 0);
  });

  it('surfaces rate limits as retryable errors instead of false failures', async () => {
    let cancelled = false;
    const result = await htmlValidator.runHtmlValidation('https://example.com/', {
      fetcher: async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('Too many requests')); },
        cancel() { cancelled = true; },
      }), { status: 429 }),
    });

    assert.equal(result.status, 'error');
    assert.equal(result.error?.code, 'W3C_RATE_LIMITED');
    assert.equal(result.retryable, true);
    assert.equal(result.summary.error_count, 0);
    assert.equal(cancelled, true);
  });

  it('rejects oversized and malformed validator bodies without unbounded reads', async () => {
    let cancelled = false;
    const oversized = await htmlValidator.runHtmlValidation('https://example.com/', {
      fetcher: async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array([123])); },
        cancel() { cancelled = true; },
      }), { status: 200, headers: { 'Content-Length': String(500 * 1024 + 1) } }),
    });
    assert.equal(oversized.status, 'error');
    assert.equal(oversized.error?.code, 'W3C_RESPONSE_TOO_LARGE');
    assert.equal(cancelled, true);

    const malformed = await htmlValidator.runHtmlValidation('https://example.com/', {
      fetcher: async () => new Response('{not json', { status: 200 }),
    });
    assert.equal(malformed.status, 'error');
    assert.equal(malformed.error?.code, 'W3C_INVALID_RESPONSE');
  });

  it('surfaces network timeouts as retryable provider errors', async () => {
    const result = await htmlValidator.runHtmlValidation('https://example.com/', {
      fetcher: async () => { throw new DOMException('Timed out', 'AbortError'); },
    });
    assert.equal(result.status, 'error');
    assert.equal(result.error?.code, 'W3C_UNAVAILABLE');
    assert.equal(result.retryable, true);
  });
});

describe('Common Crawl presence evidence', () => {
  const collection = {
    id: 'CC-MAIN-2026-25',
    index_url: 'https://index.commoncrawl.org/CC-MAIN-2026-25-index',
  };

  it('reports a latest-collection capture without claiming search indexing', async () => {
    let requestedUrl = '';
    const result = await commonCrawl.runCommonCrawlPresence('example.com', {
      collection,
      fetcher: async (url) => {
        requestedUrl = url;
        return new Response(JSON.stringify({
          urlkey: 'com,example)/',
          timestamp: '20260605214940',
          url: 'https://example.com/',
          mime: 'text/html',
          status: '200',
          digest: 'B6NJ6JIZT3B7E442X7OKPSKPSC2TEWYR',
        }), { status: 200 });
      },
    });

    assert.equal(result.status, 'pass');
    assert.equal(result.present, true);
    assert.equal(result.collection, collection.id);
    assert.equal(result.captures[0]?.url, 'https://example.com/');
    assert.match(requestedUrl, /example\.com%2F\*/);
    assert.match(result.evidence.join('\n'), /does not prove Google indexing or AI citation/i);
    assert.equal(result.weight, 0);
  });

  it('treats no capture in the latest collection as unknown, not a failure', async () => {
    const result = await commonCrawl.runCommonCrawlPresence('blog.sayori.org', {
      collection,
      fetcher: async () => new Response('No Captures found for: blog.sayori.org/*', { status: 404 }),
    });

    assert.equal(result.status, 'unknown');
    assert.equal(result.present, false);
    assert.notEqual(result.status, 'fail');
    assert.match(result.evidence.join('\n'), /latest collection/);
  });

  it('does not disguise a proxy-generated HTTP 400 as an empty collection result', async () => {
    let requestedUrl = '';
    const result = await commonCrawl.runCommonCrawlPresence('sayori.org', {
      collection,
      fetcher: async (url) => {
        requestedUrl = url;
        return new Response("Error: ('Connection aborted.', RemoteDisconnected('Remote end closed connection without response'))", { status: 400 });
      },
    });

    const query = new URL(requestedUrl);
    assert.deepEqual(query.searchParams.getAll('filter'), ['status:200', 'mime:text/html']);
    assert.equal(query.searchParams.get('url'), 'sayori.org/*');
    assert.equal(result.status, 'error');
    assert.equal(result.error?.code, 'COMMON_CRAWL_UPSTREAM_ERROR');
    assert.equal(result.error?.http_status, 400);
    assert.equal(result.retryable, false);
    assert.equal(result.present, null);
  });

  it('surfaces upstream failures as retryable errors', async () => {
    let cancelled = false;
    const result = await commonCrawl.runCommonCrawlPresence('example.com', {
      collection,
      fetcher: async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('upstream unavailable')); },
        cancel() { cancelled = true; },
      }), { status: 503 }),
    });

    assert.equal(result.status, 'error');
    assert.equal(result.error?.code, 'COMMON_CRAWL_UPSTREAM_ERROR');
    assert.equal(result.retryable, true);
    assert.equal(result.present, null);
    assert.equal(cancelled, true);
  });

  it('rejects oversized, malformed, and timed-out index responses', async () => {
    let cancelled = false;
    const oversized = await commonCrawl.runCommonCrawlPresence('example.com', {
      collection,
      fetcher: async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array([123])); },
        cancel() { cancelled = true; },
      }), { status: 200, headers: { 'Content-Length': String(200 * 1024 + 1) } }),
    });
    assert.equal(oversized.status, 'error');
    assert.equal(oversized.error?.code, 'COMMON_CRAWL_RESPONSE_TOO_LARGE');
    assert.equal(cancelled, true);

    const malformed = await commonCrawl.runCommonCrawlPresence('example.com', {
      collection,
      fetcher: async () => new Response('{not json', { status: 200 }),
    });
    assert.equal(malformed.status, 'error');
    assert.equal(malformed.error?.code, 'COMMON_CRAWL_INVALID_RESPONSE');

    const timeout = await commonCrawl.runCommonCrawlPresence('example.com', {
      collection,
      fetcher: async () => { throw new DOMException('Timed out', 'AbortError'); },
    });
    assert.equal(timeout.status, 'error');
    assert.equal(timeout.error?.code, 'COMMON_CRAWL_UNAVAILABLE');
    assert.equal(timeout.retryable, true);
  });
});

describe('external evidence audit contract', () => {
  it('normalizes provider data and never recommends a provider outage', () => {
    const context = {
      site_archetype: 'personal_blog', industry_vertical: null, business_model: 'content',
      entity: { name: 'Example Author', type: 'Person', source: 'schema', page_url: 'https://example.com/' },
      locality: null, locale: 'en', root_domain: 'example.com', page_types: ['home'], confidence: 0.9, evidence: [],
    };
    const page = {
      url: 'https://example.com/', final_url: 'https://example.com/', page_type: 'home', source: 'requested',
      status: 'complete', title: 'Example', locale: 'en', html: '<html><title>Example</title><h1>Example</h1></html>',
      headers: new Headers(), response_ms: 1, status_code: 200,
    };
    const modules = {
      html_validator: { status: 'ok', data: {
        status: 'fail', confidence: 0.95, source: 'W3C Nu HTML Checker', page_url: page.url,
        evidence: ['error at line 4: Element img is missing required attribute alt'],
      } },
      common_crawl: { status: 'ok', data: {
        status: 'error', confidence: 0, source: 'Common Crawl Index', page_url: page.url,
        evidence: ['COMMON_CRAWL_RATE_LIMITED: rate limit reached'],
      } },
    };

    const checks = auditCore.buildNormalizedChecks(context, [page], modules);
    const htmlCheck = checks.find((item) => item.id === 'seo.html_conformance');
    const crawlCheck = checks.find((item) => item.id === 'geo.common_crawl_presence');
    assert.equal(htmlCheck?.status, 'fail');
    assert.equal(crawlCheck?.status, 'error');
    assert.equal(crawlCheck?.weight, 0);

    const recommendations = auditCore.buildRecommendations(context, checks);
    assert.ok(recommendations.some((item) => item.id === 'seo.html_conformance'));
    assert.ok(!recommendations.some((item) => item.id === 'geo.common_crawl_presence'));
  });
});

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}
