import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const ui = fs.readFileSync(path.join(root, 'frontend', 'site-pass.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');
const prompts = fs.readFileSync(path.join(root, 'src', 'prompts', 'index.ts'), 'utf8');

test('site pass link carries the audited domain without exposing secrets', () => {
  assert.match(ui, /client_reference_id/);
  assert.match(ui, /pay\.geo\.sayori\.org/);
  assert.doesNotMatch(ui, /rk_live_|sk_live_|whsec_/);
  assert.match(html, /id="site-pass-card"/);
  assert.match(html, /site-pass\.js/);
});

test('homepage explains the free audit, Site Pass value, and product fit', () => {
  assert.match(html, /id="product-info"/);
  assert.match(html, /id="pricing"/);
  assert.match(html, /product\.pricing\.pass\.price/);
  assert.match(html, /buy\.stripe\.com\/7sY28t61t9OE3WA9ah38400/);
  assert.match(prompts, /GEOSCORE_PRODUCT_CONTEXT/);
  assert.match(prompts, /HKD 49/);
  assert.match(prompts, /prioritized repair queue/);
});
