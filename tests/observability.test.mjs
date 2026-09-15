import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { afterEach, describe, it } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-observability-'));
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
    'src/index.ts',
  ],
  { stdio: 'inherit' },
);

const require = createRequire(import.meta.url);
const { buildErrorPayload, observabilityConfig, reportError } = require(
  path.join(tmpDir, 'lib', 'observability.js'),
);
const worker = require(path.join(tmpDir, 'index.js'));

const INGESTION_KEY = 'test-ingestion-key-value';
const ENDPOINT = 'https://ingest.us2.signoz.cloud';
const configuredEnv = {
  SIGNOZ_OTLP_ENDPOINT: ENDPOINT,
  SIGNOZ_INGESTION_KEY: INGESTION_KEY,
  SIGNOZ_SERVICE_NAME: 'sayori-geoscore-api',
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function capturingFetcher(response = new Response('', { status: 200 })) {
  const calls = [];
  return {
    calls,
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return response;
    },
  };
}

function spanOf(payload) {
  return payload.resourceSpans[0].scopeSpans[0].spans[0];
}

describe('SigNoz error reporting', () => {
  it('stays a no-op when the endpoint or the ingestion key is missing', async () => {
    const { calls, fetcher } = capturingFetcher();

    assert.equal(await reportError({}, new Error('boom'), { fetcher }), false);
    assert.equal(
      await reportError({ SIGNOZ_OTLP_ENDPOINT: ENDPOINT }, new Error('boom'), { fetcher }),
      false,
    );
    assert.equal(
      await reportError({ SIGNOZ_INGESTION_KEY: INGESTION_KEY }, new Error('boom'), { fetcher }),
      false,
    );
    assert.equal(calls.length, 0);
    assert.equal(observabilityConfig({}), null);
  });

  it('rejects endpoints that are malformed or not HTTPS', () => {
    assert.equal(observabilityConfig({ SIGNOZ_OTLP_ENDPOINT: 'not a url', SIGNOZ_INGESTION_KEY: INGESTION_KEY }), null);
    assert.equal(observabilityConfig({ SIGNOZ_OTLP_ENDPOINT: 'http://ingest.local', SIGNOZ_INGESTION_KEY: INGESTION_KEY }), null);
  });

  it('normalizes the endpoint to an OTLP HTTP traces URL', () => {
    const config = observabilityConfig({ ...configuredEnv, SIGNOZ_OTLP_ENDPOINT: `${ENDPOINT}/` }, '2.4.7');
    assert.equal(config.tracesUrl, `${ENDPOINT}/v1/traces`);
    assert.equal(config.serviceName, 'sayori-geoscore-api');
    assert.equal(config.serviceVersion, '2.4.7');
  });

  it('sends one exception span and keeps the ingestion key out of the payload', async () => {
    const { calls, fetcher } = capturingFetcher();
    const error = new TypeError('cannot read properties of undefined (reading prepare)');

    const reported = await reportError(configuredEnv, error, {
      attributes: { 'http.method': 'GET', 'http.route': '/api/meta', 'http.status': 500, ignored: undefined },
      version: '2.4.7',
      now: 1_700_000_000_000,
      fetcher,
    });

    assert.equal(reported, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${ENDPOINT}/v1/traces`);
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
    assert.equal(calls[0].init.headers['signoz-ingestion-key'], INGESTION_KEY);

    const payload = JSON.parse(calls[0].init.body);
    const span = spanOf(payload);
    assert.match(span.traceId, /^[0-9a-f]{32}$/);
    assert.match(span.spanId, /^[0-9a-f]{16}$/);
    assert.equal(span.kind, 1);
    assert.equal(span.status.code, 2);
    assert.equal(span.startTimeUnixNano, '1700000000000000000');
    assert.deepEqual(
      span.attributes.map(attribute => attribute.key),
      ['http.method', 'http.route', 'http.status'],
    );
    assert.equal(span.events[0].name, 'exception');
    assert.equal(
      span.events[0].attributes.find(attribute => attribute.key === 'exception.type').value.stringValue,
      'TypeError',
    );
    assert.match(
      span.events[0].attributes.find(attribute => attribute.key === 'exception.message').value.stringValue,
      /cannot read properties/,
    );
    assert.ok(
      span.events[0].attributes.find(attribute => attribute.key === 'exception.stacktrace').value.stringValue.includes('at '),
      'the exception event carries a stack trace',
    );
    assert.equal(payload.resourceSpans[0].resource.attributes[0].value.stringValue, 'sayori-geoscore-api');
    assert.doesNotMatch(calls[0].init.body, /test-ingestion-key-value/);
  });

  it('bounds attribute values, message length, and attribute count', () => {
    const payload = buildErrorPayload(
      observabilityConfig(configuredEnv, '2.4.7'),
      new Error(`line one\nline two ${'x'.repeat(5000)}`),
      Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`attribute.${index}`, 'y'.repeat(2000)])),
    );

    const span = spanOf(payload);
    assert.equal(span.attributes.length, 24);
    for (const attribute of span.attributes) {
      assert.ok(attribute.value.stringValue.length <= 513);
      assert.doesNotMatch(attribute.value.stringValue, /\n/);
    }
    // The exception message keeps newlines (standard OTel behavior) but is still bounded.
    const message = span.events[0].attributes.find(attribute => attribute.key === 'exception.message').value.stringValue;
    assert.ok(message.length <= 513);
    assert.match(message, /^line one\nline two/);
    const stacktrace = span.events[0].attributes.find(attribute => attribute.key === 'exception.stacktrace').value.stringValue;
    assert.ok(stacktrace.length <= 4097);
  });

  it('describes non-Error throws instead of failing', () => {
    const config = observabilityConfig(configuredEnv, '2.4.7');
    const thrownString = spanOf(buildErrorPayload(config, 'plain failure'));
    assert.equal(thrownString.events[0].attributes[0].value.stringValue, 'NonError');
    assert.equal(thrownString.events[0].attributes[1].value.stringValue, 'plain failure');

    const circular = {};
    circular.self = circular;
    const thrownCircular = spanOf(buildErrorPayload(config, circular));
    assert.equal(thrownCircular.events[0].attributes[1].value.stringValue, '[unserializable thrown value]');
  });

  it('resolves false when the exporter fails or rejects', async () => {
    const rejected = await reportError(configuredEnv, new Error('boom'), {
      fetcher: async () => { throw new Error('network down'); },
    });
    assert.equal(rejected, false);

    const notOk = await reportError(configuredEnv, new Error('boom'), {
      fetcher: async () => new Response('unauthorized', { status: 401 }),
    });
    assert.equal(notOk, false);
  });

  it('dispatches through waitUntil when the runtime provides one', async () => {
    let dispatched = null;
    const { fetcher } = capturingFetcher();

    const reported = reportError(configuredEnv, new Error('boom'), {
      fetcher,
      waitUntil: promise => { dispatched = promise; },
    });

    assert.ok(dispatched);
    assert.equal(await reported, true);
    assert.equal(await dispatched, true);
  });
});

describe('worker error boundary', () => {
  const originalConsoleError = console.error;

  function silenceConsoleError() {
    const logged = [];
    console.error = (...args) => { logged.push(args); };
    return logged;
  }

  function requestWithFailingHeaders() {
    return {
      method: 'GET',
      url: 'https://geo-api.example/api/search?q=seo',
      headers: {
        get() {
          throw new Error('header access failed');
        },
      },
    };
  }

  it('answers a generic 500 and reports one span when a request handler throws', async () => {
    const { calls, fetcher } = capturingFetcher();
    const reports = [];
    const logged = silenceConsoleError();
    // The boundary reports through the global fetch, so route the exporter
    // through the capture stub while leaving the worker itself offline.
    globalThis.fetch = (url, init) => fetcher(url, init);

    const response = await worker.default.fetch(
      requestWithFailingHeaders(),
      { ...configuredEnv, BUDGET_KV: undefined },
      { waitUntil: promise => reports.push(promise) },
    );

    assert.equal(response.status, 500);
    assert.equal(response.headers.get('Content-Type'), 'application/json');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.deepEqual(await response.json(), { error: 'Internal server error' });
    assert.equal(logged.length, 1, 'the failure is logged for wrangler tail');

    await Promise.all(reports);
    console.error = originalConsoleError;
    assert.equal(calls.length, 1);
    const span = spanOf(JSON.parse(calls[0].init.body));
    assert.equal(
      span.events[0].attributes.find(attribute => attribute.key === 'exception.message').value.stringValue,
      'header access failed',
    );
    assert.equal(
      span.attributes.find(attribute => attribute.key === 'http.route').value.stringValue,
      '/api/search',
    );
  });

  it('does not call SigNoz when monitoring is not configured', async () => {
    let nativeCalls = 0;
    globalThis.fetch = async () => {
      nativeCalls += 1;
      return new Response('unexpected', { status: 200 });
    };
    silenceConsoleError();

    const response = await worker.default.fetch(requestWithFailingHeaders(), {}, {});

    console.error = originalConsoleError;
    assert.equal(response.status, 500);
    assert.equal(nativeCalls, 0);
  });

  it('contains weekly cron failures instead of rejecting the scheduled handler', async () => {
    const { calls, fetcher } = capturingFetcher();
    globalThis.fetch = (url, init) => fetcher(url, init);
    silenceConsoleError();

    await worker.default.scheduled(
      { cron: '0 8 * * 1' },
      {
        ...configuredEnv,
        BUDGET_KV: {
          async delete() {
            throw new Error('kv unavailable');
          },
        },
      },
      { waitUntil: promise => void promise },
    );

    console.error = originalConsoleError;
    assert.equal(calls.length, 1);
    const span = spanOf(JSON.parse(calls[0].init.body));
    assert.equal(
      span.events[0].attributes.find(attribute => attribute.key === 'exception.message').value.stringValue,
      'kv unavailable',
    );
    assert.equal(
      span.attributes.find(attribute => attribute.key === 'cron.expression').value.stringValue,
      '0 8 * * 1',
    );
  });
});
