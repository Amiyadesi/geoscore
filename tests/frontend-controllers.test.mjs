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
    setInterval,
    clearInterval,
    AbortController,
    TextDecoder,
    ...extras,
  };
  context.globalThis = context;
  context.window = context;
  vm.runInNewContext(source, context, { filename: file });
  return context[exportName];
}

function fakeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add: (...names) => names.forEach(name => values.add(name)),
    remove: (...names) => names.forEach(name => values.delete(name)),
    replace: (from, to) => { values.delete(from); values.add(to); },
    toggle: (name, force) => {
      const enabled = force === undefined ? !values.has(name) : Boolean(force);
      if (enabled) values.add(name); else values.delete(name);
      return enabled;
    },
    contains: name => values.has(name),
  };
}

test('audit runner owns EventSource retry state and applies fresh only to the first attempt', () => {
  class FakeEventSource {
    static instances = [];
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      this.closed = false;
      FakeEventSource.instances.push(this);
    }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    emit(name, data) { this.listeners.get(name)?.({ data: JSON.stringify(data) }); }
    close() { this.closed = true; }
  }

  const scheduled = [];
  const progress = [];
  const retries = [];
  const completed = [];
  const feature = loadController('audit-runner.js', 'GeoScoreAuditRunner', { EventSource: FakeEventSource });
  const runner = feature.create({
    EventSource: FakeEventSource,
    setTimeout: callback => { scheduled.push(callback); return scheduled.length; },
    clearTimeout() {},
    maxRetries: 1,
    buildEndpoint: (request, options) => `https://api.example/audit/${request.domain}?fresh=${options.fresh ? '1' : '0'}`,
    onProgress: value => progress.push(value),
    onRetry: value => retries.push(value),
    onComplete: value => completed.push(value),
  });

  assert.equal(runner.start({ domain: 'example.com' }, { fresh: true }), true);
  assert.equal(FakeEventSource.instances[0].url, 'https://api.example/audit/example.com?fresh=1');
  FakeEventSource.instances[0].emit('progress', { module: 'schema_audit' });
  assert.equal(progress[0].module, 'schema_audit');

  FakeEventSource.instances[0].emit('error');
  assert.equal(FakeEventSource.instances[0].closed, true);
  assert.equal(retries[0].attempt, 1);
  scheduled.shift()();
  assert.equal(FakeEventSource.instances[1].url, 'https://api.example/audit/example.com?fresh=0');

  FakeEventSource.instances[1].emit('complete', { audit_id: 'audit_1' });
  assert.equal(FakeEventSource.instances[1].closed, true);
  assert.equal(completed[0].audit_id, 'audit_1');
});

test('audit runner cancels an active connection and ignores its stale events', () => {
  class FakeEventSource {
    constructor() { this.listeners = new Map(); this.closed = false; }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    emit(name, data) { this.listeners.get(name)?.({ data: JSON.stringify(data) }); }
    close() { this.closed = true; }
  }
  let completed = 0;
  const feature = loadController('audit-runner.js', 'GeoScoreAuditRunner', { EventSource: FakeEventSource });
  const runner = feature.create({
    EventSource: FakeEventSource,
    buildEndpoint: () => 'https://api.example/audit',
    onComplete: () => { completed += 1; },
  });

  runner.start({ domain: 'first.example' });
  const source = runner.getActiveSource();
  runner.cancel();
  source.emit('complete', { audit_id: 'stale' });

  assert.equal(source.closed, true);
  assert.equal(completed, 0);
});

