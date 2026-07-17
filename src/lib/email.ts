import { isValidHttpUrl } from './http';
import type { Env } from './types';

export interface EmailDeliveryDiagnostic {
  channel: 'primary' | 'fallback';
  error_code: string;
  status: number | null;
}

export interface EmailDeliveryResult {
  ok: boolean;
  error_code: string | null;
  retryable: boolean;
  channel: 'primary' | 'fallback' | null;
  diagnostics: EmailDeliveryDiagnostic[];
}

interface DeliveryAttempt {
  result: EmailDeliveryResult;
  fallbackEligible: boolean;
}

const EMAIL_TIMEOUT_MS = 12_000;

function result(
  ok: boolean,
  errorCode: string | null,
  retryable: boolean,
  channel: 'primary' | 'fallback' | null,
  diagnostics: EmailDeliveryDiagnostic[] = [],
): EmailDeliveryResult {
  return { ok, error_code: errorCode, retryable, channel, diagnostics };
}

function diagnostic(
  channel: 'primary' | 'fallback',
  errorCode: string,
  status: number | null,
): EmailDeliveryDiagnostic {
  return { channel, error_code: errorCode, status };
}

function classifyFailure(
  channel: 'primary' | 'fallback',
  status: number | null,
): DeliveryAttempt {
  if (status === 401 || status === 403) {
    const errorCode = 'EMAIL_PROVIDER_AUTH_FAILED';
    return { result: result(false, errorCode, false, channel, [diagnostic(channel, errorCode, status)]), fallbackEligible: true };
  }
  if (status === 429) {
    const errorCode = 'EMAIL_PROVIDER_RATE_LIMITED';
    return { result: result(false, errorCode, true, channel, [diagnostic(channel, errorCode, status)]), fallbackEligible: true };
  }
  if (status === null || status >= 500) {
    const errorCode = 'EMAIL_PROVIDER_UNAVAILABLE';
    return { result: result(false, errorCode, true, channel, [diagnostic(channel, errorCode, status)]), fallbackEligible: true };
  }
  const errorCode = 'EMAIL_SEND_REJECTED';
  return { result: result(false, errorCode, false, channel, [diagnostic(channel, errorCode, status)]), fallbackEligible: false };
}

async function request(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMAIL_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, redirect: 'error', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function sendPrimary(
  env: Env,
  to: string,
  subject: string,
  html: string,
  idempotencyKey?: string,
): Promise<DeliveryAttempt> {
  try {
    const headers = new Headers({
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    });
    if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
    const response = await request('https://api.resend.com/emails', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from: env.RESEND_FROM || 'Sayori GeoScore <alerts@sayori.org>',
        to: [to],
        subject,
        html,
      }),
    });
    if (response.ok) return { result: result(true, null, false, 'primary'), fallbackEligible: false };
    return classifyFailure('primary', response.status);
  } catch {
    return classifyFailure('primary', null);
  }
}

function fallbackEndpoint(rawBaseUrl: string | undefined): string | null {
  const value = String(rawBaseUrl || '').trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !isValidHttpUrl(url.href)) return null;
    url.search = '';
    url.hash = '';
    const pathname = url.pathname
      .replace(/\/(?:v1\/messages|v1)\/?$/i, '')
      .replace(/\/+$/, '');
    return `${url.origin}${pathname}/v1/messages`;
  } catch {
    return null;
  }
}

async function sendFallback(
  env: Env,
  to: string,
  subject: string,
  html: string,
): Promise<DeliveryAttempt> {
  const endpoint = fallbackEndpoint(env.CF_TEMP_MAIL_BASE_URL);
  if (!endpoint || !env.CF_TEMP_MAIL_SEND_API_KEY) {
    const errorCode = endpoint || env.CF_TEMP_MAIL_SEND_API_KEY
      ? 'EMAIL_PROVIDER_CONFIG_INVALID'
      : 'EMAIL_PROVIDER_NOT_CONFIGURED';
    return {
      result: result(false, errorCode, false, 'fallback', [diagnostic('fallback', errorCode, null)]),
      fallbackEligible: false,
    };
  }
  try {
    const response = await request(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CF_TEMP_MAIL_SEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, subject, html }),
    });
    if (response.ok) return { result: result(true, null, false, 'fallback'), fallbackEligible: false };
    return classifyFailure('fallback', response.status);
  } catch {
    return classifyFailure('fallback', null);
  }
}

export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  html: string,
  idempotencyKey?: string,
): Promise<EmailDeliveryResult> {
  const hasPrimary = Boolean(env.RESEND_API_KEY);
  const hasFallback = Boolean(env.CF_TEMP_MAIL_BASE_URL || env.CF_TEMP_MAIL_SEND_API_KEY);
  if (!hasPrimary && !hasFallback) {
    return result(false, 'EMAIL_PROVIDER_NOT_CONFIGURED', false, null);
  }

  if (!hasPrimary) return (await sendFallback(env, to, subject, html)).result;

  const primary = await sendPrimary(env, to, subject, html, idempotencyKey);
  if (primary.result.ok || !primary.fallbackEligible || !hasFallback) return primary.result;

  const fallback = await sendFallback(env, to, subject, html);
  return {
    ...fallback.result,
    diagnostics: [...primary.result.diagnostics, ...fallback.result.diagnostics],
  };
}

export const emailInternals = Object.freeze({ fallbackEndpoint });
