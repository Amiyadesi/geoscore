import type { Env } from './types';
import { API_CHAT_MODEL, CF_FAST_CHAT_MODEL, GROQ_CHAT_MODEL, OPENROUTER_CHAT_MODEL } from './ai-models';
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

export function sanitizeLlmProviderError(body: string, secrets: Array<string | undefined>): string {
  let sanitized = body.replace(/[\r\n\t]+/g, ' ').trim();
  for (const secret of secrets) {
    if (secret) sanitized = sanitized.split(secret).join('[redacted]');
  }
  return sanitized.slice(0, 120);
}

/**
 * Stable short hash for a string — used as KV cache key.
 * FNV-1a 32-bit, hex-encoded. Fast, no crypto API needed.
 */
function fnv32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Unified LLM call with automatic fallback + KV response cache.
 *
 * Priority:
 *  1. KV cache (24-hour TTL) — costs zero quota, instant response
 *  2. Cloudflare Workers AI — free tier
 *  3. Generic API_KEY when configured, otherwise Groq or OpenRouter
 *
 * Falls back to one configured external provider on ANY CF AI error.
 * This ensures quota exhaustion, capacity issues, or transient errors
 * never silently kill AI modules when a fallback is available. Only one external
 * provider is selected per call, so an attempted fallback never cascades.
 *
 * Successful responses are cached in AUDIT_KV for 24 h so repeated audits
 * of the same domain don't burn API quota.
 */
export async function callLlm(
  messages: LlmMessage[],
  max_tokens: number,
  env: Env,
  options: LlmOptions = {},
): Promise<string> {
  // ── 0. KV cache check ───────────────────────────────────────────────────────
  // Key: "llm:" + fnv32(serialised messages + max_tokens)
  // 24-hour TTL — safe for keyword/geo insights which are domain-stable
  const mode = options.jsonMode ? 'json-v2' : 'text-v2';
  const cacheOptions = { jsonMode: options.jsonMode, temperature: options.temperature };
  const cacheKey = `llm:${mode}:${fnv32(JSON.stringify(messages) + max_tokens + JSON.stringify(cacheOptions))}`;
  try {
    const cached = await env.AUDIT_KV.get(cacheKey);
    if (cached) return cached;
  } catch { /* non-critical — proceed to live call */ }

  // ── 1. Cloudflare Workers AI ────────────────────────────────────────────────
  const runCfAi = async (jsonMode: boolean): Promise<string> => {
    options.budget?.consume(`workers-ai:${CF_FAST_CHAT_MODEL}`);
    const payload: Record<string, unknown> = {
      messages,
      max_tokens,
    };
    if (jsonMode) {
      payload.response_format = { type: 'json_object' };
    }
    if (options.temperature !== undefined) {
      payload.temperature = options.temperature;
    }
    const result = await env.AI.run(CF_FAST_CHAT_MODEL, {
      ...payload,
    } as Parameters<typeof env.AI.run>[1]);

    if (!result) return '';

    // Defensive handling of various Workers AI response shapes:
    if (typeof result === 'string') return (result as string).trim();
    if (Array.isArray(result)) {
      // In some environments, models can return arrays of completions
      const first: unknown = result[0];
      if (typeof first === 'string') return first.trim();
      if (first && typeof first === 'object') {
        return extractText(first as WorkersAiTextResult).trim();
      }
    }

    return extractText(result as WorkersAiTextResult).trim();
  };

  let cfText = '';
  try {
    cfText = await runCfAi(!!options.jsonMode);
  } catch (error) {
    // Some Workers AI models do not accept response_format even when they can still
    // follow a JSON-only prompt. Retry only for an explicit compatibility rejection;
    // quota, auth, server, and network failures must not consume a duplicate request.
    if (options.jsonMode && isJsonModeCompatibilityError(error)) {
      try {
        cfText = await runCfAi(false);
      } catch {
        cfText = '';
      }
    }
  }

  if (cfText) {
    // Cache and return CF AI result
    try { await env.AUDIT_KV.put(cacheKey, cfText, { expirationTtl: 86400 }); } catch { /* non-critical */ }
    return cfText;
  }

  // ── 2. One external fallback ───────────────────────────────────────────────
  const external: {
    id: 'api' | 'groq' | 'openrouter';
    name: 'API' | 'Groq' | 'OpenRouter';
    endpoint: string;
    key: string;
    model: string;
    headers: Record<string, string>;
  } | null = env.API_KEY
    ? {
        id: 'api',
        name: 'API',
        endpoint: 'https://opencode.ai/zen/v1/chat/completions',
        key: env.API_KEY,
        model: API_CHAT_MODEL,
        headers: {},
      }
    : env.GROQ_API_KEY
    ? {
        id: 'groq',
        name: 'Groq',
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        key: env.GROQ_API_KEY,
        model: GROQ_CHAT_MODEL,
        headers: {},
      }
    : env.OPENROUTER_API_KEY
      ? {
          id: 'openrouter',
          name: 'OpenRouter',
          endpoint: 'https://openrouter.ai/api/v1/chat/completions',
          key: env.OPENROUTER_API_KEY,
          model: OPENROUTER_CHAT_MODEL,
          headers: {
            'HTTP-Referer': env.PUBLIC_APP_URL,
            'X-Title': 'Sayori GeoScore',
          },
        }
      : null;

  if (!external) {
    throw new Error('CF AI unavailable — set API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY for an optional fallback');
  }

  const runExternal = async (jsonMode: boolean): Promise<string> => {
    options.budget?.consume(`${external.id}:${external.model}`);
    const res = await fetch(external.endpoint, {
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

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const detail = sanitizeLlmProviderError(body, [env.API_KEY, env.GROQ_API_KEY, env.OPENROUTER_API_KEY]);
      throw new ExternalLlmProviderError(
        `${external.name} ${res.status}: ${detail || 'upstream request failed'}`,
        jsonMode
          && (res.status === 400 || res.status === 422)
          && /response[_ -]?format|json[_ -]?mode|json object|structured output/i.test(detail),
      );
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return (data.choices?.[0]?.message?.content ?? '').trim();
  };

  let externalText = '';
  try {
    externalText = await runExternal(!!options.jsonMode);
  } catch (err) {
    // OpenAI-compatible free models may reject response_format. Retry once without it.
    if (options.jsonMode && err instanceof ExternalLlmProviderError && err.retryWithoutJson) {
      try {
        externalText = await runExternal(false);
      } catch (retryError) {
        throw retryError;
      }
    } else {
      throw err;
    }
  }

  if (externalText) {
    try { await env.AUDIT_KV.put(cacheKey, externalText, { expirationTtl: 86400 }); } catch { /* non-critical */ }
  }
  return externalText;
}
