import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.join(here, '..', 'frontend');
const read = file => fs.readFileSync(path.join(frontend, file), 'utf8');

function loadI18n({ language = 'en-US', stored = {} } = {}) {
  const values = new Map(Object.entries(stored));
  const context = {
    navigator: { language, languages: [language] },
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
    },
    CustomEvent: class CustomEvent {
      constructor(type, options) { this.type = type; this.detail = options?.detail; }
    },
    dispatchEvent() {},
  };
  context.globalThis = context;
  vm.runInNewContext(read('i18n.js'), context, { filename: 'i18n.js' });
  return { i18n: context.GeoScoreI18n, values };
}

test('UI language follows zh browser locales and persists independently from report language', () => {
  const { i18n, values } = loadI18n({ language: 'zh-TW' });
  assert.equal(i18n.getUiLanguage(), 'zh');
  assert.equal(i18n.getReportLanguage(), null);

  i18n.setUiLanguage('en');
  i18n.setReportLanguage('zh-CN');
  assert.equal(values.get('geoscore:ui-language'), 'en');
  assert.equal(values.get('geoscore:report-language'), 'zh');
  assert.equal(i18n.getUiLanguage(), 'en');
  assert.equal(i18n.getReportLanguage(), 'zh');
});

test('shared catalog localizes product copy and interpolates values', () => {
  const { i18n } = loadI18n({ language: 'en-US' });
  assert.equal(i18n.t('nav.tools', {}, 'zh'), '免费工具');
  assert.equal(i18n.t('app.documentTitle', {}, 'zh'), 'GeoScore — 证据优先的 SEO 与 GEO 审查');
  assert.equal(i18n.t('semantic.loading', {}, 'zh'), 'AI 加载中…');
  assert.equal(i18n.t('progress.modules', { done: 2, total: 8 }, 'zh'), '2 / 8 项');
  assert.equal(i18n.t('missing.key', {}, 'zh'), 'missing.key');
});

test('homepage and tools load the shared catalog before their page scripts', () => {
  const index = read('index.html');
  const tools = read('tools.html');
  assert.ok(index.indexOf('src="i18n.js"') < index.indexOf('src="report-ui.js"'));
  assert.ok(tools.indexOf('src="i18n.js"') < tools.indexOf('src="tools.js"'));
  assert.match(index, /id="ui-language-select"/);
  assert.match(tools, /id="ui-language-select"/);
});

test('frontend CSP permits every declared runtime resource without inline executable config', () => {
  const index = read('index.html');
  const headers = read('_headers');

  assert.match(index, /src="tailwind-config\.js"/);
  assert.doesNotMatch(index, /<script>\s*tailwind\.config\s*=/);
  assert.match(headers, /style-src[^;\n]*https:\/\/cdn\.jsdelivr\.net/);
  assert.match(headers, /font-src[^;\n]*https:\/\/cdn\.jsdelivr\.net/);
  assert.match(headers, /connect-src[^;\n]*https:\/\/cloudflareinsights\.com/);
  assert.match(headers, /connect-src[^;\n]*https:\/\/\*\.xethub\.hf\.co/);
});

test('app uses persisted UI/report language and public meta facts', () => {
  const app = read('app.js');
  assert.match(app, /GeoScoreI18n/);
  assert.match(app, /getUiLanguage\(\)/);
  assert.match(app, /getReportLanguage\(\)/);
  assert.match(app, /setReportLanguage/);
  assert.match(app, /\/api\/meta/);
  assert.match(app, /data-meta-fact/);
});

test('static product copy contains no stale check, speed, cache, fixed-model, or real-citation claims', () => {
  const publicCopy = `${read('index.html')}\n${read('llms.txt')}\n${read('app.js')}`;
  for (const pattern of [
    /39\+?\s+(?:individual\s+)?checks/i,
    /15\s+modules/i,
    /(?:results?\s+in|complete\s+in|all\s+under)\s+(?:~?\s*)?(?:15\s+to\s+30|30|60)\s+seconds?/i,
    /no cached data/i,
    /Llama\s*3/i,
    /citation probability/i,
    /three real .*quer/i,
    /would cite your website/i,
    /AI citation probability/i,
    /low AI citation rate/i,
  ]) assert.doesNotMatch(publicCopy, pattern);
});

test('report UI consumes the shared catalog and exposes a persistent report-language switch', () => {
  const report = read('report-ui.js');
  assert.match(report, /GeoScoreI18n/);
  assert.match(report, /data-report-lang="zh"/);
  assert.match(report, /data-report-lang="en"/);
});

test('dynamic schema fields and browser-generated warnings use the shared bilingual catalog', () => {
  const { i18n } = loadI18n({ language: 'zh-CN' });
  assert.equal(i18n.t('tools.schema.field.sc-art-author', {}, 'zh'), '作者名称');
  assert.equal(i18n.t('tools.serp.titleLong', {}, 'zh'), '标题在部分搜索结果中可能被截断。');
  const tools = read('tools.js');
  assert.match(tools, /tools\.schema\.field\.\$\{f\.id\}/);
  assert.doesNotMatch(tools, /Google may truncate after/);
});
