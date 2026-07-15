import {
  requestAnswerModels,
  validateAnswerModelListConfig,
  type EvidenceGatewayFailure,
} from '../lib/search-gateway';
import type { Env } from '../lib/types';

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function json(body: unknown, status = 200, retryAfter?: number): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  if (retryAfter) headers.set('Retry-After', String(retryAfter));
  return new Response(JSON.stringify(body), { status, headers });
}

function failureStatus(error: EvidenceGatewayFailure): number {
  if (error.code === 'ANSWER_API_AUTH_ERROR') return 401;
  if (error.code === 'ANSWER_API_RATE_LIMITED' || error.code === 'GATEWAY_RATE_LIMITED') return 429;
  if (error.code === 'ANSWER_API_INVALID_REQUEST' || error.code === 'ANSWER_API_CONFIG_INVALID' ||
      error.code === 'ANSWER_API_KEY_REQUIRED') return 400;
  if (error.code === 'GATEWAY_NOT_CONFIGURED' || error.code === 'GATEWAY_CONFIG_INVALID' ||
      error.code === 'ANSWER_API_UNAVAILABLE') return 503;
  if (error.retryable) return 503;
  return 502;
}

async function boundedJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  const declaredLength = Number.parseInt(req.headers.get('Content-Length') ?? '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > 4096) return null;
  const raw = await req.text();
  if (!raw || raw.length > 4096) return null;
  try { return object(JSON.parse(raw)); } catch { return null; }
}

export async function handleAnswerModels(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required', retryable: false } }, 405);
  }
  const body = await boundedJsonBody(req);
  if (!body || Object.keys(body).some(key => key !== 'api_base_url')) {
    return json({
      error: { code: 'CUSTOM_API_CONFIG_INVALID', message: 'Custom API configuration is invalid.', retryable: false },
    }, 400);
  }
  const validated = validateAnswerModelListConfig(req.headers.get('X-API-Key'), body.api_base_url);
  if (validated.ok === false) {
    return json({
      error: {
        code: validated.code,
        message: validated.code === 'CUSTOM_API_CONFIG_INCOMPLETE'
          ? 'API key and HTTPS base URL are required.'
          : 'Custom API configuration is invalid.',
        retryable: false,
      },
    }, 400);
  }
  const result = await requestAnswerModels(env, validated.config);
  if (result.error) {
    return json({
      error: {
        code: result.error.code,
        message: result.error.message,
        retryable: result.error.retryable,
      },
    }, failureStatus(result.error), result.error.retry_after_seconds);
  }
  return json({ ok: true, models: result.models, zero_persistence: true });
}
