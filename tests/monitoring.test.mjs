import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, it } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-monitoring-'));
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
    'src/routes/monitoring.ts',
  ],
  { stdio: 'inherit' },
);

const require = createRequire(import.meta.url);
const monitoring = require(path.join(tmpDir, 'routes', 'monitoring.js'));

const AUDIT_ID = 'audit_monitoring_001';
const PROJECT_ID = 'mon_01JZZZZZZZZZZZZZZZZZZZZZZZ';
const PEPPER = 'monitoring-test-pepper-with-enough-entropy';

function auditContext() {
  return {
    site_archetype: 'personal_blog',
    industry_vertical: 'technology',
    business_model: 'publisher',
    entity: { name: 'Ada Notes', type: 'Person', source: 'schema', confidence: 0.95 },
    locality: null,
    locale: 'en-US',
    root_domain: 'example.com',
    page_types: ['home', 'article'],
    confidence: 0.9,
    evidence: ['Blog and Person schema on homepage'],
  };
}

function scoreSummary(score = 78, coverage = 0.8, confidence = 0.85, version = '2.2.0') {
  const category = {
    score,
    raw_score: score,
    coverage,
    confidence,
    cap: 100,
    cap_reasons: [],
    passed_weight: 8,
    failed_weight: 2,
    applicable_weight: 10,
    known_weight: 10,
  };
  return {
    score_version: version,
    status: score === null ? 'insufficient_evidence' : 'complete',
    overall: { ...category, score },
    seo: { ...category, score },
    geo: { ...category, score },
  };
}

function storedAudit(summary = scoreSummary()) {
  return {
    audit_id: AUDIT_ID,
    domain: 'example.com',
    score_version: summary.score_version,
    audit_context: auditContext(),
    score_summary: summary,
  };
}

class Statement {
  constructor(db, sql, values = []) {
    this.db = db;
    this.sql = sql.replace(/\s+/g, ' ').trim();
    this.values = values;
  }

  bind(...values) {
    return new Statement(this.db, this.sql, values);
  }

  first() {
    return this.db.first(this);
  }

  all() {
    return this.db.all(this);
  }

  run() {
    return this.db.run(this);
  }
}

class RunDatabase {
  constructor(project, audit, queries) {
    this.project = project;
    this.audit = audit;
    this.queries = queries;
    this.writes = [];
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  async batch(statements) {
    for (const statement of statements) await statement.run();
    return statements.map(() => ({ success: true }));
  }

  async first(statement) {
    if (statement.sql.includes('FROM monitor_projects WHERE id = ?')) return this.project;
    if (statement.sql.includes('JOIN audits candidate')) {
      return { id: this.audit.audit_id, full_json: JSON.stringify(this.audit) };
    }
    if (statement.sql.includes('FROM audits WHERE id = ?')) {
      return { id: this.audit.audit_id, full_json: JSON.stringify(this.audit) };
    }
    return null;
  }

  async all(statement) {
    if (statement.sql.includes("FROM monitor_projects WHERE schedule = 'weekly'")) {
      return { results: this.project ? [this.project] : [] };
    }
    if (statement.sql.includes('FROM monitor_queries')) return { results: this.queries };
    return { results: [] };
  }

  async run(statement) {
    this.writes.push({ sql: statement.sql, values: statement.values });
    return { success: true };
  }
}

class CreateDatabase extends RunDatabase {
  constructor(audit) {
    super(null, audit, []);
  }

