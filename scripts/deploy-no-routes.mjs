import { execFile } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const sourceConfig = process.argv[2] || 'wrangler.generated.jsonc';
const workerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(sourceConfig, 'utf8'));
delete config.routes;

const tempConfig = path.join(workerDir, `.wrangler.no-routes.${Date.now()}.jsonc`);
await writeFile(tempConfig, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

const command = process.execPath;
const args = [path.join('node_modules', 'wrangler', 'bin', 'wrangler.js'), 'deploy', '--config', tempConfig, '--minify'];
let child;
try {
  child = await execFileAsync(command, args, {
    env: process.env,
    cwd: workerDir,
    maxBuffer: 1024 * 1024 * 10,
  });
} finally {
  await rm(tempConfig, { force: true });
}

if (child.stdout) process.stdout.write(child.stdout);
if (child.stderr) process.stderr.write(child.stderr);
