import type { Env } from './types';

const DEFAULT_AUDIT_LIMIT = 8;
const DEFAULT_SEARCH_LIMIT = 60;

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function hourKey(ip: string) {
  return `rl:audit:${ip}:${new Date().toISOString().slice(0, 13)}`;
}
function fingerprintHourKey(fingerprint: string) {
  return `rl:audit:fingerprint:${fingerprint}:${new Date().toISOString().slice(0, 13)}`;
}
function minuteKey(ip: string) {
  return `rl:search:${ip}:${new Date().toISOString().slice(0, 16)}`;
}

export async function auditRateLimit(
  env: Env,
  ip: string,
  fingerprint?: string | null,
): Promise<{ limited: boolean; retryAfter: number }> {
  const limit = positiveInt(env.AUDIT_RATE_LIMIT_PER_HOUR, DEFAULT_AUDIT_LIMIT);
  const keys = [hourKey(ip), ...(fingerprint ? [fingerprintHourKey(fingerprint)] : [])];
  const counts = await Promise.all(keys.map(async key => parseInt((await env.BUDGET_KV.get(key)) ?? '0', 10)));
  if (counts.some(count => count >= limit)) return { limited: true, retryAfter: 3600 };
  await Promise.all(keys.map((key, index) => env.BUDGET_KV.put(key, String(counts[index] + 1), { expirationTtl: 7200 })));
  return { limited: false, retryAfter: 0 };
}

export async function searchRateLimit(
  env: Env,
  ip: string
): Promise<{ limited: boolean }> {
  const limit = positiveInt(env.SEARCH_RATE_LIMIT_PER_MINUTE, DEFAULT_SEARCH_LIMIT);
  const key = minuteKey(ip);
  const count = parseInt((await env.BUDGET_KV.get(key)) ?? '0', 10);
  if (count >= limit) return { limited: true };
  await env.BUDGET_KV.put(key, String(count + 1), { expirationTtl: 120 });
  return { limited: false };
}

export function getClientIp(req: Request): string {
  return (
    req.headers.get('CF-Connecting-IP') ??
    req.headers.get('X-Forwarded-For')?.split(',')[0].trim() ??
    'unknown'
  );
}

export function getBrowserFingerprint(req: Request): string | null {
  const candidate = new URL(req.url).searchParams.get('visitor_id') ?? req.headers.get('X-GeoScore-Visitor');
  return candidate && /^[a-f0-9]{16,64}$/i.test(candidate) ? candidate.toLowerCase() : null;
}
