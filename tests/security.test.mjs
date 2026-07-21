import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-security-'));
fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"type":"module"}\n');

execFileSync(
  process.execPath,
  [
    path.join('node_modules', 'typescript', 'bin', 'tsc'),
    '--target',
    'ES2022',
    '--module',
    'ES2022',
    '--moduleResolution',
    'bundler',
    '--lib',
    'ES2022',
    '--types',
    '@cloudflare/workers-types',
    '--skipLibCheck',
    '--outDir',
    tmpDir,
    'src/lib/security.ts',
  ],
  { stdio: 'inherit' },
);

const { corsHeaders, isValidPublicHostname, PUBLIC_DOMAIN_ERROR } = await import(
  pathToFileUrl(path.join(tmpDir, 'security.js'))
);

describe('public hostname validation', () => {
  it('exports the public-domain error contract', () => {
    assert.equal(PUBLIC_DOMAIN_ERROR, 'Only public domains are supported');
  });

  it('allows the documented local frontend without opening CORS to arbitrary origins', () => {
    const env = { ALLOWED_ORIGINS: '', PUBLIC_APP_URL: 'https://geo.sayori.org' };
    const local = corsHeaders(new Request('https://geo-api.sayori.org/api/meta', {
      headers: { Origin: 'http://127.0.0.1:4173' },
    }), env);
    const unknown = corsHeaders(new Request('https://geo-api.sayori.org/api/meta', {
      headers: { Origin: 'https://untrusted.example' },
    }), env);

    assert.equal(local['Access-Control-Allow-Origin'], 'http://127.0.0.1:4173');
    assert.equal(unknown['Access-Control-Allow-Origin'], 'https://geo.sayori.org');
  });

  it('allows ordinary public hostnames', () => {
    assert.equal(isValidPublicHostname('example.com'), true);
    assert.equal(isValidPublicHostname('sub.example.co.uk'), true);
    assert.equal(isValidPublicHostname('xn--fsqu00a.xn--0zwm56d'), true);
  });

  it('rejects localhost, internal suffixes, and IP literals', () => {
    for (const hostname of [
      'localhost',
      'app.localhost',
      'printer.lan',
      'service.internal',
      'example.test',
      'home.arpa',
      'device.home.arpa',
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '192.168.1.1',
      '[::1]',
      '::1',
    ]) {
      assert.equal(isValidPublicHostname(hostname), false, hostname);
    }
  });

  it('rejects URL-like or port-bearing targets', () => {
    for (const hostname of [
      'https://example.com',
      'example.com/path',
      'example.com?x=1',
      'example.com#fragment',
      'example.com:8080',
      'user@example.com',
      'example',
      '-bad.example',
      'bad-.example',
    ]) {
      assert.equal(isValidPublicHostname(hostname), false, hostname);
    }
  });
});

function pathToFileUrl(value) {
  const resolved = path.resolve(value).replaceAll('\\', '/');
  return `file://${resolved.startsWith('/') ? '' : '/'}${resolved}`;
}
