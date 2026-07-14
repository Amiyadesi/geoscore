import type { Env } from './types';
import { CF_FAST_CHAT_MODEL, GROQ_CHAT_MODEL, OPENROUTER_CHAT_MODEL } from './ai-models';
import { fetchWithTimeout } from './http';
import type { SubrequestBudgetLike } from './subrequest-budget';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmOptions {
  jsonMode?: boolean;
  temperature?: number;
  budget?: SubrequestBudgetLike;
}

interface WorkersAiTextResult {
  response?: string;
  text?: string;
  result?: {
    response?: string;
    text?: string;
  };
}

type ExternalProviderId = 'api' | 'groq' | 'openrouter';
type CircuitReason = 'auth' | 'quota' | 'server' | 'network';

interface ExternalProvider {
  id: ExternalProviderId;
  endpoint: string;
  key: string;
  model: string;
  headers: Record<string, string>;
}

interface CircuitState {
  reason: CircuitReason;
  until: number;
}

const CIRCUIT_TTL: Record<CircuitReason, number> = {
  auth: 60 * 60,
  quota: 5 * 60,
  server: 2 * 60,
  network: 60,
};

const EXTERNAL_LLM_TIMEOUT_MS = 12_000;

function extractText(result: WorkersAiTextResult): string {
  return result.response ?? result.text ?? result.result?.response ?? result.result?.text ?? '';
}

class ExternalLlmProviderError extends Error {
  constructor(message: string, readonly retryWithoutJson: boolean) {
    super(message);
    this.name = 'ExternalLlmProviderError';
  }
}

function isJsonModeCompatibilityError(error: unknown): boolean {
  const record = error && typeof error === 'object'
    ? error as Record<string, unknown>
    : null;
  const rawStatus = record?.status ?? record?.statusCode ?? record?.httpStatus;
  const numericStatus = typeof rawStatus === 'number'
    ? rawStatus
    : typeof rawStatus === 'string'
      ? Number(rawStatus)
      : null;
  const message = String(record?.message ?? error ?? '');
  const messageStatus = message.match(/(?:http\s*)?\b(400|422)\b/i)?.[1];
  const status = numericStatus ?? (messageStatus ? Number(messageStatus) : null);
  return (status === 400 || status === 422)
    && /response[_ -]?format|json[_ -]?mode|json object/i.test(message);
}

function providerIdentityTokens(endpoint: string): string[] {
  try {
    const ignored = new Set(['api', 'www', 'com', 'net', 'org', 'ai', 'cloud', 'v1']);
    return [...new Set(new URL(endpoint).hostname.toLowerCase().split('.'))]
      .filter(token => token.length >= 4 && !ignored.has(token));
  } catch {
    return [];
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sanitizeLlmProviderError(
  body: string,
  secrets: Array<string | undefined>,
  providerTokens: string[] = [],
): string {
  let sanitized = body.replace(/[\r\n\t]+/g, ' ').trim();
  for (const secret of secrets) {
    if (secret) sanitized = sanitized.split(secret).join('[redacted]');
  }
  // Upstreams sometimes echo their own product name or endpoint in an error
  // body. Public audit responses must stay provider-neutral even after the
  // secret itself has been removed.
  sanitized = sanitized.replace(/\b(?:groq|openrouter|openai|anthropic)\b/gi, '[provider]');
  for (const token of providerTokens) {
    sanitized = sanitized.replace(new RegExp(`\\b${escapeRegExp(token)}\\b`, 'gi'), '[provider]');
  }
  return sanitized.slice(0, 120);
}

/** Stable FNV-1a hash used for cache keys and deterministic provider choice. */
function fnv32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function genericEndpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
}

function circuitKey(provider: ExternalProviderId): string {
  return `llm:circuit:v1:${provider}`;
}

async function circuitIsOpen(env: Env, provider: ExternalProviderId): Promise<boolean> {
  try {
    const raw = await env.AUDIT_KV.get(circuitKey(provider));
    if (!raw) return false;
    const state = JSON.parse(raw) as Partial<CircuitState>;
    return typeof state.until === 'number' && state.until > Date.now();
  } catch {
    // KV health data must never make the AI path unavailable.
    return false;
  }
}

function retryAfterSeconds(headers: Headers): number | null {
  const raw = headers.get('Retry-After');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds);
  const date = Date.parse(raw);
  if (!Number.isFinite(date)) return null;
  return Math.max(1, Math.ceil((date - Date.now()) / 1000));
}