  async first(statement) {
    if (statement.sql.startsWith('SELECT full_json FROM audits')) {
      return { full_json: JSON.stringify(this.audit) };
    }
    if (statement.sql.includes('FROM monitor_projects WHERE id = ?')) return null;
    return null;
  }
}

class ProjectDatabase extends RunDatabase {
  async run(statement) {
    this.writes.push({ sql: statement.sql, values: statement.values });
    if (statement.sql.startsWith('UPDATE monitor_projects SET token_version')) {
      const [tokenVersion, tokenHash, tokenHint] = statement.values;
      Object.assign(this.project, {
        token_version: tokenVersion,
        token_hash: tokenHash,
        token_hint: tokenHint,
      });
    } else if (statement.sql.startsWith('DELETE FROM monitor_queries')) {
      this.queries = [];
    } else if (statement.sql.startsWith('INSERT INTO monitor_queries')) {
      const [, position, query, intent] = statement.values;
      this.queries.push({ position, query, intent });
      this.queries.sort((left, right) => left.position - right.position);
    } else if (statement.sql.startsWith('UPDATE monitor_projects SET baseline_json = NULL')) {
      this.project.baseline_json = null;
    } else if (statement.sql.startsWith('DELETE FROM monitor_projects')) {
      this.project = null;
    }
    return { success: true };
  }
}

class AlertDatabase extends ProjectDatabase {
  constructor(project, audit, queries, alertRun) {
    super(project, audit, queries);
    this.alertRun = alertRun;
  }