test('custom API controller stages one-use config and bounds model discovery', async () => {
  const feature = loadController('custom-api.js', 'GeoScoreCustomApi');
  const modelOptions = [];
  const statusAttributes = {};
  const elements = {
    'custom-api-panel': { open: false },
    'custom-api-key': { value: ' secret-key ', focus() {} },
    'custom-api-base-url': { value: 'https://api.example.com/v1/', focus() {} },
    'custom-api-model': { value: ' model-a ', focus() {} },
    'custom-api-model-list': {
      replaceChildren() { modelOptions.length = 0; },
      appendChild(option) { modelOptions.push(option.value); },
    },
    'custom-api-fetch-models': { disabled: false, textContent: '', addEventListener() {} },
    'custom-api-status': {
      textContent: '',
      classList: fakeClassList(['hidden']),
      setAttribute(name, value) { statusAttributes[name] = value; },
    },
  };
  let capturedRequest = null;
  const controller = feature.create({
    apiBase: 'https://geo-api.example.com',
    uiText: (key, vars) => vars?.count ? `${key}:${vars.count}` : key,
    document: {
      getElementById: id => elements[id] ?? null,
      createElement: () => ({ value: '' }),
    },
    fetch: async (url, options) => {
      capturedRequest = { url, options };
      return {
        ok: true,
        json: async () => ({ data: Array.from({ length: 55 }, (_, index) => ({ id: `model-${index}` })) }),
      };
    },
  });

  const runId = controller.nextRunId();
  assert.deepEqual(JSON.parse(JSON.stringify(controller.stage(runId))), { ok: true, configured: true });
  assert.equal(elements['custom-api-key'].value, '');
  assert.equal(elements['custom-api-base-url'].value, '');
  assert.equal(elements['custom-api-model'].value, '');
  const config = controller.claim(runId);
  assert.deepEqual(JSON.parse(JSON.stringify(config)), {
    runId,
    apiKey: 'secret-key',
    apiBaseUrl: 'https://api.example.com/v1',
    apiModel: 'model-a',
  });
  assert.equal(controller.claim(runId), null);
  controller.overwriteConfig(config);
  assert.equal(config.apiKey, '');

  elements['custom-api-key'].value = 'models-secret';
  elements['custom-api-base-url'].value = 'https://api.example.com/v1';
  assert.equal(await controller.fetchModels(), true);
  assert.equal(capturedRequest.url, 'https://geo-api.example.com/api/answer-models');
  assert.equal(capturedRequest.options.headers['X-API-Key'], 'models-secret');
  assert.equal(modelOptions.length, 50);
  assert.equal(statusAttributes.role, 'status');
});

test('custom API base URL normalization adds v1 and removes endpoint suffixes', () => {
  const feature = loadController('custom-api.js', 'GeoScoreCustomApi');

  assert.equal(feature.normalizeBaseUrl('https://api.example.com'), 'https://api.example.com/v1');
  assert.equal(feature.normalizeBaseUrl('https://api.example.com/'), 'https://api.example.com/v1');
  assert.equal(feature.normalizeBaseUrl('https://api.example.com/v1/models'), 'https://api.example.com/v1');
  assert.equal(feature.normalizeBaseUrl('https://api.example.com/chat/completions'), 'https://api.example.com/v1');
  assert.equal(feature.normalizeBaseUrl('https://api.example.com/api/v1'), 'https://api.example.com/api/v1');
});