function circuitForStatus(status: number, headers: Headers): { reason: CircuitReason; ttl: number } | null {
  if (status === 401 || status === 403) return { reason: 'auth', ttl: CIRCUIT_TTL.auth };
  if (status === 429) {
    const requested = retryAfterSeconds(headers) ?? CIRCUIT_TTL.quota;
    return { reason: 'quota', ttl: Math.max(30, Math.min(requested, 60 * 60)) };
  }
  if (status >= 500) return { reason: 'server', ttl: CIRCUIT_TTL.server };
  return null;
}

async function openCircuit(
  env: Env,
  provider: ExternalProviderId,
  reason: CircuitReason,
  ttl = CIRCUIT_TTL[reason],
): Promise<void> {
  const state: CircuitState = { reason, until: Date.now() + ttl * 1000 };
  try {
    await env.AUDIT_KV.put(circuitKey(provider), JSON.stringify(state), { expirationTtl: ttl });
  } catch {
    // A failed health write must not replace the real provider error.
  }
}

async function closeCircuit(env: Env, provider: ExternalProviderId): Promise<void> {
  try {
    await env.AUDIT_KV.delete(circuitKey(provider));
  } catch {
    // Best effort. A successful response remains authoritative.
  }
}

function configuredPair(env: Env): ExternalProvider[] {
  const providers: ExternalProvider[] = [];
  const apiKey = env.API_KEY?.trim();
  const apiBaseUrl = env.API_BASE_URL?.trim();
  const apiModel = env.API_MODEL?.trim();
  if (apiKey && apiBaseUrl && apiModel) {
    providers.push({
      id: 'api',
      endpoint: genericEndpoint(apiBaseUrl),
      key: apiKey,
      model: apiModel,
      headers: {},
    });
  }
  if (env.GROQ_API_KEY?.trim()) {
    providers.push({
      id: 'groq',
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      key: env.GROQ_API_KEY.trim(),
      model: GROQ_CHAT_MODEL,
      headers: {},
    });
  }
  return providers;
}

function openRouterProvider(env: Env): ExternalProvider | null {
  if (!env.OPENROUTER_API_KEY?.trim()) return null;
  return {
    id: 'openrouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    key: env.OPENROUTER_API_KEY.trim(),
    model: OPENROUTER_CHAT_MODEL,
    headers: {
      'HTTP-Referer': env.PUBLIC_APP_URL,
      'X-Title': 'Sayori GeoScore',
    },
  };
}

async function selectExternalProvider(env: Env, routingKey: string): Promise<ExternalProvider | null> {
  const pair = configuredPair(env);
  const health = await Promise.all(pair.map(async provider => ({
    provider,
    open: await circuitIsOpen(env, provider.id),
  })));
  const healthyPair = health.filter(item => !item.open).map(item => item.provider);
  if (healthyPair.length) {
    const hash = Number.parseInt(fnv32(routingKey), 16) >>> 0;
    return healthyPair[hash % healthyPair.length];
  }

  // OpenRouter is a reserve only. It cannot compete with a healthy API/Groq pair.
  const reserve = openRouterProvider(env);
  if (reserve && !(await circuitIsOpen(env, reserve.id))) return reserve;
  return null;
}

/**
 * Unified LLM call. Cache -> Workers AI -> exactly one healthy external endpoint.
 * External failures open a short KV circuit for later requests; the current call
 * never cascades to a second provider.
 */
