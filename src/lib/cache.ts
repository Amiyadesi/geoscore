import type { Env } from './types';

/**
 * Increment CACHE_VERSION whenever vertical-detection logic changes.
 * This automatically invalidates all cached audits on the next deploy —
 * every cached key becomes a different string so old entries are ignored
 * and expire naturally (KV TTL) without needing a manual flush.
 */
const CACHE_VERSION = 'v15';

export interface AuditCacheScope {
  mode?: 'site' | 'url';
  targetUrl?: string | null;
  archetypeHint?: string | null;
}

function stableCacheHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return `${value.length.toString(36)}-${hash.toString(36)}`;
}

export function cacheKey(domain: string, scope: AuditCacheScope = {}): string {
  const mode = scope.mode ?? 'site';
  const target = scope.targetUrl ? stableCacheHash(scope.targetUrl) : '-';
  const hint = scope.archetypeHint ?? '-';
  return `recent:${CACHE_VERSION}:${domain}:${mode}:${target}:${hint}`;
}

export async function getCachedAudit(env: Env, domain: string, scope: AuditCacheScope = {}): Promise<string | null> {
  const auditId = await env.AUDIT_KV.get(cacheKey(domain, scope));
  if (!auditId) return null;
  const row = await env.DB.prepare(
    'SELECT full_json FROM audits WHERE id = ? AND status = ?'
  ).bind(auditId, 'complete').first<{ full_json: string }>();
  return row?.full_json ?? null;
}

export async function setCachedAudit(
  env: Env,
  domain: string,
  auditId: string,
  ttlSeconds = 60 * 60 * 24 * 3, // 3 days — reduced from 7 to limit stale-vertical window
  scope: AuditCacheScope = {},
): Promise<void> {
  await env.AUDIT_KV.put(cacheKey(domain, scope), auditId, { expirationTtl: ttlSeconds });
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
