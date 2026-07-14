import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-fix-pack-'));
fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"type":"commonjs"}\n');
fs.symlinkSync(path.resolve('node_modules'), path.join(tmpDir, 'node_modules'), 'junction');
execFileSync(process.execPath, [
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
  'src/routes/fix.ts',
  'src/lib/fix-pack.ts',
  'src/lib/llm.ts',
  'src/lib/ai-models.ts',
  'src/lib/audit-core.ts',
  'src/lib/audit-pages.ts',
  'src/lib/subrequest-budget.ts',
  'src/lib/types.ts',
], { stdio: 'inherit' });

const require = createRequire(import.meta.url);
const { handleFix } = require(path.join(tmpDir, 'routes', 'fix.js'));

const AUDIT_ID = '01J6M4W5Y7J7E9H3Q7K3T0P1AB';

function makeAudit({ status = 'fail', predicted = false } = {}) {
  return {
    audit_id: AUDIT_ID,
    domain: 'blog.example.test',
    audit_context: { locale: 'zh-CN' },
    checks: [{
      id: 'seo.title',
      category: 'seo',
      title: 'Unique title',
      status,
      weight: 5,
      confidence: 0.96,
      source: 'html:title',
      page_url: 'https://blog.example.test/post/1',
      evidence: ['title element was not found'],
      ...(predicted ? { predicted: true } : {}),
    }],
    recommendations_v2: [{
      id: 'seo.title',
      template_id: 'seo.title',
      category: 'seo',
      priority: 90,
      title: 'Add a unique page title',
      page_url: 'https://blog.example.test/post/1',
      evidence: 'title element was not found',
      why: 'Search systems need a stable page name.',
      fix: 'Add a concise title aligned with visible content.',
      verify: 'Inspect the title and re-run the audit.',
      what_to_do: 'Add a concise title aligned with visible content.',
      validation: 'Inspect the title and re-run the audit.',
      impact: 'high',
      effort: 'low',
      localized: {
        en: {
          title: 'Add a unique page title',
          why: 'Search systems need a stable page name.',
          fix: 'Add a concise title aligned with visible content.',
          verify: 'Inspect the title and re-run the audit.',
        },
        zh: {
          title: '为页面添加唯一标题',
          why: '搜索系统需要稳定的页面名称。',
          fix: '添加与可见内容一致的简洁标题。',
          verify: '检查页面标题并重新运行审计。',
        },
      },
    }],
  };
}

function makeEnv(audit = makeAudit(), { aiRun, dbError = false } = {}) {
  const kv = new Map();
  let aiCalls = 0;
  const env = {
    DB: {
      prepare(sql) {
        assert.match(sql, /SELECT full_json FROM audits/);
        return {
          bind(id) {
            assert.equal(id, AUDIT_ID);
            return {
              async first() {
                if (dbError) throw new Error('d1 unavailable');
                return { full_json: JSON.stringify(audit) };
              },
            };
          },
        };
      },
    },
    AUDIT_KV: {
      async get(key) { return kv.get(key) ?? null; },
      async put(key, value) { kv.set(key, value); },
      async delete(key) { kv.delete(key); },
    },
    AI: {
      async run(_model, payload) {
        aiCalls += 1;
        if (aiRun) return aiRun(payload);
        throw new Error('AI unavailable');
      },
    },
    PUBLIC_APP_URL: 'https://geo.sayori.org',
  };
  return { env, getAiCalls: () => aiCalls };
}

