import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const ui = fs.readFileSync(path.join(root, 'frontend', 'site-pass.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');

test('site pass link carries the audited domain without exposing secrets', () => {
  assert.match(ui, /client_reference_id/);
  assert.match(ui, /pay\.geo\.sayori\.org/);
  assert.doesNotMatch(ui, /rk_live_|sk_live_|whsec_/);
  assert.match(html, /id="site-pass-card"/);
  assert.match(html, /site-pass\.js/);
});
