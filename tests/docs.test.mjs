import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('bilingual docs cover the public monitoring and BYOK workflow without runtime CDN assets', () => {
  const html = fs.readFileSync(path.join(root, 'frontend', 'docs', 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'frontend', 'docs', 'docs.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'frontend', 'docs', 'docs.css'), 'utf8');

  assert.match(html, /data-doc-lang="en"/);
  assert.match(html, /data-doc-lang="zh"/);
  assert.match(html, /X-Project-Token: MANAGEMENT_TOKEN/);
  assert.match(html, /X-API-Key: REQUEST_SCOPED_API_KEY/);
  assert.match(html, /automatic <code>\/v1<\/code>/);
  assert.match(html, /API Key .* Base URL .* model/s);
  assert.match(html, /https:\/\/geo-api\.sayori\.org\/openapi\.json/);
  assert.match(html, /does not predict or guarantee rankings/i);
  assert.match(html, /不预测或保证排名/);
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com|unpkg\.com|jsdelivr\.net/);
  assert.match(script, /geoscore:ui-language/);
  assert.match(script, /navigator\.language/);
  assert.ok(css.length > 1000);
});

test('manual service actions keep provider acquisition boundaries explicit', () => {
  const manual = fs.readFileSync(path.join(root, 'docs', 'manual-service-actions.md'), 'utf8');
  assert.match(manual, /Google Analytics Data API \(planned owner-only extension\)/);
  assert.match(manual, /Bing Webmaster Tools/);
  assert.match(manual, /DataForSEO SERP API \(paid depth, not free audit\)/);
  assert.match(manual, /0006_google_search_console\.sql/);
  assert.match(manual, /do not run it on the free anonymous path/i);
});