async function request(body) {
  return handleFix(
    new Request('https://geo-api.sayori.org/api/fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    body.__env,
  );
}

async function call(body, env) {
  const payload = { ...body };
  const response = await handleFix(
    new Request('https://geo-api.sayori.org/api/fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    env,
  );
  const json = await response.json();
  return { response, json };
}

describe('evidence-bound FixPack route', () => {
  it('rejects legacy client-supplied issue text before reading the DB', async () => {
    const { env } = makeEnv();
    const { response, json } = await call({ domain: 'evil.test', title: 'invented issue' }, env);
    assert.equal(response.status, 400);
    assert.equal(json.error.code, 'INVALID_REQUEST');
  });

  it('returns a deterministic evidence pack and neutral handoff prompt', async () => {
    const { env, getAiCalls } = makeEnv();
    const { response, json } = await call({
      audit_id: AUDIT_ID,
      recommendation_id: 'seo.title',
      language: 'zh-CN',
      output: 'handoff_prompt',
    }, env);

    assert.equal(response.status, 200);
    assert.equal(json.version, '1');
    assert.equal(json.language, 'zh');
    assert.equal(json.evidence.status, 'fail');
    assert.deepEqual(json.evidence.observed, ['title element was not found']);
    assert.equal(json.evidence.why, '搜索系统需要稳定的页面名称。');
    assert.deepEqual(json.fix_steps, ['添加与可见内容一致的简洁标题。']);
    assert.deepEqual(json.verify, ['检查页面标题并重新运行审计。']);
    assert.match(json.handoff_prompt, /title element was not found/);
    assert.match(json.handoff_prompt, /为页面添加唯一标题/);
    assert.match(json.handoff_prompt, /必需修改: 添加与可见内容一致的简洁标题/);
    assert.doesNotMatch(json.handoff_prompt, /Required change|Search systems need/);
    assert.match(json.handoff_prompt, /不得虚构/);
    assert.doesNotMatch(json.handoff_prompt, /Groq|OpenRouter/i);
    assert.equal(json.expansion.status, 'deterministic');
    assert.equal(getAiCalls(), 0);
    assert.equal(json.code_snippets[0].language, 'html');
  });

  it('uses the requested report language for the AI expansion input', async () => {
    let aiPayload;
    const { env } = makeEnv(makeAudit(), {
      aiRun(payload) {
        aiPayload = payload;
        return { response: '{}' };
      },
    });
    const { response } = await call({
      audit_id: AUDIT_ID,
      recommendation_id: 'seo.title',
      language: 'zh',
      output: 'full',
    }, env);

    assert.equal(response.status, 200);
    assert.match(aiPayload.messages[1].content, /为页面添加唯一标题/);
    assert.match(aiPayload.messages[1].content, /只能使用 verified_input/);
    assert.doesNotMatch(aiPayload.messages[1].content, /Search systems need a stable page name/);
  });

  it('calls AI only with stored evidence and merges bounded structured output', async () => {
    let aiPayload;
    const { env, getAiCalls } = makeEnv(makeAudit(), {
      aiRun(payload) {
        aiPayload = payload;
        return {
          response: JSON.stringify({
            drafts: {
              title: 'A factual title placeholder',
              meta_description: null,
              body_outline: ['Explain the page topic'],
            },
            code_snippets: [{ label: 'title', language: 'html', code: '<title>Placeholder</title>' }],
            fix_steps: ['Update the server-rendered head.'],
            verify: ['Fetch source HTML and confirm one title.'],
          }),
        };
      },
    });
    const { response, json } = await call({
      audit_id: AUDIT_ID,
      recommendation_id: 'seo.title',
      language: 'en',
      output: 'full',
    }, env);

    assert.equal(response.status, 200);
    assert.equal(getAiCalls(), 1);
    assert.equal(json.expansion.status, 'ai');
    assert.equal(json.drafts.title, 'A factual title placeholder');
    assert.ok(json.fix_steps.some(item => /server-rendered/.test(item)));
    assert.match(aiPayload.messages[1].content, /title element was not found/);
    assert.match(aiPayload.messages[1].content, /Do not invent/);
    assert.doesNotMatch(aiPayload.messages[1].content, /invented issue/);
  });

  it('returns safe deterministic output when AI is unavailable', async () => {
    const { env } = makeEnv();
    const { response, json } = await call({
      audit_id: AUDIT_ID,
      recommendation_id: 'seo.title',
      language: 'en-US',
      output: 'code',
    }, env);
    assert.equal(response.status, 200);
    assert.equal(json.expansion.status, 'unavailable');
    assert.equal(json.expansion.error_code, 'AI_UNAVAILABLE');
    assert.equal(json.code_snippets.length, 1);
  });

  it('uses at most one external endpoint for one AI expansion', async () => {
    const { env } = makeEnv();
    Object.assign(env, {
      API_KEY: 'generic-key',
      API_BASE_URL: 'https://primary.example.test/v1',
      API_MODEL: 'primary-model',
      GROQ_API_KEY: 'secondary-key',
      OPENROUTER_API_KEY: 'reserve-key',
    });
    const originalFetch = globalThis.fetch;
    const urls = [];
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ fix_steps: ['Use the observed evidence.'] }) } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
      const { response, json } = await call({
        audit_id: AUDIT_ID,
        recommendation_id: 'seo.title',
        language: 'en',
        output: 'full',
      }, env);
      assert.equal(response.status, 200);
      assert.equal(json.expansion.status, 'ai');
      assert.equal(new Set(urls).size, 1);
      assert.ok(urls.length <= 2); // JSON compatibility may retry the same endpoint only.
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('blocks pass, unknown, and predicted recommendations', async () => {
    for (const audit of [
      makeAudit({ status: 'pass' }),
      makeAudit({ status: 'unknown' }),
      makeAudit({ status: 'fail', predicted: true }),
    ]) {
      const { env } = makeEnv(audit);
      const { response, json } = await call({
        audit_id: AUDIT_ID,
        recommendation_id: 'seo.title',
        output: 'handoff_prompt',
      }, env);
      assert.equal(response.status, 422);
      assert.equal(json.error.code, 'RECOMMENDATION_NOT_FIXABLE');
    }
  });

  it('rejects malformed stored failures instead of throwing while building a pack', async () => {
    const audit = makeAudit();
    delete audit.checks[0].evidence;
    const { env } = makeEnv(audit);
    const { response, json } = await call({
      audit_id: AUDIT_ID,
      recommendation_id: 'seo.title',
      output: 'handoff_prompt',
    }, env);
    assert.equal(response.status, 422);
    assert.equal(json.error.code, 'RECOMMENDATION_NOT_FIXABLE');
  });

  it('returns stable not-found and storage errors without upstream detail', async () => {
    const { env } = makeEnv();
    const missing = await call({
      audit_id: AUDIT_ID,
      recommendation_id: 'seo.missing',
    }, env);
    assert.equal(missing.response.status, 404);
    assert.equal(missing.json.error.code, 'RECOMMENDATION_NOT_FOUND');

    const broken = await call({
      audit_id: AUDIT_ID,
      recommendation_id: 'seo.title',
    }, makeEnv(makeAudit(), { dbError: true }).env);
    assert.equal(broken.response.status, 503);
    assert.equal(broken.json.error.code, 'AUDIT_STORE_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(broken.json), /d1 unavailable/i);
  });

  it('validates language and output enums', async () => {
    const { env } = makeEnv();
    const language = await call({
      audit_id: AUDIT_ID,
      recommendation_id: 'seo.title',
      language: 'fr',
    }, env);
    assert.equal(language.response.status, 400);
    assert.equal(language.json.error.code, 'INVALID_LANGUAGE');

    const output = await call({
      audit_id: AUDIT_ID,
      recommendation_id: 'seo.title',
      output: 'publish',
    }, env);
    assert.equal(output.response.status, 400);
    assert.equal(output.json.error.code, 'INVALID_OUTPUT');
  });
});
