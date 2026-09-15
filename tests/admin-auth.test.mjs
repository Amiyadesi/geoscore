import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-admin-auth-'));
fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"type":"module"}\n');
fs.symlinkSync(path.resolve('node_modules'), path.join(tmpDir, 'node_modules'), 'junction');

execFileSync(
  process.execPath,
  [
    path.join('node_modules', 'typescript', 'bin', 'tsc'),
    '--target', 'ES2022',
    '--module', 'ES2022',
    '--moduleResolution', 'bundler',
    '--lib', 'ES2022',
    '--types', '@cloudflare/workers-types',
    '--skipLibCheck',
    '--outDir', tmpDir,
    'src/lib/admin-auth.ts',
  ],
  { stdio: 'inherit' },
);

function pathToFileUrl(value) {
  const resolved = path.resolve(value);
  return resolved.startsWith('/') ? `file://${resolved}` : `file:///${resolved.replace(/\\/g, '/')}`;
}

const {
  isAllowedAdminLogin,
  safeNextUrl,
  signAdminSession,
  readAdminSession,
} = await import(pathToFileUrl(path.join(tmpDir, 'admin-auth.js')));

describe('admin github allowlist', () => {
  it('defaults to Amiyadesi and ignores other logins', () => {
    const env = { ADMIN_GITHUB_LOGINS: '' };
    assert.equal(isAllowedAdminLogin('Amiyadesi', env), true);
    assert.equal(isAllowedAdminLogin('amiyadesi', env), true);
    assert.equal(isAllowedAdminLogin('someone-else', env), false);
  });
});

describe('admin session cookie', () => {
  it('round-trips a signed payload', async () => {
    const token = await signAdminSession({ login: 'Amiyadesi', iat: 1, exp: Math.floor(Date.now() / 1000) + 60 }, 'secret');
    const session = await readAdminSession(token, 'secret');
    assert.equal(session?.login, 'Amiyadesi');
    assert.equal(await readAdminSession(token, 'wrong'), null);
  });
});

describe('oauth next url', () => {
  it('only returns same-origin admin pages', () => {
    const env = { PUBLIC_APP_URL: 'https://geo.sayori.org', PUBLIC_API_URL: 'https://geo-api.sayori.org' };
    assert.equal(safeNextUrl('https://geo.sayori.org/admin.html', env), 'https://geo.sayori.org/admin.html');
    assert.equal(safeNextUrl('https://evil.example/admin.html', env), 'https://geo.sayori.org/admin.html');
  });
});
