import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.join(here, '..', 'frontend');
const read = file => fs.readFileSync(path.join(frontend, file), 'utf8');
const index = read('index.html');
const app = read('app.js');
const customApi = read('custom-api.js');
const evidenceMap = read('evidence-map.js');
const i18nSource = read('i18n.js');

function loadI18n(language = 'en-US') {
  const context = {
    navigator: { language, languages: [language] },
    localStorage: { getItem: () => null, setItem() {} },
    dispatchEvent() {},
    CustomEvent: class CustomEvent {},
  };
  context.globalThis = context;
  vm.runInNewContext(i18nSource, context, { filename: 'i18n.js' });
  return context.GeoScoreI18n;
}

test('custom API panel is directly below the main target input and closed by default', () => {
  const search = index.indexOf('id="search-input"');
  const panel = index.indexOf('id="custom-api-panel"');
  const examples = index.indexOf('id="try-label"');
  assert.ok(search >= 0 && search < panel && panel < examples);
  assert.match(index, /<details id="custom-api-panel"[^>]*>/);
  assert.doesNotMatch(index, /<details id="custom-api-panel"[^>]*\sopen(?:\s|>)/);
  assert.match(index, /data-i18n="customApi\.summary">Custom API</);
  assert.match(index, /id="custom-api-key" type="password"[^>]*autocomplete="off"/);
  assert.match(index, /id="custom-api-base-url" type="url"[^>]*inputmode="url"/);
  assert.match(index, /id="custom-api-model" type="text" list="custom-api-model-list"/);
  assert.match(index, /id="custom-api-status" role="status" aria-live="polite"/);
  assert.match(index, /sm:grid-cols-\[minmax\(0,1fr\)_auto\]/);
});

test('custom API copy is bilingual and states the zero-score and no-storage boundaries', () => {
  const i18n = loadI18n();
  assert.equal(i18n.t('customApi.summary', {}, 'en'), 'Custom API');
  assert.equal(i18n.t('customApi.summary', {}, 'zh'), '自定义 API');
  assert.equal(i18n.t('customApi.fetchModels', {}, 'en'), 'Fetch models');
  assert.equal(i18n.t('customApi.fetchModels', {}, 'zh'), '拉取模型');
  assert.match(i18n.t('customApi.body', {}, 'en'), /never changes the factual score/i);
  assert.match(i18n.t('customApi.body', {}, 'zh'), /绝不会改变事实评分/);
  assert.match(i18n.t('customApi.privacy', {}, 'en'), /never written to browser storage, the URL, or reports/i);
  assert.match(i18n.t('customApi.error.evidence', {}, 'zh'), /事实审查与评分均未受到影响/);
  assert.match(i18n.t('customApi.error.audit', {}, 'en'), /configuration was discarded/);
});

test('model discovery is bounded, keyboard accessible and keeps manual model entry', () => {
  assert.match(customApi, /const MODEL_LIMIT = 50/);
  assert.match(customApi, /models\.length >= MODEL_LIMIT/);
  assert.match(customApi, /\/api\/answer-models/);
  assert.match(customApi, /method: 'POST'/);
  assert.match(customApi, /'X-API-Key': key/);
  assert.match(customApi, /JSON\.stringify\(\{ api_base_url: normalizedBaseUrl \}\)/);
  assert.match(customApi, /documentRef\.createElement\('option'\)/);
  assert.match(index, /<datalist id="custom-api-model-list"><\/datalist>/);
  assert.match(index, /data-i18n-placeholder="customApi\.model\.placeholder"/);
  assert.ok(index.indexOf('src="custom-api.js"') < index.indexOf('src="app.js"'));
});

test('custom API values are cleared before the factual audit and consumed once after completion', () => {
  const stage = customApi.slice(
    customApi.indexOf('function stage(runId)'),
    customApi.indexOf('function claim(runId)'),
  );
  const start = app.slice(
    app.indexOf('async function startAudit'),
    app.indexOf('function showAuditShell'),
  );
  const evidence = evidenceMap.slice(evidenceMap.indexOf('async function run'), evidenceMap.indexOf('function handleClick'));
  assert.match(stage, /pendingConfig = \{/);
  assert.match(stage, /clearInputs\(\)/);
  assert.ok(stage.indexOf('clearInputs()') < stage.indexOf("setStatus(uiText('customApi.queued'))"));
  assert.match(start, /customApiController\.stage\(customApiRunId\)/);
  assert.ok(start.indexOf('customApiController.stage(customApiRunId)') < start.indexOf('openAuditStream(currentAuditRequest'));
  assert.match(evidence, /'X-API-Key': customApiConfig\.apiKey/);
  assert.match(evidence, /api_base_url: customApiConfig\.apiBaseUrl/);
  assert.match(evidence, /api_model: customApiConfig\.apiModel/);
  assert.ok(evidence.indexOf('overwriteCustomApiConfig?.(customApiConfig)') < evidence.indexOf('const payload = await requestPromise'));
  assert.match(evidence, /claimPendingCustomApiConfig\?\.\(runId\)/);
  assert.match(app, /evidenceMapController\.runPending\(d\.data, auditRequest\.customApiRunId\)/);
  assert.match(app, /evidenceMapController\.runPending\(d, auditRequest\.customApiRunId\)/);
  assert.match(evidence, /customApi\.sent/);
  assert.match(evidence, /customApi\.complete/);
});

test('custom API config is not persisted, placed in the audit URL, or copied into reports', () => {
  const customFeature = `${customApi}\n${evidenceMap}`;
  const requestObject = app.slice(
    app.indexOf('currentAuditRequest = {', app.indexOf('async function startAudit')),
    app.indexOf('};', app.indexOf('currentAuditRequest = {', app.indexOf('async function startAudit'))) + 2,
  );
  assert.doesNotMatch(customFeature, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(requestObject, /apiKey|apiBaseUrl|apiModel|api_base_url|api_model/);
  assert.match(requestObject, /customApiRunId/);
  assert.match(customFeature, /blocked = new Set\(\['api_key'.*'api_base_url'.*'api_model'/s);
  assert.doesNotMatch(customFeature, /'api_model', 'model'/);
  assert.match(customFeature, /CUSTOM_API_EVIDENCE_FAILED/);
  assert.doesNotMatch(customFeature, /currentAuditData\s*=\s*\{[^}]*api_base_url/s);
});
