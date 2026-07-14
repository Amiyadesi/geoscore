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
const { API_CHAT_MODEL, OPENROUTER_CHAT_MODEL } = require(path.join(tmpDir, 'lib', 'ai-models.js'));

const MESSAGES = [{ role: 'user', content: 'Return a short answer.' }];

function makeEnv(overrides = {}) {
  return {
    AUDIT_KV: {
      async get() { return null; },
      async put() {},
    },
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

describe('LLM provider fallback', () => {
  it('uses generic API_KEY before Groq and OpenRouter without exposing a provider label', async () => {
    const requests = [];
    const env = makeEnv({
      API_KEY: 'api-test-key',
      GROQ_API_KEY: 'groq-test-key',
      OPENROUTER_API_KEY: 'openrouter-test-key',
    });

    const text = await withFetchMock(async (rawUrl, init) => {
      requests.push({ url: String(rawUrl), init, body: JSON.parse(String(init?.body)) });
      return completion('api answer');
    }, () => callLlm(MESSAGES, 80, env));

    assert.equal(text, 'api answer');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://opencode.ai/zen/v1/chat/completions');
    assert.equal(requests[0].body.model, API_CHAT_MODEL);
    assert.equal(new Headers(requests[0].init.headers).get('Authorization'), 'Bearer api-test-key');
  });

  it('uses OpenRouter when Workers AI is unavailable and Groq is not configured', async () => {
    const requests = [];
    const env = makeEnv({ OPENROUTER_API_KEY: 'openrouter-test-key' });

    const text = await withFetchMock(async (rawUrl, init) => {
      requests.push({ url: String(rawUrl), init, body: JSON.parse(String(init?.body)) });
      return completion('openrouter answer');
    }, () => callLlm(MESSAGES, 80, env, { temperature: 0.1 }));

    assert.equal(text, 'openrouter answer');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(requests[0].body.model, OPENROUTER_CHAT_MODEL);
    assert.equal(requests[0].body.max_tokens, 80);
    assert.equal(requests[0].body.temperature, 0.1);
    assert.equal(requests[0].body.response_format, undefined);

    const headers = new Headers(requests[0].init.headers);
    assert.equal(headers.get('Authorization'), 'Bearer openrouter-test-key');
    assert.equal(headers.get('Content-Type'), 'application/json');
    assert.equal(headers.get('HTTP-Referer'), 'https://geo.sayori.org');
    assert.equal(headers.get('X-Title'), 'Sayori GeoScore');
  });

  it('bounds JSON compatibility retries for Workers AI and OpenRouter', async () => {
    const payloads = [];
    const labels = [];
    const env = makeEnv({ OPENROUTER_API_KEY: 'openrouter-test-key' });

    const text = await withFetchMock(async (_rawUrl, init) => {
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
    assert.equal(payloads.length, 2);
    assert.deepEqual(payloads[0].response_format, { type: 'json_object' });
    assert.equal(payloads[1].response_format, undefined);
    assert.equal(labels.length, 3);
    assert.match(labels[0], /^workers-ai:/);
    assert.equal(labels[1], `openrouter:${OPENROUTER_CHAT_MODEL}`);
    assert.equal(labels[2], `openrouter:${OPENROUTER_CHAT_MODEL}`);

    let cfAttempts = 0;
    const compatibilityEnv = makeEnv({
      AI: {
        async run(_model, payload) {
          cfAttempts += 1;
          if (cfAttempts === 1) {
            const error = new Error('HTTP 400: response_format is unsupported');
            error.status = 400;
            throw error;
          }
          assert.equal(payload.response_format, undefined);
          return { response: '{"provider":"workers-ai"}' };
        },
      },
    });
    const cfText = await callLlm(MESSAGES, 80, compatibilityEnv, { jsonMode: true });
    assert.equal(cfText, '{"provider":"workers-ai"}');
    assert.equal(cfAttempts, 2);
  });

  it('prefers configured Groq and never calls OpenRouter after a Groq failure', async () => {
    const urls = [];
    const env = makeEnv({
      GROQ_API_KEY: 'groq-test-key',
      OPENROUTER_API_KEY: 'openrouter-test-key',
    });

    await assert.rejects(
      withFetchMock(async rawUrl => {
        urls.push(String(rawUrl));
        return new Response('Groq unavailable', { status: 503 });
      }, () => callLlm(MESSAGES, 80, env)),
      /Groq 503/,
    );

    assert.deepEqual(urls, ['https://api.groq.com/openai/v1/chat/completions']);
  });

  it('does not retry rate limits or unrelated external validation errors', async () => {
    for (const testCase of [
      { status: 429, body: 'rate limit reached' },
      { status: 422, body: 'invalid prompt payload' },
    ]) {
      let requests = 0;
      const labels = [];
      const env = makeEnv({ OPENROUTER_API_KEY: 'openrouter-test-key' });

      await assert.rejects(
        withFetchMock(async () => {
          requests += 1;
          return new Response(testCase.body, { status: testCase.status });
        }, () => callLlm(MESSAGES, 80, env, {
          jsonMode: true,
          budget: { consume(label) { labels.push(label); } },
        })),
        new RegExp(`OpenRouter ${testCase.status}`),
      );

      assert.equal(requests, 1);
      assert.equal(labels.length, 2);
      assert.match(labels[0], /^workers-ai:/);
      assert.equal(labels[1], `openrouter:${OPENROUTER_CHAT_MODEL}`);
    }
  });

  it('fails clearly when no external fallback key is configured', async () => {
    await assert.rejects(
      callLlm(MESSAGES, 80, makeEnv()),
      /API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY/,
    );
  });

  it('sanitizes generic API upstream errors', async () => {
    const secret = 'api-super-secret-value';
    const env = makeEnv({ API_KEY: secret });
    const upstream = `bad credential ${secret} ${'x'.repeat(400)}`;

    await assert.rejects(
      withFetchMock(
        async () => new Response(upstream, { status: 401 }),
        () => callLlm(MESSAGES, 80, env),
      ),
      error => {
        assert.match(error.message, /^API 401:/);
        assert.doesNotMatch(error.message, new RegExp(secret));
        assert.ok(error.message.length <= 170);
        return true;
      },
    );
  });

  it('sanitizes and truncates OpenRouter upstream errors', async () => {
    const secret = 'openrouter-super-secret-value';
    const env = makeEnv({ OPENROUTER_API_KEY: secret });
    const upstream = `bad credential ${secret} ${'x'.repeat(400)}`;

    await assert.rejects(
      withFetchMock(
        async () => new Response(upstream, { status: 401 }),
        () => callLlm(MESSAGES, 80, env),
      ),
      error => {
        assert.match(error.message, /^OpenRouter 401:/);
        assert.doesNotMatch(error.message, new RegExp(secret));
        assert.ok(error.message.length <= 170);
        return true;
      },
    );
  });
});
