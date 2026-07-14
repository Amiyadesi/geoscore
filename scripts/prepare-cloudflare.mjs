import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import path from 'node:path';
import process from 'node:process';

const execFileAsync = promisify(execFile);
const ACCOUNT_ID = envValue('GEOSCORE_CF_ACCOUNT_ID') || envValue('CLOUDFLARE_ACCOUNT_ID');
const API_TOKEN = envValue('GEOSCORE_CF_API_TOKEN') || envValue('CLOUDFLARE_API_TOKEN');
const WORKER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(WORKER_DIR, 'wrangler.jsonc');
const GENERATED_CONFIG_PATH = path.join(WORKER_DIR, 'wrangler.generated.jsonc');
const SUMMARY_PATH = path.join(WORKER_DIR, 'resource-summary.json');

const D1_DATABASE = 'sayori-geoscore-db';
const AUDIT_KV = 'sayori-geoscore-audit-kv';
const BUDGET_KV = 'sayori-geoscore-budget-kv';
const VECTORIZE_INDEX = 'sayori-geoscore-vectors';

const useApi = !!ACCOUNT_ID && !!API_TOKEN;
if (useApi) {
  await verifyToken();
} else {
  console.log('Cloudflare API token env not found; using local Wrangler OAuth session.');
}

const d1 = useApi ? await ensureD1Database(D1_DATABASE) : await ensureD1DatabaseWithWrangler(D1_DATABASE);
const auditKv = useApi ? await ensureKvNamespace(AUDIT_KV) : await ensureKvNamespaceWithWrangler(AUDIT_KV);
const budgetKv = useApi ? await ensureKvNamespace(BUDGET_KV) : await ensureKvNamespaceWithWrangler(BUDGET_KV);
const vectorize = useApi ? await ensureVectorizeIndex(VECTORIZE_INDEX) : await ensureVectorizeIndexWithWrangler(VECTORIZE_INDEX);
await ensurePagesProjectWithWrangler('sayori-geoscore');
await writeGeneratedConfig({
  d1Id: d1.uuid || d1.id,
  auditKvId: auditKv.id,
  budgetKvId: budgetKv.id,
});

await writeFile(SUMMARY_PATH, `${JSON.stringify({
  worker: 'sayori-geoscore-api',
  uiWorker: 'sayori-geoscore-ui',
  pages: 'sayori-geoscore',
  appDomain: 'geo.sayori.org',
  apiDomain: 'geo-api.sayori.org',
  d1Database: D1_DATABASE,
  d1,
  kvNamespaces: { auditKv, budgetKv },
  vectorizeIndex: VECTORIZE_INDEX,
  vectorize,
}, null, 2)}\n`, 'utf8');

console.log(`D1 database ready: ${D1_DATABASE}`);
console.log(`KV namespace ready: ${AUDIT_KV}`);
console.log(`KV namespace ready: ${BUDGET_KV}`);
console.log(`Vectorize index ready: ${VECTORIZE_INDEX}`);
console.log(`Generated Wrangler config: ${path.relative(process.cwd(), GENERATED_CONFIG_PATH)}`);

function envValue(name) {
  return String(process.env[name] || '').trim();
}

async function verifyToken() {
  const data = await cloudflare('/user/tokens/verify');
  if (!data.success || data.result?.status !== 'active') {
    throw new Error('Cloudflare API token is not active');
  }
}

async function ensureD1Database(databaseName) {
  const existing = await listD1Databases();
  const found = existing.find((database) => database.name === databaseName);
  if (found) return { ...found, created: false };

  const created = await cloudflare(`/accounts/${ACCOUNT_ID}/d1/database`, {
    method: 'POST',
    body: JSON.stringify({ name: databaseName }),
  });
  if (!created.success) throw new Error(`Failed to create D1 database ${databaseName}`);
  return { ...(created.result || {}), created: true };
}

async function listD1Databases() {
  const data = await cloudflare(`/accounts/${ACCOUNT_ID}/d1/database`);
  return Array.isArray(data.result) ? data.result : [];
}

async function ensureKvNamespace(title) {
  const existing = await listKvNamespaces();
  const found = existing.find((namespace) => namespace.title === title);
  if (found) return { ...found, created: false };

  const created = await cloudflare(`/accounts/${ACCOUNT_ID}/storage/kv/namespaces`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  if (!created.success) throw new Error(`Failed to create KV namespace ${title}`);
  return { ...(created.result || {}), created: true };
}

async function listKvNamespaces() {
  const namespaces = [];
  let page = 1;
  while (true) {
    const data = await cloudflare(`/accounts/${ACCOUNT_ID}/storage/kv/namespaces?per_page=100&page=${page}`);
    const batch = Array.isArray(data.result) ? data.result : [];
    namespaces.push(...batch);
    if (!data.result_info || page >= data.result_info.total_pages) break;
    page += 1;
  }
  return namespaces;
}

async function ensureVectorizeIndex(name) {
  const existing = await listVectorizeIndexes();
  const found = existing.find((index) => index.name === name);
  if (found) return { ...found, created: false };

  const created = await cloudflare(`/accounts/${ACCOUNT_ID}/vectorize/v2/indexes`, {
    method: 'POST',
    body: JSON.stringify({
      name,
      config: {
        dimensions: 384,
        metric: 'cosine',
      },
    }),
  });
  if (!created.success) throw new Error(`Failed to create Vectorize index ${name}`);
  return { ...(created.result || {}), created: true };
}

async function listVectorizeIndexes() {
  const data = await cloudflare(`/accounts/${ACCOUNT_ID}/vectorize/v2/indexes`);
  const result = data.result || {};
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.indexes)) return result.indexes;
  return [];
}

