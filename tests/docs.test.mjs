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
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com|unpkg\.com|jsdelivr\.net/);
  assert.match(script, /geoscore:ui-language/);
  assert.match(script, /navigator\.language/);
  assert.ok(css.length > 1000);
});