test('assistant controller requests FixPack only for the stored recommendation', async () => {
  const feature = loadController('assistant-ui.js', 'GeoScoreAssistantUi');
  const timerSpan = { textContent: '' };
  const box = {
    classList: { toggle: () => false },
    dataset: {},
    innerHTML: '',
    appendChild(value) { this.child = value; },
  };
  const item = { querySelector: selector => selector === '.what-to-do' ? box : null };
  const button = {
    dataset: { recommendationId: 'seo.title' },
    textContent: '',
    closest: selector => selector === 'li' ? item : null,
  };
  let capturedRequest = null;
  const document = {
    createElement: () => ({
      className: '',
      innerHTML: '',
      querySelector: selector => selector === 'span' ? timerSpan : null,
    }),
    getElementById: () => null,
    querySelectorAll: () => [],
  };
  const controller = feature.create({
    apiBase: 'https://geo-api.example.com',
    uiText: key => key,
    escapeHtml: value => String(value),
    formatSeconds: () => '0s',
    getAuditId: () => 'audit_1',
    getReportLanguage: () => 'zh',
    getRecommendation: id => id === 'seo.title' ? { id } : null,
    document,
    storage: { getItem: () => null, setItem() {} },
    crypto: { randomUUID: () => 'session_1' },
    fetch: async (url, options) => {
      capturedRequest = { url, options };
      return {
        ok: true,
        json: async () => ({
          evidence: { observed: ['missing title'] },
          fix_steps: ['add title'],
          verify: ['re-audit'],
          handoff_prompt: 'fix only the title',
        }),
      };
    },
  });

  assert.equal(await controller.toggleFix(button), true);
  assert.equal(capturedRequest.url, 'https://geo-api.example.com/api/fix');
  assert.deepEqual(JSON.parse(capturedRequest.options.body), {
    audit_id: 'audit_1',
    recommendation_id: 'seo.title',
    language: 'zh',
    output: 'full',
  });
  assert.match(box.innerHTML, /missing title/);
  assert.match(box.innerHTML, /fix only the title/);
});

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
  assert.equal(controller.getState().snapshot.answer.model, 'model-a');
  assert.equal(controller.getState().snapshot.api_key, undefined);
  assert.equal(auditData.evidence_map.answer.model, 'model-a');
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

test('monitoring controller sends complete BYOK config, clears inputs and never stores credentials', async () => {
  class FakeFormData {
    constructor(form) { this.form = form; }
    get(name) { return this.form.values?.[name] ?? ''; }
    getAll(name) { return this.form.values?.[name] ?? []; }
  }

  const feature = loadController('monitoring.js', 'GeoScoreMonitoring');
  const customApi = loadController('custom-api.js', 'GeoScoreCustomApi');
  let auditData = { audit_id: 'audit_1', domain: 'example.com' };
  let resolveRun;
  let byokHeaders = null;
  let byokBody = null;
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
        byokBody = JSON.parse(options.body);
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
    normalizeBaseUrl: customApi.normalizeBaseUrl,
  });

  await controller.createProject({ values: { email: '' } });
  const inputs = {
    'input[name="api_key"]': { value: 'sk-one-use-byok' },
    'input[name="api_base_url"]': { value: 'https://api.example.com' },
    'input[name="api_model"]': { value: 'model-a' },
  };
  const form = {
    dataset: { monitorForm: 'byok' },
    querySelector: selector => inputs[selector] ?? null,
  };
  const event = {
    target: { closest: () => form },
    preventDefault() {},
  };

  assert.equal(controller.handleSubmit(event), true);
  assert.equal(inputs['input[name="api_key"]'].value, '');
  assert.equal(inputs['input[name="api_base_url"]'].value, '');
  assert.equal(inputs['input[name="api_model"]'].value, '');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(byokHeaders['X-API-Key'], 'sk-one-use-byok');
  assert.deepEqual(byokBody, { api_base_url: 'https://api.example.com/v1', api_model: 'model-a' });
  assert.doesNotMatch(JSON.stringify(controller.getState()), /sk-one-use-byok/);
  assert.doesNotMatch(JSON.stringify(controller.getState()), /api\.example\.com/);
  assert.doesNotMatch(JSON.stringify(auditData), /sk-one-use-byok/);
  resolveRun();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(calls.some(url => url.endsWith('/byok-runs')));
  assert.ok(calls.some(url => url.endsWith('/runs')));
});

