import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'frontend', 'locale-bootstrap.js'), 'utf8');

async function runBootstrap({ url = 'https://geo.sayori.org/', cookies = {}, stored = {}, browser = 'en-US', detected = 'en', fail = false } = {}) {
  const cookieJar = new Map(Object.entries(cookies));
  const values = new Map(Object.entries(stored));
  let replaced = '';
  let reloads = 0;
  let fetches = 0;
  const document = { documentElement: { dataset: {}, lang: '' } };
  Object.defineProperty(document, 'cookie', {
    get: () => [...cookieJar].map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('; '),
    set: value => {
      const [pair, ...attributes] = String(value).split(';');
      const [key, ...parts] = pair.split('=');
      if (attributes.some(attribute => /max-age=0/i.test(attribute))) cookieJar.delete(key);
      else cookieJar.set(key, decodeURIComponent(parts.join('=')));
    },
  });
  const location = {
    href: url,
    reload: () => { reloads += 1; },
  };
  const context = {
    URL,
    document,
    location,
    history: { replaceState: (_state, _title, next) => { replaced = next; } },
    navigator: { language: browser, languages: [browser] },
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
    },
    fetch: async () => {
      fetches += 1;
      if (fail) throw new Error('offline');
      return { ok: true, json: async () => ({ locale: detected }) };
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'locale-bootstrap.js' });
  await context.SAYORI_LOCALE_READY;
  return { context, cookieJar, values, replaced, reloads, fetches };
}

test('URL locale overrides the shared cookie and is persisted manually', async () => {
  const result = await runBootstrap({ url: 'https://geo.sayori.org/?lang=zh-hant&x=1', cookies: { sayori_locale: 'en' } });
  assert.equal(result.context.SAYORI_INITIAL_LOCALE, 'zh-Hant');
  assert.equal(result.cookieJar.get('sayori_locale'), 'zh-Hant');
  assert.equal(result.replaced, '/?x=1');
  assert.equal(result.fetches, 0);
});

test('legacy GeoScore storage migrates to the shared manual cookie', async () => {
  const result = await runBootstrap({ stored: { 'geoscore:ui-language': 'zh' } });
  assert.equal(result.context.SAYORI_INITIAL_LOCALE, 'zh-Hans');
  assert.equal(result.cookieJar.get('sayori_locale'), 'zh-Hans');
  assert.equal(result.values.get('sayori:ui-language'), 'zh-Hans');
  assert.equal(result.fetches, 0);
});

test('IP locale is stored only in the automatic session cookie', async () => {
  const result = await runBootstrap({ detected: 'zh-Hant' });
  assert.equal(result.context.SAYORI_INITIAL_LOCALE, 'zh-Hant');
  assert.equal(result.cookieJar.get('sayori_locale_auto'), 'zh-Hant');
  assert.equal(result.cookieJar.has('sayori_locale'), false);
  assert.equal(result.context.document.documentElement.dataset.localePending, undefined);
});

test('failed locale API falls back to the exact browser locale', async () => {
  const result = await runBootstrap({ fail: true, browser: 'zh-TW' });
  assert.equal(result.context.SAYORI_INITIAL_LOCALE, 'zh-Hant');
  assert.equal(result.cookieJar.has('sayori_locale_auto'), false);
  assert.equal(result.reloads, 0);
});
