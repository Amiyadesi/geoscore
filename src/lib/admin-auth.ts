import type { Env } from './types';
import { getDomain } from 'tldts';

export const ADMIN_COOKIE = 'gs_admin';
export const ADMIN_SESSION_TTL_SECONDS = 14 * 24 * 60 * 60;

export interface AdminSession {
  login: string;
  iat: number;
  exp: number;
}

type AdminEnv = Partial<Pick<Env,
  | 'ADMIN_SESSION_SECRET'
  | 'ADMIN_GITHUB_LOGINS'
  | 'ADMIN_TOKEN'
  | 'GITHUB_CLIENT_ID'
  | 'GITHUB_CLIENT_SECRET'
  | 'PUBLIC_APP_URL'
  | 'PUBLIC_API_URL'
>>;

const DEFAULT_ADMIN_LOGIN = 'Amiyadesi';
const FALLBACK_APP_URL = 'https://geo.sayori.org';

function base64UrlEncode(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Uint8Array | null {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function hmac(value: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return new Uint8Array(signature);
}

export function adminAllowlist(env: AdminEnv): string[] {
  const configured = (env.ADMIN_GITHUB_LOGINS ?? '')
    .split(',')
    .map(login => login.trim())
    .filter(Boolean);
  const values = configured.length ? configured : [DEFAULT_ADMIN_LOGIN];
  const seen = new Set<string>();
  return values.filter(login => {
    const key = login.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isAllowedAdminLogin(login: string, env: AdminEnv): boolean {
  const normalized = login.trim().toLowerCase();
  return !!normalized && adminAllowlist(env).some(item => item.toLowerCase() === normalized);
}

export function sessionSecret(env: AdminEnv): string | undefined {
  return env.ADMIN_SESSION_SECRET || env.ADMIN_TOKEN || env.GITHUB_CLIENT_SECRET;
}

export function githubOAuthConfigured(env: AdminEnv): boolean {
  return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
}

export async function signAdminSession(session: AdminSession, secret: string): Promise<string> {
  if (!secret) throw new Error('Admin session secret is not configured');
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({
    login: session.login,
    iat: session.iat,
    exp: session.exp,
  })));
  const signature = base64UrlEncode(await hmac(payload, secret));
  return `${payload}.${signature}`;
}

export async function readAdminSession(token: string | null | undefined, secret: string | undefined): Promise<AdminSession | null> {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const payloadBytes = base64UrlDecode(parts[0]);
  const signature = base64UrlDecode(parts[1]);
  if (!payloadBytes || !signature) return null;
  const expected = await hmac(parts[0], secret);
  if (!constantTimeEqual(signature, expected)) return null;

  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(payloadBytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const value = parsed as Record<string, unknown>;
    if (typeof value.login !== 'string' || !value.login.trim()) return null;
    if (!Number.isFinite(value.iat) || !Number.isFinite(value.exp)) return null;
    if (Number(value.exp) <= Math.floor(Date.now() / 1000)) return null;
    return { login: value.login, iat: Number(value.iat), exp: Number(value.exp) };
  } catch {
    return null;
  }
}

export function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    try { return decodeURIComponent(value); } catch { return value; }
  }
  return null;
}

export async function adminSessionFromRequest(req: Request, env: AdminEnv): Promise<AdminSession | null> {
  const token = readCookie(req.headers.get('Cookie'), ADMIN_COOKIE);
  const session = await readAdminSession(token, sessionSecret(env));
  return session && isAllowedAdminLogin(session.login, env) ? session : null;
}

export function publicAppUrl(env: AdminEnv): string {
  return env.PUBLIC_APP_URL || FALLBACK_APP_URL;
}

export function publicApiUrl(env: AdminEnv): string {
  return env.PUBLIC_API_URL || publicAppUrl(env);
}

export function oauthCallbackUrl(env: AdminEnv): string {
  return `${publicApiUrl(env).replace(/\/+$/, '')}/api/admin/github/callback`;
}

function cookieDomain(env: AdminEnv): string | null {
  let hostname = '';
  try { hostname = new URL(publicAppUrl(env)).hostname.toLowerCase(); } catch { return null; }
  if (hostname === 'localhost' || hostname === '127.0.0.1' || /^\d+(?:\.\d+){3}$/.test(hostname)) return null;
  const domain = getDomain(hostname, { allowPrivateDomains: true });
  return domain ? `.${domain}` : null;
}

export function adminCookieHeader(token: string, env: AdminEnv): string {
  const domain = cookieDomain(env);
  return [
    `${ADMIN_COOKIE}=${encodeURIComponent(token)}`,
    `Max-Age=${ADMIN_SESSION_TTL_SECONDS}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    ...(domain ? [`Domain=${domain}`] : []),
  ].join('; ');
}

export function clearAdminCookieHeader(env: AdminEnv): string {
  const domain = cookieDomain(env);
  return [
    `${ADMIN_COOKIE}=`,
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    ...(domain ? [`Domain=${domain}`] : []),
  ].join('; ');
}

export function safeNextUrl(value: string | null | undefined, env: AdminEnv): string {
  const configuredApp = publicAppUrl(env);
  let configuredHost = '';
  try { configuredHost = new URL(configuredApp).hostname.toLowerCase(); } catch { /* use canonical fallback */ }
  const fallbackBase = ['geo.sayori.org', 'geo-api.sayori.org'].includes(configuredHost)
    ? configuredApp.replace(/\/+$/, '')
    : FALLBACK_APP_URL;
  const fallback = `${fallbackBase}/admin.html`;
  if (!value) return fallback;

  let parsed: URL;
  try { parsed = new URL(value, fallback); } catch { return fallback; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return fallback;
  if (parsed.username || parsed.password) return fallback;

  const appHost = new URL(fallback).hostname.toLowerCase();
  const apiHost = 'geo-api.sayori.org';
  const host = parsed.hostname.toLowerCase();
  const local = (host === 'localhost' || host === '127.0.0.1') && parsed.port === '4173';
  if (!local && host !== appHost && host !== apiHost) return fallback;
  if (!local && parsed.protocol !== 'https:') return fallback;
  if (!['/', '/admin', '/admin.html'].includes(parsed.pathname)) return fallback;
  parsed.hash = '';
  return parsed.toString();
}