async function writeGeneratedConfig({ d1Id, auditKvId, budgetKvId }) {
  if (!d1Id) throw new Error('D1 database id was not returned by Cloudflare');
  if (!auditKvId) throw new Error('Audit KV namespace id was not returned by Cloudflare');
  if (!budgetKvId) throw new Error('Budget KV namespace id was not returned by Cloudflare');

  const raw = await readFile(CONFIG_PATH, 'utf8');
  const generated = raw
    .replace('00000000-0000-0000-0000-000000000000', d1Id)
    .replace('00000000000000000000000000000000', auditKvId)
    .replace('11111111111111111111111111111111', budgetKvId);

  await mkdir(path.dirname(GENERATED_CONFIG_PATH), { recursive: true });
  await writeFile(GENERATED_CONFIG_PATH, generated, 'utf8');
}

async function ensureD1DatabaseWithWrangler(databaseName) {
  const existing = await listJsonWithWrangler(['d1', 'list', '--json']);
  const found = existing.find((database) => database.name === databaseName);
  if (found) return { ...found, created: false };

  await wrangler(['d1', 'create', databaseName]);
  const updated = await listJsonWithWrangler(['d1', 'list', '--json']);
  const created = updated.find((database) => database.name === databaseName);
  if (!created) throw new Error(`Failed to create D1 database ${databaseName}`);
  return { ...created, created: true };
}

async function ensureKvNamespaceWithWrangler(title) {
  const existing = await listJsonWithWrangler(['kv', 'namespace', 'list']);
  const found = existing.find((namespace) => namespace.title === title);
  if (found) return { ...found, created: false };

  await wrangler(['kv', 'namespace', 'create', title]);
  const updated = await listJsonWithWrangler(['kv', 'namespace', 'list']);
  const created = updated.find((namespace) => namespace.title === title);
  if (!created) throw new Error(`Failed to create KV namespace ${title}`);
  return { ...created, created: true };
}

async function ensureVectorizeIndexWithWrangler(name) {
  const existing = await listJsonWithWrangler(['vectorize', 'list', '--json']);
  const found = existing.find((index) => index.name === name);
  if (found) return { ...found, created: false };

  await wrangler(['vectorize', 'create', name, '--dimensions', '384', '--metric', 'cosine']);
  const updated = await listJsonWithWrangler(['vectorize', 'list', '--json']);
  const created = updated.find((index) => index.name === name);
  if (!created) throw new Error(`Failed to create Vectorize index ${name}`);
  return { ...created, created: true };
}

async function ensurePagesProjectWithWrangler(projectName) {
  const existing = await listJsonWithWrangler(['pages', 'project', 'list', '--json']);
  const found = existing.find((project) =>
    project.name === projectName ||
    project.project_name === projectName ||
    project['Project Name'] === projectName
  );
  if (found) return { ...found, created: false };

  await wrangler(['pages', 'project', 'create', projectName, '--production-branch', 'main']);
  return { name: projectName, created: true };
}

async function listJsonWithWrangler(args) {
  const { stdout } = await wrangler(args);
  const json = extractJson(stdout);
  const parsed = JSON.parse(json);
  return Array.isArray(parsed) ? parsed : [];
}

async function wrangler(args) {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npx';
  const commandArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', ['npx', 'wrangler', ...args].map(quoteCmdArg).join(' ')]
    : ['wrangler', ...args];
  const result = await execFileAsync(command, commandArgs, {
    cwd: WORKER_DIR,
    env: process.env,
    maxBuffer: 1024 * 1024 * 10,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

function quoteCmdArg(value) {
  const raw = String(value);
  if (/^[A-Za-z0-9_./:=@-]+$/.test(raw)) return raw;
  return `"${raw.replace(/(["^&|<>])/g, '^$1')}"`;
}

function extractJson(output) {
  const text = String(output || '');
  const firstArray = text.indexOf('[');
  const firstObject = text.indexOf('{');
  const starts = [firstArray, firstObject].filter((index) => index >= 0);
  if (!starts.length) throw new Error(`Wrangler did not return JSON: ${text.slice(0, 200)}`);
  const start = Math.min(...starts);
  return text.slice(start).trim();
}

async function cloudflare(resource, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${resource}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const errors = Array.isArray(data.errors) ? data.errors.map((error) => error.message).join('; ') : response.statusText;
    throw new Error(`Cloudflare API ${init.method || 'GET'} ${resource} failed: ${errors}`);
  }
  return data;
}
