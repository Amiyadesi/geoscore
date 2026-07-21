import type { Env } from './types';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://geo.sayori.org',
  'https://sayori-geoscore.pages.dev',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];

export const PUBLIC_DOMAIN_ERROR = 'Only public domains are supported';

export function publicAppUrl(env: Env): string {
  return env.PUBLIC_APP_URL || 'https://geo.sayori.org';
}

export function publicApiUrl(env: Env): string {
  return env.PUBLIC_API_URL || publicAppUrl(env);
}

function allowedOrigins(env: Env): Set<string> {
  const configured = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
}

export function corsHeaders(req: Request, env: Env): HeadersInit {
  const requestOrigin = req.headers.get('Origin') || '';
  const allowed = allowedOrigins(env);
  const allowOrigin = allowed.has(requestOrigin) ? requestOrigin : publicAppUrl(env);

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token, X-Project-Token, X-API-Key',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export function withCors(response: Response, req: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(req, env))) {
    headers.set(key, value);
  }
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

export function isAdminRequest(req: Request, env: Env): boolean {
  const expected = env.ADMIN_TOKEN;
  if (!expected) return false;

  const auth = req.headers.get('Authorization') || '';
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1] || '';
  const headerToken = req.headers.get('X-Admin-Token') || '';
  const candidate = bearer || headerToken;

  return !!candidate && timingSafeEqual(candidate, expected);
}

export function requireAdmin(req: Request, env: Env): Response | null {
  if (isAdminRequest(req, env)) return null;
  return jsonError('Admin token required', 401);
}

export function isValidPublicHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (host.length < 3 || host.length > 253) return false;
  if (host.includes('..') || host.startsWith('.') || host.endsWith('.')) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (/[:/?#@[\]]/.test(host)) return false;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) return false;

  const labels = host.split('.');
  if (labels.length < 2) return false;
  const tld = labels[labels.length - 1];
  if (
    ['corp', 'example', 'home', 'internal', 'invalid', 'lan', 'local', 'localdomain', 'onion', 'test'].includes(tld) ||
    host === 'home.arpa' ||
    host.endsWith('.home.arpa')
  ) return false;
  if (!/^(xn--)?(?=[a-z0-9-]{2,63}$)(?=.*[a-z])[a-z0-9-]+$/.test(tld)) return false;
  return labels.every((label) =>
    label.length >= 1 &&
    label.length <= 63 &&
    /^[a-z0-9-]+$/.test(label) &&
    !label.startsWith('-') &&
    !label.endsWith('-')
  );
}

export function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
