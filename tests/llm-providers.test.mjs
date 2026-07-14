import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-llm-providers-'));
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
    '--strict',
    '--skipLibCheck',
    '--rootDir', 'src',
    '--outDir', tmpDir,
    'src/lib/ai-models.ts',
    'src/lib/llm.ts',
    'src/lib/subrequest-budget.ts',
    'src/lib/types.ts',
  ],
  { stdio: 'inherit' },
);

const require = createRequire(import.meta.url);
const { callLlm } = require(path.join(tmpDir, 'lib', 'llm.js'));
const { GROQ_CHAT_MODEL, OPENROUTER_CHAT_MODEL } = require(path.join(tmpDir, 'lib', 'ai-models.js'));

const MESSAGES = [{ role: 'user', content: 'Return a short answer.' }];

function makeKv(initial = {}) {
  const state = new Map(Object.entries(initial));
  const writes = [];
  return {
    state,
    writes,
    async get(key) {
      // Response cache is deliberately disabled in routing tests.
      if (key.startsWith('llm:json-') || key.startsWith('llm:text-')) return null;
      return state.get(key) ?? null;
    },
    async put(key, value, options) {
      writes.push({ key, value, options });
      if (key.startsWith('llm:circuit:')) state.set(key, value);
    },
    async delete(key) { state.delete(key); },
  };
}

function makeEnv(overrides = {}) {
  return {
    AUDIT_KV: makeKv(),
    AI: {
      async run() { throw new Error('Workers AI unavailable'); },
    },
    PUBLIC_APP_URL: 'https://geo.sayori.org',
    ...overrides,
  };
}

