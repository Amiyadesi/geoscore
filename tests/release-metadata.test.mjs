import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('standalone release metadata is public MIT with upstream attribution', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
  const notices = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const deployWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy.yml'), 'utf8');

  assert.equal(pkg.version, '2.4.0');
  assert.equal(pkg.private, false);
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.repository?.url, 'git+https://github.com/Amiyadesi/geoscore.git');
  assert.match(license, /^MIT License/m);
  assert.match(notices, /sprawf\/geoscore/);
  assert.match(readme, /License and attribution/);
  assert.match(deployWorkflow, /GEOSCORE_MONITOR_TOKEN_PEPPER:\s*\$\{\{ secrets\.GEOSCORE_MONITOR_TOKEN_PEPPER \}\}/);
  assert.match(deployWorkflow, /MONITOR_TOKEN_PEPPER:\s*process\.env\.GEOSCORE_MONITOR_TOKEN_PEPPER/);
  assert.doesNotMatch(readme, /private operational repository|not currently licensed for redistribution/i);
  assert.equal(fs.existsSync(path.join(root, 'LICENSE-STATUS.md')), false);
});
