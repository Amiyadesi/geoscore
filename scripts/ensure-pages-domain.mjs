import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ACCOUNT_ID = await resolveAccountId();
const API_TOKEN = await resolveApiToken();
const PROJECT_NAME = envValue('GEOSCORE_PAGES_PROJECT') || 'sayori-geoscore';
const DOMAIN = envValue('GEOSCORE_PAGES_DOMAIN') || 'geo.sayori.org';

if (!ACCOUNT_ID || !API_TOKEN) {
  throw new Error('Missing GEOSCORE_CF_ACCOUNT_ID/GEOSCORE_CF_API_TOKEN or CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN');
}

const existing = await listDomains();
const found = existing.find((domain) => domain.name === DOMAIN);
if (found) {
  console.log(`Pages custom domain already exists: ${DOMAIN} (${found.status || 'unknown'})`);
} else {
  await cloudflare(`/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT_NAME}/domains`, {
    method: 'POST',
    body: JSON.stringify({ name: DOMAIN }),
  });
  console.log(`Pages custom domain requested: ${DOMAIN}`);
}

function envValue(name) {
  return String(process.env[name] || '').trim();
}

async function resolveAccountId() {
  const configured = envValue('GEOSCORE_CF_ACCOUNT_ID') || envValue('CLOUDFLARE_ACCOUNT_ID');
  if (configured) return configured;

  const config = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const match = config.match(/"account_id"\s*:\s*"([^"]+)"/);
  return match?.[1] || '';
}

async function resolveApiToken() {
  const configured = envValue('GEOSCORE_CF_API_TOKEN') || envValue('CLOUDFLARE_API_TOKEN');
  if (configured) return configured;

  const candidates = [
    path.join(homedir(), '.wrangler', 'config', 'default.toml'),
    path.join(homedir(), '.config', '.wrangler', 'default.toml'),
  ];
  for (const file of candidates) {
    try {
      const config = await readFile(file, 'utf8');
      const match = config.match(/oauth_token\s*=\s*"([^"]+)"/);
      if (match?.[1]) return match[1];
    } catch {
      // Try the next known Wrangler config location.
    }
  }
  return '';
}

async function listDomains() {
  const data = await cloudflare(`/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT_NAME}/domains`);
  return Array.isArray(data.result) ? data.result : [];
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