async function withFetchMock(mock, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function completion(content) {
  return new Response(JSON.stringify({
    choices: [{ message: { content } }],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('LLM provider routing', () => {
  it('uses Workers AI first and does not call an external API after success', async () => {
    const env = makeEnv({
      AI: { async run() { return { response: 'workers answer' }; } },
      API_KEY: 'generic-key',
      API_BASE_URL: 'https://api.example.test/v1',
      API_MODEL: 'test-model',
    });
    let externalCalls = 0;
    const text = await withFetchMock(async () => {
      externalCalls += 1;
      return completion('external answer');
    }, () => callLlm(MESSAGES, 80, env));

    assert.equal(text, 'workers answer');
    assert.equal(externalCalls, 0);
  });

  it('stable-hashes across the healthy generic/Groq pair and never selects the reserve', async () => {
    const urls = [];
    const env = makeEnv({
      API_KEY: 'generic-key',
      API_BASE_URL: 'https://api.example.test/v1',
      API_MODEL: 'generic-model',
      GROQ_API_KEY: 'groq-key',
      OPENROUTER_API_KEY: 'reserve-key',
    });

    await withFetchMock(async (rawUrl) => {
      urls.push(String(rawUrl));
      return completion('answer');
    }, async () => {
      await callLlm(MESSAGES, 80, env);
      await callLlm(MESSAGES, 80, env);
    });

    assert.equal(urls.length, 2);
    assert.equal(urls[0], urls[1]);
    assert.ok([
      'https://api.example.test/v1/chat/completions',
      'https://api.groq.com/openai/v1/chat/completions',
    ].includes(urls[0]));
    assert.notEqual(urls[0], 'https://openrouter.ai/api/v1/chat/completions');
  });

  it('uses API_BASE_URL and API_MODEL without a hard-coded generic vendor', async () => {
    const requests = [];
    const env = makeEnv({
      API_KEY: 'generic-key',
      API_BASE_URL: 'https://gateway.example.test/openai/v1/',
      API_MODEL: 'free-model',
    });

    const text = await withFetchMock(async (rawUrl, init) => {
      requests.push({ url: String(rawUrl), body: JSON.parse(String(init?.body)) });
      return completion('generic answer');
    }, () => callLlm(MESSAGES, 80, env));

    assert.equal(text, 'generic answer');
    assert.equal(requests[0].url, 'https://gateway.example.test/openai/v1/chat/completions');
    assert.equal(requests[0].body.model, 'free-model');
  });

  it('uses OpenRouter only when the API/Groq pair is unavailable', async () => {
    const requests = [];
    const env = makeEnv({ OPENROUTER_API_KEY: 'reserve-key' });

    const text = await withFetchMock(async (rawUrl, init) => {
      requests.push({ url: String(rawUrl), init, body: JSON.parse(String(init?.body)) });
      return completion('reserve answer');
    }, () => callLlm(MESSAGES, 80, env, { temperature: 0.1 }));

    assert.equal(text, 'reserve answer');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(requests[0].body.model, OPENROUTER_CHAT_MODEL);
    assert.equal(requests[0].body.temperature, 0.1);
    assert.equal(new Headers(requests[0].init.headers).get('HTTP-Referer'), 'https://geo.sayori.org');
  });

  it('opens a KV circuit and lets the next request use the reserve without cascading the failed call', async () => {
    const urls = [];
    const kv = makeKv();
    const env = makeEnv({
      AUDIT_KV: kv,
      API_KEY: 'generic-key',
      API_BASE_URL: 'https://api.example.test/v1',
      API_MODEL: 'generic-model',
      OPENROUTER_API_KEY: 'reserve-key',
    });

    await withFetchMock(async rawUrl => {
      urls.push(String(rawUrl));
      if (urls.length === 1) {
        return new Response('quota reached', { status: 429, headers: { 'Retry-After': '45' } });
      }
      return completion('reserve answer');
    }, async () => {
      await assert.rejects(callLlm(MESSAGES, 80, env), /External API 429/);
      assert.deepEqual(urls, ['https://api.example.test/v1/chat/completions']);
      assert.equal(await callLlm(MESSAGES, 80, env), 'reserve answer');
    });

    assert.deepEqual(urls, [
      'https://api.example.test/v1/chat/completions',
      'https://openrouter.ai/api/v1/chat/completions',
    ]);
    const circuitWrite = kv.writes.find(item => item.key.endsWith(':api'));
    assert.equal(circuitWrite.options.expirationTtl, 45);
    assert.equal(JSON.parse(circuitWrite.value).reason, 'quota');
  });

  it('never cascades to a second external provider during one call', async () => {
    const urls = [];
    const env = makeEnv({
      GROQ_API_KEY: 'groq-key',
      OPENROUTER_API_KEY: 'reserve-key',
    });

    await assert.rejects(
      withFetchMock(async rawUrl => {
        urls.push(String(rawUrl));
        return new Response('upstream unavailable', { status: 503 });
      }, () => callLlm(MESSAGES, 80, env)),
      /External API 503/,
    );

    assert.deepEqual(urls, ['https://api.groq.com/openai/v1/chat/completions']);
  });

  it('uses bounded circuit cooldowns for auth, quota, server, and network errors', async () => {
    const cases = [
      { status: 401, expectedReason: 'auth', expectedTtl: 3600 },
      { status: 429, expectedReason: 'quota', expectedTtl: 300 },
      { status: 503, expectedReason: 'server', expectedTtl: 120 },
    ];

    for (const testCase of cases) {
      const kv = makeKv();
      const env = makeEnv({ GROQ_API_KEY: 'secret', AUDIT_KV: kv });
      await assert.rejects(withFetchMock(
        async () => new Response('failed', { status: testCase.status }),
        () => callLlm(MESSAGES, 80, env),
      ));
      const write = kv.writes.find(item => item.key.endsWith(':groq'));
      assert.equal(write.options.expirationTtl, testCase.expectedTtl);
      assert.equal(JSON.parse(write.value).reason, testCase.expectedReason);
    }

    const kv = makeKv();
    const env = makeEnv({ GROQ_API_KEY: 'secret', AUDIT_KV: kv });
    await assert.rejects(withFetchMock(
      async () => { throw new TypeError('network down'); },
      () => callLlm(MESSAGES, 80, env),
    ), /network error/);
    const write = kv.writes.find(item => item.key.endsWith(':groq'));
    assert.equal(write.options.expirationTtl, 60);
    assert.equal(JSON.parse(write.value).reason, 'network');
  });

  it('aborts a timed-out external request and opens the network circuit', async () => {
    const kv = makeKv();
    const env = makeEnv({ GROQ_API_KEY: 'secret', AUDIT_KV: kv });
    const nativeSetTimeout = globalThis.setTimeout;

    try {
      globalThis.setTimeout = (callback, _delay, ...args) =>
        nativeSetTimeout(callback, 0, ...args);

      await assert.rejects(withFetchMock(
        async (_url, init) => new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            reject(init.signal.reason ?? new DOMException('The operation was aborted', 'AbortError'));
          }, { once: true });
        }),
        () => callLlm(MESSAGES, 80, env),
      ), /network error/);
    } finally {
      globalThis.setTimeout = nativeSetTimeout;
    }

    const write = kv.writes.find(item => item.key.endsWith(':groq'));
    assert.equal(write.options.expirationTtl, 60);
    assert.equal(JSON.parse(write.value).reason, 'network');
  });

  it('bounds JSON compatibility retries to the same external endpoint', async () => {
    const payloads = [];
    const urls = [];
    const labels = [];
    const env = makeEnv({ GROQ_API_KEY: 'groq-key' });

    const text = await withFetchMock(async (rawUrl, init) => {
      urls.push(String(rawUrl));
      payloads.push(JSON.parse(String(init?.body)));
      if (payloads.length === 1) {
        return new Response('{"error":"response_format unsupported"}', { status: 400 });
      }
      return completion('{"ok":true}');
    }, () => callLlm(MESSAGES, 80, env, {
      jsonMode: true,
      budget: { consume(label) { labels.push(label); } },
    }));

    assert.equal(text, '{"ok":true}');
    assert.deepEqual(urls, [
      'https://api.groq.com/openai/v1/chat/completions',
      'https://api.groq.com/openai/v1/chat/completions',
    ]);
    assert.deepEqual(payloads[0].response_format, { type: 'json_object' });
    assert.equal(payloads[1].response_format, undefined);
    assert.deepEqual(labels.slice(1), ['external-ai', 'external-ai']);
  });

  it('fails clearly without naming configured providers when no fallback is healthy', async () => {
    await assert.rejects(
      callLlm(MESSAGES, 80, makeEnv({ API_KEY: 'key-without-config' })),
      error => {
        assert.match(error.message, /no healthy external API/);
        assert.doesNotMatch(error.message, /GROQ|OPENROUTER|API_KEY/);
        return true;
      },
    );
  });

  it('redacts every configured secret and keeps errors provider-neutral', async () => {
    const secret = 'generic-super-secret-value';
    const env = makeEnv({
      API_KEY: secret,
      API_BASE_URL: 'https://hiddenvendor.example/v1',
      API_MODEL: 'test-model',
    });
    const upstream = `bad credential ${secret} ${'x'.repeat(400)}`;

    await assert.rejects(
      withFetchMock(
        async () => new Response(`${upstream} from hiddenvendor at https://hiddenvendor.example`, { status: 401 }),
        () => callLlm(MESSAGES, 80, env),
      ),
      error => {
        assert.match(error.message, /^External API 401:/);
        assert.doesNotMatch(error.message, new RegExp(secret));
        assert.doesNotMatch(error.message, /hiddenvendor|Groq|OpenRouter/i);
        assert.ok(error.message.length <= 170);
        return true;
      },
    );
  });

  it('keeps the Groq runtime model explicit', async () => {
    const env = makeEnv({ GROQ_API_KEY: 'groq-key' });
    let model;
    await withFetchMock(async (_url, init) => {
      model = JSON.parse(String(init?.body)).model;
      return completion('ok');
    }, () => callLlm(MESSAGES, 80, env));
    assert.equal(model, GROQ_CHAT_MODEL);
  });
});
