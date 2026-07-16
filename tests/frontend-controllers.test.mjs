import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function loadController(file, exportName, extras = {}) {
  const source = fs.readFileSync(path.join(here, '..', 'frontend', file), 'utf8');
  const context = {
    URL,
    Request,
    FormData,
    encodeURIComponent,
    setTimeout,
    clearTimeout,
    ...extras,
  };
  context.globalThis = context;
  context.window = context;
  vm.runInNewContext(source, context, { filename: file });
  return context[exportName];
}

test('Evidence Map controller owns state and strips request-only API metadata', async () => {
  const feature = loadController('evidence-map.js', 'GeoScoreEvidenceMap');
  let auditData = { audit_id: 'audit_1', domain: 'example.com' };
  let capturedRequest = null;
  let renderCount = 0;
  const config = {
    runId: 1,
    apiKey: 'sk-one-use-secret',
    apiBaseUrl: 'https://api.example.com/v1',
    apiModel: 'model-a',
  };
  const controller = feature.create({
    apiBase: 'https://geo-api.example.com',
    fetchJson: async request => {
      capturedRequest = request;
      return {
        data: {
          status: 'complete',
          api_key: 'must-not-render',
          answer: { model: 'must-not-render', text: 'bounded result' },
        },
      };
    },
    auxiliaryError: error => ({ code: 'FAILED', message: String(error) }),
    uiText: key => key,
    overwriteCustomApiConfig: value => {
      if (!value) return;
      value.apiKey = '';
      value.apiBaseUrl = '';
      value.apiModel = '';
      value.runId = null;
    },
    getAuditId: () => 'audit_1',
    getAuditData: () => auditData,
    setAuditData: value => { auditData = value; },
    rerender: () => { renderCount += 1; },
  });

  const completed = await controller.run({ auditId: 'audit_1', customApiConfig: config });

  assert.equal(completed, true);
  assert.equal(capturedRequest.headers.get('X-API-Key'), 'sk-one-use-secret');
  assert.equal(config.apiKey, '');
  assert.equal(config.apiBaseUrl, '');
  assert.equal(config.apiModel, '');
  assert.equal(controller.getState().snapshot.answer.text, 'bounded result');
  assert.equal(controller.getState().snapshot.answer.model, undefined);
  assert.equal(controller.getState().snapshot.api_key, undefined);
  assert.equal(auditData.evidence_map.answer.model, undefined);
  assert.equal(renderCount, 2);
});

test('Evidence Map controller reset prevents state leaking into the next audit', () => {
  const feature = loadController('evidence-map.js', 'GeoScoreEvidenceMap');
  const controller = feature.create({
    apiBase: 'https://geo-api.example.com',
    fetchJson: async () => ({ data: null }),
    getAuditId: () => 'audit_1',
  });

  controller.hydrate({ status: 'complete', target: { appearances: 2 } });
  assert.equal(controller.getState().snapshot.target.appearances, 2);
  controller.reset();
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getState())), {
    snapshot: null,
    busy: false,
    error: null,
  });
});

test('monitoring controller clears BYOK input before the request and never stores it', async () => {
  class FakeFormData {
    constructor(form) { this.form = form; }
    get(name) { return this.form.values?.[name] ?? ''; }
    getAll(name) { return this.form.values?.[name] ?? []; }
  }

  const feature = loadController('monitoring.js', 'GeoScoreMonitoring');
  let auditData = { audit_id: 'audit_1', domain: 'example.com' };
  let resolveRun;
  let byokHeaders = null;
  const calls = [];
  const controller = feature.create({
    apiBase: 'https://geo-api.example.com',
    fetchJson: async (url, options = {}) => {
      calls.push(String(url));
      if (String(url).endsWith('/api/monitor-projects')) {
        return {
          project: { id: 'monitor_1', root_domain: 'example.com', queries: [] },
          management_token: 'gmt-management-token',
          token_shown_once: true,
        };
      }
      if (String(url).endsWith('/byok-runs')) {
        byokHeaders = options.headers;
        await new Promise(resolve => { resolveRun = resolve; });
        return { ok: true };
      }
      if (String(url).endsWith('/runs')) {
        return { runs: [{ id: 'run_1', status: 'complete', factual_score: 78 }] };
      }
      throw new Error(`Unexpected URL ${url}`);
    },
    auxiliaryError: (error, secret = '') => ({ message: String(error?.message || error).replaceAll(secret, '[redacted]') }),
    getReportLanguage: () => 'en',
    getAuditId: () => 'audit_1',
    getAuditData: () => auditData,
    setAuditData: value => { auditData = value; },
    FormData: FakeFormData,
  });

  await controller.createProject({ values: { email: '' } });
  const input = { value: 'sk-one-use-byok' };
  const form = {
    dataset: { monitorForm: 'byok' },
    querySelector: () => input,
  };
  const event = {
    target: { closest: () => form },
    preventDefault() {},
  };

  assert.equal(controller.handleSubmit(event), true);
  assert.equal(input.value, '');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(byokHeaders['X-API-Key'], 'sk-one-use-byok');
  assert.doesNotMatch(JSON.stringify(controller.getState()), /sk-one-use-byok/);
  assert.doesNotMatch(JSON.stringify(auditData), /sk-one-use-byok/);
  resolveRun();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(calls.some(url => url.endsWith('/byok-runs')));
  assert.ok(calls.some(url => url.endsWith('/runs')));
});