export async function callLlm(
  messages: LlmMessage[],
  max_tokens: number,
  env: Env,
  options: LlmOptions = {},
): Promise<string> {
  const mode = options.jsonMode ? 'json-v3' : 'text-v3';
  const cacheOptions = { jsonMode: options.jsonMode, temperature: options.temperature };
  const routingKey = JSON.stringify(messages) + max_tokens + JSON.stringify(cacheOptions);
  const cacheKey = `llm:${mode}:${fnv32(routingKey)}`;
  try {
    const cached = await env.AUDIT_KV.get(cacheKey);
    if (cached) return cached;
  } catch {
    // Response caching is optional.
  }

  const runCfAi = async (jsonMode: boolean): Promise<string> => {
    options.budget?.consume(`workers-ai:${CF_FAST_CHAT_MODEL}`);
    const payload: Record<string, unknown> = { messages, max_tokens };
    if (jsonMode) payload.response_format = { type: 'json_object' };
    if (options.temperature !== undefined) payload.temperature = options.temperature;
    const result: unknown = await env.AI.run(CF_FAST_CHAT_MODEL, {
      ...payload,
    } as Parameters<typeof env.AI.run>[1]);

    if (!result) return '';
    if (typeof result === 'string') return result.trim();
    if (Array.isArray(result)) {
      const first: unknown = result[0];
      if (typeof first === 'string') return first.trim();
      if (first && typeof first === 'object') return extractText(first as WorkersAiTextResult).trim();
    }
    return extractText(result as WorkersAiTextResult).trim();
  };

  let cfText = '';
  try {
    cfText = await runCfAi(!!options.jsonMode);
  } catch (error) {
    if (options.jsonMode && isJsonModeCompatibilityError(error)) {
      try {
        cfText = await runCfAi(false);
      } catch {
        cfText = '';
      }
    }
  }

  if (cfText) {
    try { await env.AUDIT_KV.put(cacheKey, cfText, { expirationTtl: 86400 }); } catch { /* optional */ }
    return cfText;
  }

  const external = await selectExternalProvider(env, routingKey);
  if (!external) {
    throw new Error('AI temporarily unavailable; no healthy external API is configured.');
  }

  const secrets = [env.API_KEY, env.GROQ_API_KEY, env.OPENROUTER_API_KEY];
  const providerTokens = providerIdentityTokens(external.endpoint);
  const runExternal = async (jsonMode: boolean): Promise<string> => {
    options.budget?.consume('external-ai');
    let res: Response;
    try {
      res = await fetchWithTimeout(external.endpoint, {
        timeoutMs: EXTERNAL_LLM_TIMEOUT_MS,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${external.key}`,
          'Content-Type': 'application/json',
          ...external.headers,
        },
        body: JSON.stringify({
          model: external.model,
          messages,
          max_tokens,
          temperature: options.temperature ?? 0.3,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
      });
    } catch (error) {
      await openCircuit(env, external.id, 'network');
      const detail = sanitizeLlmProviderError(String(error), secrets, providerTokens);
      throw new ExternalLlmProviderError(`External API network error: ${detail || 'request failed'}`, false);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const detail = sanitizeLlmProviderError(body, secrets, providerTokens);
      const circuit = circuitForStatus(res.status, res.headers);
      if (circuit) await openCircuit(env, external.id, circuit.reason, circuit.ttl);
      throw new ExternalLlmProviderError(
        `External API ${res.status}: ${detail || 'upstream request failed'}`,
        jsonMode
          && (res.status === 400 || res.status === 422)
          && /response[_ -]?format|json[_ -]?mode|json object|structured output/i.test(detail),
      );
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string }; text?: string }>;
    };
    const text = (data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? '').trim();
    if (!text) {
      await openCircuit(env, external.id, 'server');
      throw new ExternalLlmProviderError('External API returned an empty response', false);
    }
    await closeCircuit(env, external.id);
    return text;
  };

  let externalText: string;
  try {
    externalText = await runExternal(!!options.jsonMode);
  } catch (error) {
    if (options.jsonMode && error instanceof ExternalLlmProviderError && error.retryWithoutJson) {
      externalText = await runExternal(false);
    } else {
      throw error;
    }
  }

  try { await env.AUDIT_KV.put(cacheKey, externalText, { expirationTtl: 86400 }); } catch { /* optional */ }
  return externalText;
}