test('monitoring model discovery preserves request-scoped inputs across rerenders', async () => {
  const feature = loadController('monitoring.js', 'GeoScoreMonitoring');
  const customApi = loadController('custom-api.js', 'GeoScoreCustomApi');
  const makeForm = () => {
    const inputs = {
      'input[name="api_key"]': { value: '' },
      'input[name="api_base_url"]': { value: '' },
      'input[name="api_model"]': { value: '' },
    };
    return { inputs, querySelector: selector => inputs[selector] ?? null };
  };
  let currentForm = makeForm();
  currentForm.inputs['input[name="api_key"]'].value = 'sk-request-scoped-models';
  currentForm.inputs['input[name="api_base_url"]'].value = 'https://api.example.com';
  currentForm.inputs['input[name="api_model"]'].value = 'model-before-fetch';
  const document = {
    querySelector: selector => selector === '[data-monitor-form="byok"]' ? currentForm : null,
  };
  const controller = feature.create({
    apiBase: 'https://geo-api.example.com',
    fetchJson: async (url, options) => {
      assert.equal(url, 'https://geo-api.example.com/api/answer-models');
      assert.equal(options.headers['X-API-Key'], 'sk-request-scoped-models');
      assert.deepEqual(JSON.parse(options.body), { api_base_url: 'https://api.example.com/v1' });
      return { models: ['model-a', 'model-b'] };
    },
    getReportLanguage: () => 'en',
    getAuditId: () => 'audit_1',
    normalizeBaseUrl: customApi.normalizeBaseUrl,
    document,
    rerender: () => { currentForm = makeForm(); },
  });

  assert.equal(await controller.fetchModels(currentForm), true);
  assert.equal(currentForm.inputs['input[name="api_key"]'].value, 'sk-request-scoped-models');
  assert.equal(currentForm.inputs['input[name="api_base_url"]'].value, 'https://api.example.com');
  assert.equal(currentForm.inputs['input[name="api_model"]'].value, 'model-before-fetch');
  assert.deepEqual(controller.getState().modelOptions, ['model-a', 'model-b']);
  assert.doesNotMatch(JSON.stringify(controller.getState()), /sk-request-scoped-models|api\.example\.com/);
});

test('monitoring controller connects, explicitly saves, forgets and rotates a project token', async () => {
  class FakeFormData {
    constructor(form) { this.form = form; }
    get(name) { return this.form.values?.[name] ?? ''; }
    getAll(name) { return this.form.values?.[name] ?? []; }
  }
  const storage = new Map();
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  };
  const projectId = 'mon_01JGEOSCORE24CONNECTPROJECT';
  const oldToken = 'gmt_existing_management_token';
  const newToken = 'gmt_rotated_management_token';
  const feature = loadController('monitoring.js', 'GeoScoreMonitoring', { localStorage });
  const controller = feature.create({
    apiBase: 'https://geo-api.example.com',
    fetchJson: async (url, options = {}) => {
      if (String(url).endsWith(`/api/monitor-projects/${projectId}`)) {
        assert.equal(options.headers['X-Project-Token'], oldToken);
        return { project: { id: projectId, root_domain: 'example.com', queries: [] } };
      }
      if (String(url).endsWith(`/api/monitor-projects/${projectId}/runs`)) return { runs: [] };
      if (String(url).endsWith(`/api/monitor-projects/${projectId}/token/rotate`)) {
        return { management_token: newToken, token_shown_once: true };
      }
      throw new Error(`Unexpected URL ${url}`);
    },
    getReportLanguage: () => 'en',
    getAuditId: () => 'audit_1',
    FormData: FakeFormData,
    localStorage,
  });

  assert.equal(await controller.connectProject({ values: { project_id: projectId, management_token: oldToken } }), true);
  assert.equal(controller.getState().project.id, projectId);
  assert.equal(controller.saveTokenToDevice(), true);
  assert.equal(storage.get(`geoscore:monitor-token:${projectId}`), oldToken);
  assert.equal(controller.forgetTokenFromDevice(), true);
  assert.equal(storage.has(`geoscore:monitor-token:${projectId}`), false);
  assert.equal(await controller.rotateToken(), true);
  assert.equal(controller.getState().managementToken, newToken);
  assert.equal(controller.getState().showToken, true);
  assert.equal(storage.has(`geoscore:monitor-token:${projectId}`), false);
});
