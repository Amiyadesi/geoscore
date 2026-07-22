import type { Env } from './types';
import type { AuditCheckpoint } from './audit-checkpoint';

/**
 * Increment CACHE_VERSION whenever vertical-detection logic changes.
 * This automatically invalidates all cached audits on the next deploy —
 * every cached key becomes a different string so old entries are ignored
 * and expire naturally (KV TTL) without needing a manual flush.
 */
export const CACHE_VERSION = 'v28';

export interface AuditCacheScope {
  mode?: 'site' | 'url';
  targetUrl?: string | null;
  archetypeHint?: string | null;
}

export function partialCacheKey(domain: string, scope: AuditCacheScope = {}): string {
  return `partial:${cacheKey(domain, scope)}`;
}

export async function getPartialAudit(
  env: Env,
  domain: string,
  scope: AuditCacheScope = {},
): Promise<AuditCheckpoint | null> {
  const raw = await env.AUDIT_KV.get(partialCacheKey(domain, scope));
  if (!raw) return null;
  try {
    const checkpoint = JSON.parse(raw) as AuditCheckpoint;
    if (!checkpoint || checkpoint.version !== 1 || !Number.isFinite(checkpoint.expires_at) || checkpoint.expires_at <= Date.now()) {
      await env.AUDIT_KV.delete(partialCacheKey(domain, scope));
      return null;
    }
    return checkpoint;
  } catch {
    await env.AUDIT_KV.delete(partialCacheKey(domain, scope));
    return null;
  }
}

export async function setPartialAudit(
  env: Env,
  domain: string,
  scope: AuditCacheScope,
  checkpoint: AuditCheckpoint,
): Promise<void> {
  await env.AUDIT_KV.put(partialCacheKey(domain, scope), JSON.stringify(checkpoint), {
    expirationTtl: checkpoint.expires_at > Date.now()
      ? Math.max(60, Math.ceil((checkpoint.expires_at - Date.now()) / 1000))
      : 60,
  });
}

export async function clearPartialAudit(env: Env, domain: string, scope: AuditCacheScope): Promise<void> {
  await env.AUDIT_KV.delete(partialCacheKey(domain, scope));
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