  async first(statement) {
    if (statement.sql.includes('FROM monitor_runs WHERE id = ? AND project_id = ?')) return this.alertRun;
    return super.first(statement);
  }
}

function evidenceResponse(query) {
  return {
    evidence_version: 'evidence-v1',
    request_id: 'evs_test',
    query_plan: { queries: [query], locale: 'en-US' },
    results: [],
    provider_runs: [],
    usage: { provider_calls: 1, extract_pages: 0, cache_hits: 0, estimated_credits: 0, elapsed_ms: 12 },
    partial: false,
    degraded: false,
    errors: [],
  };
}

function answerResponseWithEcho(query, secret, apiBaseUrl, apiModel) {
  const echo = `${secret} ${apiBaseUrl}`;
  return {
    snapshot_version: '1.0.0',
    request_id: `answer-${echo}`,
    observations: [{
      query: `${query} ${echo}`,
      status: 'complete',
      provider: `provider-${echo}`,
      model: apiModel,
      answer: `answer ${echo}`,
      citations: [{
        url: `https://example.net/source?credential=${encodeURIComponent(echo)}`,
        title: `title ${echo}`,
        source_id: `source-${echo}`,
      }],
      observed_at: '2026-07-15T00:00:00Z',
      latency_ms: 20,
      error: { code: 'ANSWER_ECHO', scope: 'answer_snapshot', retryable: false, message: echo },
    }],
    usage: { requests: 1, input_tokens: 10, output_tokens: 20, elapsed_ms: 20 },
    partial: false,
    degraded: false,
    limitations: [`limitation ${echo}`],
    errors: [{ code: 'ROOT_ECHO', scope: 'request', retryable: false, message: echo }],
  };
}

function cleanAnswerResponse(query) {
  return {
    snapshot_version: '1.0.0',
    request_id: 'answer_test',
    observations: [{
      query,
      status: 'complete',
      provider: 'api',
      model: 'configured-default',
      answer: 'A dated API answer observation.',
      citations: [{ url: 'https://example.net/source', title: 'Source' }],
      observed_at: '2026-07-15T00:00:00Z',
      latency_ms: 20,
      error: null,
    }],
    usage: { requests: 1, input_tokens: 10, output_tokens: 20, elapsed_ms: 20 },
    partial: false,
    degraded: false,
    limitations: ['API-only snapshot; not a consumer interface observation.'],
    errors: [],
  };
}

async function monitoringProject(token, baseline) {
  return {
    id: PROJECT_ID,
    root_domain: 'example.com',
    audit_id: AUDIT_ID,
    context_json: JSON.stringify(auditContext()),
    token_version: 1,
    token_hash: await monitoring.hashManagementToken(token, PEPPER),
    token_hint: token.slice(-6),
    baseline_json: baseline ? JSON.stringify(baseline) : null,
    email: 'owner@example.com',
    email_verified: 1,
    email_verify_hash: null,
    email_verify_expires_at: null,
    schedule: 'weekly',
    last_run_at: null,
    created_at: 1,
    updated_at: 1,
  };
}

describe('accountless monitoring privacy', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('rejects missing or short token peppers before storing a monitoring project', async () => {
    for (const pepper of [undefined, 'too-short-monitor-pepper']) {
      const db = new CreateDatabase(storedAudit());
      const response = await monitoring.handleMonitorProjects(new Request(
        'https://geo-api.example/api/monitor-projects',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audit_id: AUDIT_ID }),
        },
      ), { DB: db, MONITOR_TOKEN_PEPPER: pepper });
      const body = await response.json();

      assert.equal(response.status, 503);
      assert.equal(body.error.code, 'MONITOR_CONFIG_MISSING');
      assert.equal(db.writes.length, 0);
    }
  });

  it('returns a management token once while storing only its versioned peppered hash', async () => {
    const db = new CreateDatabase(storedAudit());
    const response = await monitoring.handleMonitorProjects(new Request(
      'https://geo-api.example/api/monitor-projects',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audit_id: AUDIT_ID }),
      },
    ), { DB: db, MONITOR_TOKEN_PEPPER: PEPPER });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.token_shown_once, true);
    assert.match(body.management_token, /^gmt_[A-Za-z0-9_-]{40,}$/);
    const projectInsert = db.writes.find(write => write.sql.startsWith('INSERT INTO monitor_projects'));
    assert.ok(projectInsert);
    assert.match(projectInsert.values[5], /^v1:[a-f0-9]{64}$/);
    assert.equal(projectInsert.values[6], body.management_token.slice(-6));
    assert.equal(await monitoring.verifyManagementToken(body.management_token, projectInsert.values[5], PEPPER), true);
    assert.doesNotMatch(JSON.stringify(db.writes), new RegExp(body.management_token));
  });

  it('verifies an email token without requiring the separate project management token', async () => {
    const verificationToken = 'gmv_email-verification-token-with-entropy';
    const project = await monitoringProject('gmt_email-management-token-with-entropy', null);
    project.email_verified = 0;
    project.email_verify_hash = await monitoring.hashEmailVerificationToken(verificationToken, PEPPER);
    project.email_verify_expires_at = Math.floor(Date.now() / 1000) + 3600;
    const db = new ProjectDatabase(project, storedAudit(), []);

    const response = await monitoring.handleMonitorProjects(new Request(
      `https://geo-api.example/api/monitor-projects/${PROJECT_ID}/email/verify`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: verificationToken }),
      },
    ), { DB: db, MONITOR_TOKEN_PEPPER: PEPPER });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.email_verified, true);
    assert.equal(
      db.writes.some(write => write.sql.startsWith('UPDATE monitor_projects SET email_verified = 1')),
      true,
    );
    assert.doesNotMatch(JSON.stringify(db.writes), new RegExp(verificationToken));
  });

  it('rotates tokens immediately, edits bounded queries, and deletes all project-owned rows', async () => {
    const oldToken = 'gmt_old-management-token-with-enough-entropy';
    const project = {
      id: PROJECT_ID,
      root_domain: 'example.com',
      audit_id: AUDIT_ID,
      context_json: JSON.stringify(auditContext()),
      token_version: 1,
      token_hash: await monitoring.hashManagementToken(oldToken, PEPPER),
      token_hint: oldToken.slice(-6),
      baseline_json: JSON.stringify({ score_version: '2.2.0', score: 70, coverage: 0.8, confidence: 0.8 }),
      email: null,
      email_verified: 0,
      email_verify_hash: null,
      email_verify_expires_at: null,
      schedule: 'weekly',
      last_run_at: null,
      created_at: 1,
      updated_at: 1,
    };
    const db = new ProjectDatabase(project, storedAudit(), [
      { position: 0, query: 'old query', intent: 'informational' },
    ]);
    const env = { DB: db, MONITOR_TOKEN_PEPPER: PEPPER };

    const rotateResponse = await monitoring.handleMonitorProjects(new Request(
      `https://geo-api.example/api/monitor-projects/${PROJECT_ID}/token/rotate`,
      { method: 'POST', headers: { 'X-Project-Token': oldToken } },
    ), env);
    const rotated = await rotateResponse.json();
    assert.equal(rotateResponse.status, 200);
    assert.equal(rotated.token_shown_once, true);
    assert.notEqual(rotated.management_token, oldToken);

    const oldTokenResponse = await monitoring.handleMonitorProjects(new Request(
      `https://geo-api.example/api/monitor-projects/${PROJECT_ID}`,
      { headers: { 'X-Project-Token': oldToken } },
    ), env);
    assert.equal(oldTokenResponse.status, 401);

    const replacementQueries = [
      { query: 'Ada Notes articles', intent: 'branded' },
      { query: 'Ada Notes evidence guides', intent: 'informational' },
      { query: 'Ada Notes author', intent: 'navigational' },
    ];
    const queryResponse = await monitoring.handleMonitorProjects(new Request(
      `https://geo-api.example/api/monitor-projects/${PROJECT_ID}/queries`,
      {
        method: 'PATCH',
        headers: { 'X-Project-Token': rotated.management_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: replacementQueries }),
      },
    ), env);
    const queryBody = await queryResponse.json();
    assert.equal(queryResponse.status, 200);
    assert.equal(queryBody.baseline_reset, true);
    assert.deepEqual(db.queries.map(item => item.query), replacementQueries.map(item => item.query));
    assert.equal(db.project.baseline_json, null);

    const tooManyQueries = await monitoring.handleMonitorProjects(new Request(
      `https://geo-api.example/api/monitor-projects/${PROJECT_ID}/queries`,
      {
        method: 'PATCH',
        headers: { 'X-Project-Token': rotated.management_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: ['one', 'two', 'three', 'four'] }),
      },
    ), env);
    assert.equal(tooManyQueries.status, 400);

    const deleteResponse = await monitoring.handleMonitorProjects(new Request(
      `https://geo-api.example/api/monitor-projects/${PROJECT_ID}`,
      { method: 'DELETE', headers: { 'X-Project-Token': rotated.management_token } },
    ), env);
    assert.equal(deleteResponse.status, 200);
    assert.deepEqual(
      db.writes.filter(write => write.sql.startsWith('DELETE FROM monitor_')).slice(-4).map(write => write.sql.split(' ')[2]),
      ['monitor_snapshots', 'monitor_runs', 'monitor_queries', 'monitor_projects'],
    );
    assert.equal(db.project, null);
  });

  it('uses a BYOK secret for one answer request without persisting or returning it', async () => {
    const managementToken = 'gmt_management-token-value-with-enough-entropy';
    const tokenHash = await monitoring.hashManagementToken(managementToken, PEPPER);
    const project = {
      id: PROJECT_ID,
      root_domain: 'example.com',
      audit_id: AUDIT_ID,
      context_json: JSON.stringify(auditContext()),
      token_version: 1,
      token_hash: tokenHash,
      token_hint: managementToken.slice(-6),
      baseline_json: null,
      email: null,
      email_verified: 0,
      email_verify_hash: null,
      email_verify_expires_at: null,
      schedule: 'weekly',
      last_run_at: null,
      created_at: 1,
      updated_at: 1,
    };
    const query = 'Ada Notes articles';
    const db = new RunDatabase(project, storedAudit(), [{ position: 0, query, intent: 'branded' }]);
    const byokSecret = 'byok-secret-value-1234567890';
    const apiBaseUrl = 'https://api.example.com/v1';
    const apiModel = 'org/custom-model';
    const outboundAnswerSecrets = [];
    const outboundAnswerBodies = [];
    const kvWrites = [];

    globalThis.fetch = async (url, init = {}) => {
      if (String(url).endsWith('/v1/evidence-search')) {
        return Response.json(evidenceResponse(query));
      }
      if (String(url).endsWith('/v1/answer-snapshots')) {
        outboundAnswerSecrets.push(new Headers(init.headers).get('X-Answer-API-Key'));
        outboundAnswerBodies.push(JSON.parse(init.body));
        return Response.json(answerResponseWithEcho(query, byokSecret, apiBaseUrl, apiModel));
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const env = {
      DB: db,
      MONITOR_TOKEN_PEPPER: PEPPER,
      SEARCH_GATEWAY_URL: 'https://search.example.test',
      SEARCH_GATEWAY_API_KEY: 'gateway-server-credential',
      AUDIT_KV: { async put(...args) { kvWrites.push(args); } },
      BUDGET_KV: { async put(...args) { kvWrites.push(args); } },
    };
    const response = await monitoring.handleMonitorProjects(new Request(
      `https://geo-api.example/api/monitor-projects/${PROJECT_ID}/byok-runs`,
      {
        method: 'POST',
        headers: {
          'X-Project-Token': managementToken,
          'X-API-Key': byokSecret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ api_base_url: apiBaseUrl, api_model: apiModel }),
      },
    ), env);
    const responseText = await response.text();

    assert.equal(response.status, 200);
    assert.deepEqual(outboundAnswerSecrets, [byokSecret]);
    assert.equal(outboundAnswerBodies[0].api_base_url, apiBaseUrl);
    assert.equal(outboundAnswerBodies[0].api_model, apiModel);
    assert.equal(kvWrites.length, 0);
    assert.doesNotMatch(responseText, new RegExp(byokSecret));
    assert.doesNotMatch(responseText, /api\.example\.com/);
    assert.match(responseText, /org\/custom-model/);
    assert.doesNotMatch(JSON.stringify(db.writes), new RegExp(byokSecret));
    assert.doesNotMatch(JSON.stringify(db.writes), /api\.example\.com/);
    const retentionWrite = db.writes.find(write => write.sql.startsWith('DELETE FROM monitor_snapshots'));
    assert.equal(retentionWrite?.values.at(-1), 12);
  });

  it('rejects missing or partial BYOK endpoint configuration before starting a run', async () => {
    const managementToken = 'gmt_partial-byok-management-token-with-entropy';
    const project = await monitoringProject(managementToken, null);
    const db = new RunDatabase(project, storedAudit(), [
      { position: 0, query: 'Ada Notes articles', intent: 'branded' },
    ]);
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return Response.json({}); };
    try {
      const cases = [
        { key: '', body: {} },
        { key: 'request-scoped-key-value', body: {} },
        { key: '', body: { api_base_url: 'https://api.example.com/v1', api_model: 'model-a' } },
        { key: 'request-scoped-key-value', body: { api_base_url: 'https://api.example.com/v1' } },
        { key: 'request-scoped-key-value', body: { api_model: 'model-a' } },
      ];
      for (const item of cases) {
        const response = await monitoring.handleMonitorProjects(new Request(
          `https://geo-api.example/api/monitor-projects/${PROJECT_ID}/byok-runs`,
          {
            method: 'POST',
            headers: {
              'X-Project-Token': managementToken,
              ...(item.key ? { 'X-API-Key': item.key } : {}),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(item.body),
          },
        ), { DB: db, MONITOR_TOKEN_PEPPER: PEPPER });
        const body = await response.json();
        assert.equal(response.status, 400);
        assert.equal(body.error.code, 'CUSTOM_API_CONFIG_INCOMPLETE');
      }
      assert.equal(calls, 0);
      assert.equal(db.writes.some(write => write.sql.startsWith('INSERT INTO monitor_runs')), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('records an unavailable run without manufacturing an empty completed snapshot', async () => {
    const managementToken = 'gmt_management-token-for-unavailable-run';
    const project = {
      id: PROJECT_ID,
      root_domain: 'example.com',
      audit_id: AUDIT_ID,
      context_json: JSON.stringify(auditContext()),
      token_version: 1,
      token_hash: await monitoring.hashManagementToken(managementToken, PEPPER),
      token_hint: managementToken.slice(-6),
      baseline_json: null,
      email: null,
      email_verified: 0,
      email_verify_hash: null,
      email_verify_expires_at: null,
      schedule: 'weekly',
      last_run_at: null,
      created_at: 1,
      updated_at: 1,
    };
    const db = new RunDatabase(project, storedAudit(), [
      { position: 0, query: 'Ada Notes articles', intent: 'branded' },
    ]);
    const response = await monitoring.handleMonitorProjects(new Request(
      `https://geo-api.example/api/monitor-projects/${PROJECT_ID}/runs`,
      {
        method: 'POST',
        headers: { 'X-Project-Token': managementToken, 'Content-Type': 'application/json' },
        body: '{}',
      },
    ), { DB: db, MONITOR_TOKEN_PEPPER: PEPPER });
    const body = await response.json();

    assert.equal(response.status, 207);
    assert.equal(body.run.status, 'error');
    assert.equal(body.run.snapshot_id, null);
    assert.equal(body.run.snapshot_version, null);
    assert.equal(db.writes.some(write => write.sql.startsWith('INSERT INTO monitor_snapshots')), false);
  });
});

describe('monitoring baseline compatibility', () => {
  it('establishes or resets baselines before any score delta can be alerted', () => {
    const current = { score_version: '2.2.0', score: 78, coverage: 0.8, confidence: 0.85 };

    assert.deepEqual(monitoring.evaluateMonitorBaseline(null, current), {
      action: 'established', score_delta: null, comparable: false,
    });
    assert.deepEqual(monitoring.evaluateMonitorBaseline({ ...current, score_version: '2.1.0' }, current), {
      action: 'reset_version', score_delta: null, comparable: false,
    });
    assert.deepEqual(monitoring.evaluateMonitorBaseline({ ...current, coverage: 0.59 }, current), {
      action: 'reset_coverage', score_delta: null, comparable: false,
    });
    assert.deepEqual(monitoring.evaluateMonitorBaseline({ ...current, score: 70 }, current), {
      action: 'compared', score_delta: 8, comparable: true,
    });
  });

  it('suppresses weekly score alerts when no dated evidence snapshot completed', async () => {
    const current = { score_version: '2.2.0', score: 78, coverage: 0.8, confidence: 0.85 };
    const project = await monitoringProject('gmt_weekly-unavailable-token', { ...current, score: 70 });
    const db = new RunDatabase(project, storedAudit(scoreSummary()), [
      { position: 0, query: 'Ada Notes articles', intent: 'branded' },
    ]);
    const resendCalls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      resendCalls.push(String(url));
      return new Response('', { status: 500 });
    };
    try {
      const result = await monitoring.runWeeklyMonitorProjects({
        DB: db,
        MONITOR_TOKEN_PEPPER: PEPPER,
        RESEND_API_KEY: 'resend-server-secret',
      });
      assert.deepEqual(result, { attempted: 1, completed: 1, failed: 0 });
      assert.equal(resendCalls.length, 0);
      const runUpdate = db.writes.find(write => write.sql.startsWith('UPDATE monitor_runs SET status ='));
      assert.equal(runUpdate?.values[5], 'compared');
      assert.equal(runUpdate?.values[9], 'suppressed');
      assert.equal(runUpdate?.values[10], 'MONITOR_SNAPSHOT_UNAVAILABLE');
      const projectUpdate = db.writes.find(write => write.sql.startsWith('UPDATE monitor_projects SET audit_id ='));
      assert.equal(projectUpdate?.values[2], project.baseline_json);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('records email delivery failure without losing a completed weekly run', async () => {
    const current = { score_version: '2.2.0', score: 78, coverage: 0.8, confidence: 0.85 };
    const project = await monitoringProject('gmt_weekly-email-token', { ...current, score: 70 });
    const query = 'Ada Notes articles';
    const db = new RunDatabase(project, storedAudit(scoreSummary()), [
      { position: 0, query, intent: 'branded' },
    ]);
    const calls = [];
    const resendIdempotencyKeys = [];
    let persistedBeforeEmail = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      calls.push(String(url));
      if (String(url).endsWith('/v1/evidence-search')) return Response.json(evidenceResponse(query));
      if (String(url).endsWith('/v1/answer-snapshots')) return Response.json(cleanAnswerResponse(query));
      if (String(url) === 'https://api.resend.com/emails') {
        persistedBeforeEmail = db.writes.some(write => write.sql.startsWith('UPDATE monitor_runs SET status ='));
        resendIdempotencyKeys.push(new Headers(init.headers).get('Idempotency-Key'));
        return new Response('', { status: 503 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    };
    try {
      const result = await monitoring.runWeeklyMonitorProjects({
        DB: db,
        MONITOR_TOKEN_PEPPER: PEPPER,
        SEARCH_GATEWAY_URL: 'https://search.example.test',
        SEARCH_GATEWAY_API_KEY: 'gateway-server-credential',
        RESEND_API_KEY: 'resend-server-secret',
      });
      assert.deepEqual(result, { attempted: 1, completed: 1, failed: 0 });
      assert.equal(calls.filter(url => url === 'https://api.resend.com/emails').length, 1);
      assert.equal(persistedBeforeEmail, true);
      const runUpdate = db.writes.find(write => write.sql.startsWith('UPDATE monitor_runs SET status ='));
      assert.equal(runUpdate?.values[5], 'compared');
      assert.equal(runUpdate?.values[6], 8);
      const alertUpdate = db.writes.find(write => write.sql.startsWith('UPDATE monitor_runs SET alert_status ='));
      assert.equal(alertUpdate?.values[0], 'failed');
      assert.equal(alertUpdate?.values[1], 'EMAIL_PROVIDER_UNAVAILABLE');
      assert.equal(resendIdempotencyKeys.length, 1);
      assert.match(resendIdempotencyKeys[0], /^geoscore-monitor-mrun_[A-Z0-9]{20,40}$/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('retries a failed weekly alert with the same run-scoped idempotency key', async () => {
    const managementToken = 'gmt_retry-alert-management-token-with-entropy';
    const project = await monitoringProject(managementToken, {
      score_version: '2.2.0', score: 70, coverage: 0.8, confidence: 0.85,
    });
    const runId = 'mrun_01JZZZZZZZZZZZZZZZZZZZZZZZ';
    const db = new AlertDatabase(project, storedAudit(scoreSummary()), [], {
      id: runId,
      project_id: PROJECT_ID,
      run_type: 'weekly',
      status: 'complete',
      score_version: '2.2.0',
      factual_score: 78,
      factual_coverage: 0.8,
      factual_confidence: 0.85,
      baseline_action: 'compared',
      score_delta: 8,
      snapshot_id: 'msnap_01JZZZZZZZZZZZZZZZZZZZZZZ',
      error_code: null,
      alert_status: 'failed',
      alert_error_code: 'EMAIL_PROVIDER_UNAVAILABLE',
      created_at: 1,
      completed_at: 2,
    });
    const idempotencyKeys = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      assert.equal(String(url), 'https://api.resend.com/emails');
      idempotencyKeys.push(new Headers(init.headers).get('Idempotency-Key'));
      return Response.json({ id: 'email_test' });
    };
    try {
      const response = await monitoring.handleMonitorProjects(new Request(
        `https://geo-api.example/api/monitor-projects/${PROJECT_ID}/runs/${runId}/alert/retry`,
        { method: 'POST', headers: { 'X-Project-Token': managementToken } },
      ), {
        DB: db,
        MONITOR_TOKEN_PEPPER: PEPPER,
        RESEND_API_KEY: 'resend-server-secret',
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.alert_status, 'sent');
      assert.deepEqual(idempotencyKeys, [`geoscore-monitor-${runId}`]);
      const alertUpdate = db.writes.find(write => write.sql.startsWith('UPDATE monitor_runs SET alert_status ='));
      assert.deepEqual(alertUpdate?.values, ['sent', null, runId]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
