import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { afterEach, describe, it } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-email-'));
fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"type":"commonjs"}\n');
fs.symlinkSync(path.resolve('node_modules'), path.join(tmpDir, 'node_modules'), 'junction');
execFileSync(process.execPath, [
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
  'src/lib/email.ts',
], { stdio: 'inherit' });

const require = createRequire(import.meta.url);
const email = require(path.join(tmpDir, 'lib', 'email.js'));
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('email adapter', () => {
  it('normalizes the fixed-sender endpoint without duplicating v1', () => {
    assert.equal(email.emailInternals.fallbackEndpoint('https://mail.example.com'), 'https://mail.example.com/v1/messages');
    assert.equal(email.emailInternals.fallbackEndpoint('https://mail.example.com/v1'), 'https://mail.example.com/v1/messages');
    assert.equal(email.emailInternals.fallbackEndpoint('https://mail.example.com/v1/messages'), 'https://mail.example.com/v1/messages');
    assert.equal(email.emailInternals.fallbackEndpoint('http://mail.example.com'), null);
  });

  it('uses the fixed sender when the primary provider is unavailable', async () => {
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url) === 'https://api.resend.com/emails') return new Response('', { status: 503 });
      return Response.json({ status: 'ok' });
    };

    const delivery = await email.sendEmail({
      RESEND_API_KEY: 'primary-secret',
      CF_TEMP_MAIL_BASE_URL: 'https://mail.example.com',
      CF_TEMP_MAIL_SEND_API_KEY: 'fallback-secret',
    }, 'owner@example.com', 'GeoScore alert', '<p>Changed</p>', 'monitor-run-1');

    assert.equal(delivery.ok, true);
    assert.equal(delivery.channel, 'fallback');
    assert.deepEqual(delivery.diagnostics, [{ channel: 'primary', error_code: 'EMAIL_PROVIDER_UNAVAILABLE', status: 503 }]);
    assert.deepEqual(calls.map(call => call.url), [
      'https://api.resend.com/emails',
      'https://mail.example.com/v1/messages',
    ]);
    const fallbackHeaders = new Headers(calls[1].init.headers);
    assert.equal(fallbackHeaders.get('Authorization'), 'Bearer fallback-secret');
    assert.deepEqual(JSON.parse(calls[1].init.body), {
      to: 'owner@example.com',
      subject: 'GeoScore alert',
      html: '<p>Changed</p>',
    });
  });

  it('does not retry a rejected message through the fallback channel', async () => {
    const calls = [];
    globalThis.fetch = async url => {
      calls.push(String(url));
      return new Response('', { status: 400 });
    };

    const delivery = await email.sendEmail({
      RESEND_API_KEY: 'primary-secret',
      CF_TEMP_MAIL_BASE_URL: 'https://mail.example.com',
      CF_TEMP_MAIL_SEND_API_KEY: 'fallback-secret',
    }, 'owner@example.com', 'GeoScore alert', '<p>Changed</p>');

    assert.equal(delivery.ok, false);
    assert.equal(delivery.error_code, 'EMAIL_SEND_REJECTED');
    assert.deepEqual(calls, ['https://api.resend.com/emails']);
  });

  it('can use the fixed sender as the only configured channel', async () => {
    globalThis.fetch = async (url, init = {}) => {
      assert.equal(String(url), 'https://mail.example.com/v1/messages');
      assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer fallback-secret');
      return Response.json({ status: 'ok' });
    };

    const delivery = await email.sendEmail({
      CF_TEMP_MAIL_BASE_URL: 'https://mail.example.com/v1',
      CF_TEMP_MAIL_SEND_API_KEY: 'fallback-secret',
    }, 'owner@example.com', 'Verify', '<p>Verify</p>');

    assert.equal(delivery.ok, true);
    assert.equal(delivery.channel, 'fallback');
  });
});
