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
function minuteKey(ip: string) {
  return `rl:search:${ip}:${new Date().toISOString().slice(0, 16)}`;
}

export async function auditRateLimit(
  env: Env,
  ip: string
): Promise<{ limited: boolean; retryAfter: number }> {
  const limit = positiveInt(env.AUDIT_RATE_LIMIT_PER_HOUR, DEFAULT_AUDIT_LIMIT);
  const key = hourKey(ip);
  const count = parseInt((await env.BUDGET_KV.get(key)) ?? '0', 10);
  if (count >= limit) return { limited: true, retryAfter: 3600 };
  await env.BUDGET_KV.put(key, String(count + 1), { expirationTtl: 7200 });
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
