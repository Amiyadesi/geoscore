import type { Env } from './types';
import { fetchWithTimeout, isValidHttpUrl } from './http';
import { isValidPublicHostname } from './security';
import type {
  AnswerSnapshot,
  AnswerSnapshotObservation,
  EvidenceError,
  EvidenceProviderRun,
  EvidenceQueryPlan,
  EvidenceSearchResult,
  EvidenceSearchSnapshot,
  EvidenceUsage,
} from './query-evidence';

export interface SearchGatewayResult {
  title: string;
  url: string;
  snippet: string;
}

interface SearchGatewayResponse {
  success?: boolean;
  provider?: string;
  results?: Array<{
    title?: unknown;
    url?: unknown;
    snippet?: unknown;
    content?: unknown;
  }>;
}

export type EvidenceGatewayStatus = 'complete' | 'partial' | 'unavailable' | 'error';

export interface EvidenceGatewayFailure {
  code:
    | 'GATEWAY_NOT_CONFIGURED'
    | 'GATEWAY_CONFIG_INVALID'
    | 'GATEWAY_AUTH_ERROR'
    | 'GATEWAY_RATE_LIMITED'
    | 'GATEWAY_TIMEOUT'
    | 'GATEWAY_UPSTREAM_ERROR'
    | 'GATEWAY_REQUEST_REJECTED'
    | 'GATEWAY_INVALID_RESPONSE'
    | 'ANSWER_API_AUTH_ERROR'
    | 'ANSWER_API_RATE_LIMITED'
    | 'ANSWER_API_TIMEOUT'
    | 'ANSWER_API_UPSTREAM_ERROR'
    | 'ANSWER_API_NETWORK_ERROR'
    | 'ANSWER_API_INVALID_REQUEST'
    | 'ANSWER_API_CONFIG_INVALID'
    | 'ANSWER_API_KEY_REQUIRED'
    | 'ANSWER_API_UNAVAILABLE'
    | 'ANSWER_API_MALFORMED_RESPONSE';
  retryable: boolean;
  message: string;
  retry_after_seconds?: number;
}

export interface EvidenceGatewayResult {
  status: EvidenceGatewayStatus;
  snapshot: EvidenceSearchSnapshot | null;
  error: EvidenceGatewayFailure | null;
}

export interface EvidenceSearchRequestOptions {
  maxResults?: number;
  maxProviderCalls?: number;
  maxExtractPages?: number;
  timeoutMs?: number;
}

export interface AnswerGatewayResult {
  status: EvidenceGatewayStatus;
  snapshot: AnswerSnapshot | null;
  error: EvidenceGatewayFailure | null;
}

export interface RequestScopedAnswerConfig {
  apiKey: string;
  apiBaseUrl: string;
  apiModel: string;
}

export interface AnswerModelListConfig {
  apiKey: string;
  apiBaseUrl: string;
}

export interface AnswerModelListResult {
  status: 'complete' | 'error';
  models: string[];
  error: EvidenceGatewayFailure | null;
}

export type RequestScopedAnswerConfigValidation =
  | { ok: true; config: RequestScopedAnswerConfig | null }
  | { ok: false; code: 'CUSTOM_API_CONFIG_INCOMPLETE' | 'CUSTOM_API_CONFIG_INVALID' };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function redactionValues(secrets: string | string[]): string[] {
  return (Array.isArray(secrets) ? secrets : [secrets]).map(value => value.trim()).filter(Boolean);
}

function redactExact(value: string, secrets: string | string[]): string {
  let redacted = value;
  for (const secret of redactionValues(secrets)) {
    const variants = new Set([secret, encodeURIComponent(secret), encodeURI(secret)]);
    for (const variant of variants) {
      if (variant) redacted = redacted.split(variant).join('[redacted]');
    }
  }
  return redacted;
}

function sensitiveString(value: unknown, maxLength: number, secrets: string | string[]): string {
  return redactExact(string(value, maxLength), secrets);
}

function sensitiveUrl(value: unknown, secrets: string | string[]): string {
  const raw = string(value, 2048);
  if (!raw || redactExact(raw, secrets) !== raw) return '';
  return raw;
}

function normalizeCustomApiBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port ||
        parsed.search || parsed.hash || !isValidPublicHostname(parsed.hostname)) return null;
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function boundedRequestApiKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  return key.length >= 12 && key.length <= 512 && !/[\u0000-\u001f\u007f]/.test(key) ? key : null;
}

function boundedModelId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const model = value.trim();
  return model.length >= 1 && model.length <= 200 && !/[\u0000-\u001f\u007f]/.test(model) ? model : null;
}

export function validateRequestScopedAnswerConfig(
  apiKeyValue: unknown,
  apiBaseUrlValue: unknown,
  apiModelValue: unknown,
  required = false,
): RequestScopedAnswerConfigValidation {
  const supplied = [apiKeyValue, apiBaseUrlValue, apiModelValue]
    .map(value => typeof value === 'string' ? value.trim() : value)
    .map(value => value !== undefined && value !== null && value !== '');
  if (!supplied.some(Boolean)) {
    return required
      ? { ok: false, code: 'CUSTOM_API_CONFIG_INCOMPLETE' }
      : { ok: true, config: null };
  }
  if (!supplied.every(Boolean)) return { ok: false, code: 'CUSTOM_API_CONFIG_INCOMPLETE' };
  const apiKey = boundedRequestApiKey(apiKeyValue);
  const apiBaseUrl = normalizeCustomApiBaseUrl(apiBaseUrlValue);
  const apiModel = boundedModelId(apiModelValue);
  if (!apiKey || !apiBaseUrl || !apiModel) return { ok: false, code: 'CUSTOM_API_CONFIG_INVALID' };
  return { ok: true, config: { apiKey, apiBaseUrl, apiModel } };
}

export function validateAnswerModelListConfig(
  apiKeyValue: unknown,
  apiBaseUrlValue: unknown,
): { ok: true; config: AnswerModelListConfig } |
   { ok: false; code: 'CUSTOM_API_CONFIG_INCOMPLETE' | 'CUSTOM_API_CONFIG_INVALID' } {
  const hasKey = typeof apiKeyValue === 'string' && apiKeyValue.trim() !== '';
  const hasBase = typeof apiBaseUrlValue === 'string' && apiBaseUrlValue.trim() !== '';
  if (!hasKey || !hasBase) return { ok: false, code: 'CUSTOM_API_CONFIG_INCOMPLETE' };
  const apiKey = boundedRequestApiKey(apiKeyValue);
  const apiBaseUrl = normalizeCustomApiBaseUrl(apiBaseUrlValue);
  return apiKey && apiBaseUrl
    ? { ok: true, config: { apiKey, apiBaseUrl } }
    : { ok: false, code: 'CUSTOM_API_CONFIG_INVALID' };
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolean(value: unknown): boolean {
  return value === true;
}

function retryAfterSeconds(response: Response): number | undefined {
  const parsed = Number.parseInt(response.headers.get('Retry-After') ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 86_400) : undefined;
}

function gatewayFailure(response: Response): EvidenceGatewayFailure {
  if (response.status === 401 || response.status === 403) {
    return {
      code: 'GATEWAY_AUTH_ERROR',
      retryable: false,
      message: 'The evidence service rejected its server credential.',
    };
  }
  if (response.status === 429) {
    return {
      code: 'GATEWAY_RATE_LIMITED',
      retryable: true,
      message: 'The evidence service is temporarily rate limited.',
      retry_after_seconds: retryAfterSeconds(response),
    };
  }
  if (response.status >= 500) {
    return {
      code: 'GATEWAY_UPSTREAM_ERROR',
      retryable: true,
      message: 'The evidence service is temporarily unavailable.',
    };
  }
  return {
    code: 'GATEWAY_REQUEST_REJECTED',
    retryable: false,
    message: 'The evidence service rejected the bounded request.',
  };
}

const SAFE_ANSWER_ERROR_CODES = new Set<EvidenceGatewayFailure['code']>([
  'ANSWER_API_AUTH_ERROR',
  'ANSWER_API_RATE_LIMITED',
  'ANSWER_API_TIMEOUT',
  'ANSWER_API_UPSTREAM_ERROR',
  'ANSWER_API_NETWORK_ERROR',
  'ANSWER_API_INVALID_REQUEST',
  'ANSWER_API_CONFIG_INVALID',
  'ANSWER_API_KEY_REQUIRED',
  'ANSWER_API_UNAVAILABLE',
  'ANSWER_API_MALFORMED_RESPONSE',
]);

function answerFailureMessage(code: EvidenceGatewayFailure['code']): string {
  if (code === 'ANSWER_API_AUTH_ERROR') return 'The custom API rejected the submitted key.';
  if (code === 'ANSWER_API_RATE_LIMITED') return 'The custom API is temporarily rate limited.';
  if (code === 'ANSWER_API_TIMEOUT') return 'The custom API request timed out.';
  if (code === 'ANSWER_API_INVALID_REQUEST' || code === 'ANSWER_API_CONFIG_INVALID') {
    return 'The custom API configuration was rejected.';
  }
  if (code === 'ANSWER_API_KEY_REQUIRED') return 'A request-scoped API key is required.';
  if (code === 'ANSWER_API_MALFORMED_RESPONSE') return 'The custom API returned an invalid response.';
  return 'The custom API is temporarily unavailable.';
}

async function readBoundedJson(response: Response, maxBytes = 65_536): Promise<unknown> {
  const length = Number.parseInt(response.headers.get('Content-Length') ?? '', 10);
  if (Number.isFinite(length) && length > maxBytes) return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
}

async function gatewayFailureFromResponse(
  response: Response,
  secrets: string[] = [],
): Promise<EvidenceGatewayFailure> {
  const fallback = gatewayFailure(response);
  const parsed = object(await readBoundedJson(response));
  const detail = object(parsed?.detail);
  const candidate = sensitiveString(parsed?.code, 100, secrets) || sensitiveString(detail?.code, 100, secrets);
  if (!SAFE_ANSWER_ERROR_CODES.has(candidate as EvidenceGatewayFailure['code'])) return fallback;
  const code = candidate as EvidenceGatewayFailure['code'];
  const retryable = typeof parsed?.retryable === 'boolean'
    ? parsed.retryable
    : typeof detail?.retryable === 'boolean' ? detail.retryable : fallback.retryable;
  return {
    code,
    retryable,
    message: answerFailureMessage(code),
    retry_after_seconds: retryAfterSeconds(response),
  };
}

function parseEvidenceError(value: unknown, secrets: string | string[] = ''): EvidenceError | null {
  const item = object(value);
  const code = sensitiveString(item?.code, 100, secrets);
  if (!item || !code) return null;
  const scope = string(item.scope, 30);
  return {
    code,
    scope: scope === 'provider_run' || scope === 'extraction' || scope === 'answer_snapshot' || scope === 'answer_api'
      ? scope
      : 'request',
    retryable: boolean(item.retryable),
    message: sensitiveString(item.message, 500, secrets) || 'Evidence source reported an error.',
    ...(sensitiveString(item.provider, 80, secrets)
      ? { provider: sensitiveString(item.provider, 80, secrets) }
      : {}),
    ...(Number.isInteger(item.query_index) ? { query_index: number(item.query_index) } : {}),
    ...(number(item.retry_after_seconds, 0) > 0
      ? { retry_after_seconds: Math.min(number(item.retry_after_seconds), 86_400) }
      : {}),
  };
}

function parseSearchResult(value: unknown): EvidenceSearchResult | null {
  const item = object(value);
  if (!item) return null;
  const url = string(item.url, 2048);
  const canonicalUrl = string(item.canonical_url, 2048) || url;
  const sourceId = string(item.source_id, 180);
  if (!sourceId || !isValidHttpUrl(url) || !isValidHttpUrl(canonicalUrl)) return null;
  const provider = string(item.provider, 80) || 'unknown';
  const providerRanks = object(item.provider_ranks);
  const parsedRanks: Record<string, number> = {};
  if (providerRanks) {
    for (const [key, value] of Object.entries(providerRanks).slice(0, 10)) {
      const rank = Math.max(1, Math.round(number(value, 1)));
      parsedRanks[string(key, 80) || 'unknown'] = rank;
    }
  }
  const extractStatus = string(item.extract_status, 30);
  return {
    source_id: sourceId,
    query: string(item.query, 500),
    matched_queries: Array.isArray(item.matched_queries)
      ? item.matched_queries.map(value => string(value, 500)).filter(Boolean).slice(0, 3)
      : [],
    provider,
    providers: Array.isArray(item.providers)
      ? item.providers.map(value => string(value, 80)).filter(Boolean).slice(0, 10)
      : [provider],
    provider_rank: Math.max(1, Math.round(number(item.provider_rank, 1))),
    provider_ranks: parsedRanks,
    url,
    canonical_url: canonicalUrl,
    title: string(item.title, 500),
    snippet: string(item.snippet, 2000),
    retrieved_at: string(item.retrieved_at, 50),
    ...(string(item.registrable_domain, 253)
      ? { registrable_domain: string(item.registrable_domain, 253).toLowerCase() }
      : {}),
    fusion_score: number(item.fusion_score),
    rerank_score: item.rerank_score === null || item.rerank_score === undefined
      ? null
      : number(item.rerank_score),
    extract_status: extractStatus === 'complete' || extractStatus === 'blocked' ||
      extractStatus === 'timeout' || extractStatus === 'error'
      ? extractStatus
      : 'not_requested',
    ...(typeof item.content === 'string' ? { content: item.content.slice(0, 20_000) } : {}),
    ...(typeof item.content_hash === 'string'
      ? { content_hash: item.content_hash.slice(0, 180) }
      : item.content_hash === null ? { content_hash: null } : {}),
  };
}

function parseProviderRun(value: unknown): EvidenceProviderRun | null {
  const item = object(value);
  if (!item) return null;
  const provider = string(item.provider, 80);
  const query = string(item.query, 500);
  const status = string(item.status, 30);
  const allowedStatuses = new Set([
    'complete', 'empty', 'timeout', 'auth_error', 'rate_limited',
    'upstream_error', 'invalid_request', 'circuit_open',
  ]);
  if (!provider || !query || !allowedStatuses.has(status)) return null;
  return {
    provider,
    query,
    status: status as EvidenceProviderRun['status'],
    latency_ms: item.latency_ms === null || item.latency_ms === undefined
      ? null
      : Math.max(0, number(item.latency_ms)),
    result_count: Math.max(0, Math.round(number(item.result_count))),
    cache_hit: boolean(item.cache_hit),
    error: parseEvidenceError(item.error),
  };
}

function parseUsage(value: unknown): EvidenceUsage {
  const item = object(value);
  return {
    provider_calls: Math.max(0, Math.round(number(item?.provider_calls))),
    extract_pages: Math.max(0, Math.round(number(item?.extract_pages))),
    cache_hits: Math.max(0, Math.round(number(item?.cache_hits))),
    estimated_credits: item?.estimated_credits === null || item?.estimated_credits === undefined
      ? null
      : Math.max(0, number(item.estimated_credits)),
    elapsed_ms: Math.max(0, number(item?.elapsed_ms)),
  };
}

export function parseEvidenceSearchSnapshot(value: unknown): EvidenceSearchSnapshot | null {
  const root = object(value);
  const queryPlan = object(root?.query_plan);
  const evidenceVersion = string(root?.evidence_version, 50) || string(root?.algorithm_version, 50);
  if (!root || !queryPlan || !evidenceVersion || !Array.isArray(root.results) ||
      !Array.isArray(root.provider_runs) || !Array.isArray(root.errors)) return null;
  const queries = Array.isArray(queryPlan.queries)
    ? queryPlan.queries.map(value => string(value, 500)).filter(Boolean).slice(0, 3)
    : [];
  if (!queries.length) return null;
  const results = root.results.map(parseSearchResult).filter((item): item is EvidenceSearchResult => !!item);
  const providerRuns = root.provider_runs.map(parseProviderRun).filter((item): item is EvidenceProviderRun => !!item);
  const errors = root.errors.map(value => parseEvidenceError(value)).filter((item): item is EvidenceError => !!item);
  return {
    evidence_version: evidenceVersion,
    request_id: string(root.request_id, 180),
    query_plan: {
      queries,
      locale: string(queryPlan.locale, 35) || 'en',
    },
    results,
    provider_runs: providerRuns,
    usage: parseUsage(root.usage),
    partial: boolean(root.partial),
    degraded: boolean(root.degraded),
    errors,
  };
}

function normalizedAnswerStatus(rawStatus: string, error: EvidenceError | null): AnswerSnapshotObservation['status'] | null {
  if (rawStatus === 'complete' || rawStatus === 'empty' || rawStatus === 'timeout' ||
      rawStatus === 'auth_error' || rawStatus === 'rate_limited' || rawStatus === 'upstream_error' ||
      rawStatus === 'invalid_response') return rawStatus;
  if (rawStatus !== 'error') return null;
  const code = error?.code ?? '';
  if (/AUTH/.test(code)) return 'auth_error';
  if (/RATE_LIMIT/.test(code)) return 'rate_limited';
  if (/TIMEOUT/.test(code)) return 'timeout';
  if (/MALFORMED|INVALID_RESPONSE/.test(code)) return 'invalid_response';
  return 'upstream_error';
}

export function parseAnswerSnapshot(
  value: unknown,
  privateValues: string[] = [],
  selectedModel = '',
): AnswerSnapshot | null {
  const root = object(value);
  if (!root || !Array.isArray(root.observations) || !Array.isArray(root.errors)) return null;
  const snapshotVersion = sensitiveString(root.snapshot_version, 50, privateValues);
  if (!snapshotVersion) return null;
  const provenanceRedactions = privateValues.filter(value => value !== selectedModel);
  const rootProvider = sensitiveString(root.api_id, 80, privateValues) || 'api';
  const observations = root.observations.map((value): AnswerSnapshotObservation | null => {
    const item = object(value);
    if (!item) return null;
    const parsedError = parseEvidenceError(item.error, privateValues);
    const query = sensitiveString(item.query, 500, privateValues);
    const status = normalizedAnswerStatus(string(item.status, 30), parsedError);
    if (!query || !status) return null;
    const citations = Array.isArray(item.citations) ? item.citations.map(value => {
      const citation = object(value);
      const url = sensitiveUrl(citation?.url, privateValues);
      if (!citation || !isValidHttpUrl(url)) return null;
      return {
        url,
        title: sensitiveString(citation.title, 500, privateValues),
        ...(sensitiveString(citation.source_id, 180, privateValues)
          ? { source_id: sensitiveString(citation.source_id, 180, privateValues) }
          : {}),
      };
    }).filter((item): item is NonNullable<typeof item> => !!item).slice(0, 20) : [];
    return {
      query,
      status,
      provider: sensitiveString(item.provider, 80, privateValues) ||
        sensitiveString(item.api_id, 80, privateValues) || rootProvider,
      model: sensitiveString(item.model, 200, provenanceRedactions) || selectedModel,
      answer: sensitiveString(item.answer, 20_000, privateValues),
      citations,
      observed_at: sensitiveString(item.observed_at, 50, privateValues),
      latency_ms: item.latency_ms === null || item.latency_ms === undefined
        ? null
        : Math.max(0, number(item.latency_ms)),
      error: parsedError,
    };
  }).filter((item): item is AnswerSnapshotObservation => !!item);
  const usage = object(root.usage);
  const providerUsage = object(usage?.provider_usage);
  const errors = root.errors.map(value => parseEvidenceError(value, privateValues))
    .filter((item): item is EvidenceError => !!item)
    .map(error => ({ ...error, message: sensitiveString(error.message, 500, privateValues) }));
  return {
    snapshot_version: snapshotVersion,
    request_id: sensitiveString(root.request_id, 180, privateValues),
    observations,
    usage: {
      requests: Math.max(0, Math.round(number(usage?.requests ?? usage?.api_calls))),
      input_tokens: usage?.input_tokens === null || usage?.input_tokens === undefined
        ? providerUsage?.input_tokens === null || providerUsage?.input_tokens === undefined
          ? null
          : Math.max(0, Math.round(number(providerUsage.input_tokens)))
        : Math.max(0, Math.round(number(usage.input_tokens))),
      output_tokens: usage?.output_tokens === null || usage?.output_tokens === undefined
        ? providerUsage?.output_tokens === null || providerUsage?.output_tokens === undefined
          ? null
          : Math.max(0, Math.round(number(providerUsage.output_tokens)))
        : Math.max(0, Math.round(number(usage.output_tokens))),
      elapsed_ms: Math.max(0, number(usage?.elapsed_ms)),
    },
    partial: boolean(root.partial),
    degraded: boolean(root.degraded),
    limitations: Array.isArray(root.limitations)
      ? root.limitations.map(value => sensitiveString(value, 1000, privateValues)).filter(Boolean).slice(0, 10)
      : [],
    errors,
  };
}

export async function requestEvidenceSearch(
  env: Env,
  plan: EvidenceQueryPlan,
  options: EvidenceSearchRequestOptions = {},
): Promise<EvidenceGatewayResult> {
  const base = (env.SEARCH_GATEWAY_URL || '').trim().replace(/\/+$/, '');
  const apiKey = (env.SEARCH_GATEWAY_API_KEY || '').trim();
  if (!base || !apiKey) {
    return {
      status: 'unavailable',
      snapshot: null,
      error: {
        code: 'GATEWAY_NOT_CONFIGURED',
        retryable: false,
        message: 'External evidence is not configured for this deployment.',
      },
    };
  }
  if (!isValidHttpUrl(base)) {
    return {
      status: 'error',
      snapshot: null,
      error: {
        code: 'GATEWAY_CONFIG_INVALID',
        retryable: false,
        message: 'External evidence configuration is invalid.',
      },
    };
  }
  const queries = plan.queries.map(item => item.query).slice(0, 3);
  if (!queries.length) {
    return {
      status: 'unavailable',
      snapshot: null,
      error: {
        code: 'GATEWAY_REQUEST_REJECTED',
        retryable: false,
        message: 'No applicable evidence queries were planned.',
      },
    };
  }

  const timeoutMs = Math.min(15_000, Math.max(1_000, options.timeoutMs ?? 12_000));
  const maxProviderCalls = Math.min(2, Math.max(1, options.maxProviderCalls ?? 2));
  const maxExtractPages = Math.min(5, Math.max(0, options.maxExtractPages ?? 5));
  const body = {
    queries,
    locale: plan.locale,
    providers: ['auto'],
    max_results: Math.min(8, Math.max(1, options.maxResults ?? 8)),
    filters: {
      include_domains: [],
      exclude_domains: [],
      freshness: null,
    },
    budget: {
      max_provider_calls: maxProviderCalls,
      max_extract_pages: maxExtractPages,
      timeout_ms: timeoutMs,
    },
  };

  let response: Response;
  try {
    response = await fetchWithTimeout(new URL('/v1/evidence-search', base).toString(), {
      method: 'POST',
      timeoutMs: timeoutMs + 1_000,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const timedOut = name === 'AbortError' || name === 'TimeoutError';
    return {
      status: 'error',
      snapshot: null,
      error: {
        code: timedOut ? 'GATEWAY_TIMEOUT' : 'GATEWAY_UPSTREAM_ERROR',
        retryable: true,
        message: timedOut
          ? 'The evidence service request timed out.'
          : 'The evidence service could not be reached.',
      },
    };
  }
  if (!response.ok) {
    return { status: 'error', snapshot: null, error: gatewayFailure(response) };
  }
  const parsed = await response.json().catch(() => null);
  const snapshot = parseEvidenceSearchSnapshot(parsed);
  if (!snapshot) {
    return {
      status: 'error',
      snapshot: null,
      error: {
        code: 'GATEWAY_INVALID_RESPONSE',
        retryable: false,
        message: 'The evidence service returned an invalid response.',
      },
    };
  }
  return {
    status: snapshot.partial || snapshot.degraded ? 'partial' : 'complete',
    snapshot,
    error: null,
  };
}

export async function requestAnswerSnapshots(
  env: Env,
  plan: EvidenceQueryPlan,
  requestConfig: RequestScopedAnswerConfig | null = null,
  timeoutMs = 12_000,
): Promise<AnswerGatewayResult> {
  const base = (env.SEARCH_GATEWAY_URL || '').trim().replace(/\/+$/, '');
  const gatewayKey = (env.SEARCH_GATEWAY_API_KEY || '').trim();
  const byok = requestConfig?.apiKey ?? '';
  if (!base || !gatewayKey) {
    return {
      status: 'unavailable',
      snapshot: null,
      error: {
        code: 'GATEWAY_NOT_CONFIGURED',
        retryable: false,
        message: 'API answer snapshots are not configured for this deployment.',
      },
    };
  }
  if (!isValidHttpUrl(base)) {
    return {
      status: 'error',
      snapshot: null,
      error: {
        code: 'GATEWAY_CONFIG_INVALID',
        retryable: false,
        message: 'API answer snapshot configuration is invalid.',
      },
    };
  }
  const queries = plan.queries.map(item => item.query).slice(0, 3);
  const boundedTimeout = Math.min(15_000, Math.max(1_000, timeoutMs));
  let response: Response;
  try {
    response = await fetchWithTimeout(new URL('/v1/answer-snapshots', base).toString(), {
      method: 'POST',
      timeoutMs: boundedTimeout + 1_000,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gatewayKey}`,
        'X-API-Key': gatewayKey,
        ...(byok ? { 'X-Answer-API-Key': byok } : {}),
      },
      body: JSON.stringify({
        queries,
        locale: plan.locale,
        ...(requestConfig ? {
          api_base_url: requestConfig.apiBaseUrl,
          api_model: requestConfig.apiModel,
        } : {}),
      }),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const timedOut = name === 'AbortError' || name === 'TimeoutError';
    return {
      status: 'error',
      snapshot: null,
      error: {
        code: timedOut ? 'GATEWAY_TIMEOUT' : 'GATEWAY_UPSTREAM_ERROR',
        retryable: true,
        message: timedOut ? 'The API answer snapshot request timed out.' : 'The API answer snapshot service could not be reached.',
      },
    };
  }
  const privateValues = requestConfig
    ? [requestConfig.apiKey, requestConfig.apiBaseUrl, requestConfig.apiModel]
    : [];
  if (!response.ok) {
    return {
      status: 'error',
      snapshot: null,
      error: await gatewayFailureFromResponse(response, privateValues),
    };
  }
  const parsed = await response.json().catch(() => null);
  const snapshot = parseAnswerSnapshot(parsed, privateValues, requestConfig?.apiModel ?? '');
  if (!snapshot) {
    return {
      status: 'error',
      snapshot: null,
      error: {
        code: 'GATEWAY_INVALID_RESPONSE',
        retryable: false,
        message: 'The API answer snapshot service returned an invalid response.',
      },
    };
  }
  return {
    status: snapshot.partial || snapshot.degraded ? 'partial' : 'complete',
    snapshot,
    error: null,
  };
}

function parseAnswerModelIds(value: unknown, privateValues: string[]): string[] | null {
  const root = object(value);
  if (!root || !Array.isArray(root.models)) return null;
  const models: string[] = [];
  for (const value of root.models.slice(0, 100)) {
    const model = boundedModelId(value);
    if (!model || redactExact(model, privateValues) !== model || models.includes(model)) continue;
    models.push(model);
  }
  return models;
}

export async function requestAnswerModels(
  env: Env,
  config: AnswerModelListConfig,
  timeoutMs = 10_000,
): Promise<AnswerModelListResult> {
  const base = (env.SEARCH_GATEWAY_URL || '').trim().replace(/\/+$/, '');
  const gatewayKey = (env.SEARCH_GATEWAY_API_KEY || '').trim();
  if (!base || !gatewayKey) {
    return {
      status: 'error',
      models: [],
      error: {
        code: 'GATEWAY_NOT_CONFIGURED',
        retryable: false,
        message: 'API model discovery is not configured for this deployment.',
      },
    };
  }
  if (!isValidHttpUrl(base)) {
    return {
      status: 'error',
      models: [],
      error: {
        code: 'GATEWAY_CONFIG_INVALID',
        retryable: false,
        message: 'API model discovery configuration is invalid.',
      },
    };
  }
  const boundedTimeout = Math.min(12_000, Math.max(1_000, timeoutMs));
  const privateValues = [config.apiKey, config.apiBaseUrl];
  let response: Response;
  try {
    response = await fetchWithTimeout(new URL('/v1/answer-models', base).toString(), {
      method: 'POST',
      timeoutMs: boundedTimeout + 1_000,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gatewayKey}`,
        'X-API-Key': gatewayKey,
        'X-Answer-API-Key': config.apiKey,
      },
      body: JSON.stringify({ api_base_url: config.apiBaseUrl }),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const timedOut = name === 'AbortError' || name === 'TimeoutError';
    return {
      status: 'error',
      models: [],
      error: {
        code: timedOut ? 'ANSWER_API_TIMEOUT' : 'ANSWER_API_NETWORK_ERROR',
        retryable: true,
        message: timedOut ? 'The custom API model request timed out.' : 'The custom API could not be reached.',
      },
    };
  }
  if (!response.ok) {
    return {
      status: 'error',
      models: [],
      error: await gatewayFailureFromResponse(response, privateValues),
    };
  }
  const parsed = await readBoundedJson(response);
  const models = parseAnswerModelIds(parsed, privateValues);
  if (!models) {
    return {
      status: 'error',
      models: [],
      error: {
        code: 'GATEWAY_INVALID_RESPONSE',
        retryable: false,
        message: 'The API model service returned an invalid response.',
      },
    };
  }
  return { status: 'complete', models, error: null };
}

export async function searchGateway(
  env: Env,
  query: string,
  options: { provider?: string; maxResults?: number; timeoutMs?: number } = {},
): Promise<SearchGatewayResult[]> {
  const base = (env.SEARCH_GATEWAY_URL || env.SEARXNG_URL || '').trim().replace(/\/+$/, '');
  const apiKey = (env.SEARCH_GATEWAY_API_KEY || '').trim();
  const q = query.trim();
  if (!base || !apiKey || q.length < 2) return [];
  if (!isValidHttpUrl(base)) return [];

  const url = new URL('/search', base);
  url.searchParams.set('q', q.slice(0, 500));
  url.searchParams.set('provider', options.provider || 'auto');
  url.searchParams.set('max_results', String(Math.min(10, Math.max(1, options.maxResults ?? 3))));

  try {
    const response = await fetchWithTimeout(url.toString(), {
      timeoutMs: options.timeoutMs ?? 9000,
      headers: {
        Accept: 'application/json',
        'X-API-Key': apiKey,
      },
    });
    if (!response.ok) return [];

    const data = (await response.json().catch(() => null)) as SearchGatewayResponse | null;
    if (!data?.success || !Array.isArray(data.results)) return [];

    return data.results
      .map((item) => ({
        title: String(item.title || '').trim(),
        url: String(item.url || '').trim(),
        snippet: String(item.snippet || item.content || '').trim(),
      }))
      .filter((item) => item.title || item.snippet)
      .slice(0, Math.min(10, Math.max(1, options.maxResults ?? 3)));
  } catch {
    return [];
  }
}

export async function buildSearchEvidence(
  env: Env,
  queries: string[],
  maxChars = 1200,
  options: { timeoutMs?: number } = {},
): Promise<string> {
  // Search evidence refines keyword suggestions. It must not hold the audit open.
  const lookups = await Promise.allSettled(
    queries.slice(0, 3).map(query => searchGateway(env, query, {
      maxResults: 3,
      timeoutMs: options.timeoutMs ?? 2500,
    }).then(results => ({ query, results })))
  );
  const chunks: string[] = [];
  for (const lookup of lookups) {
    if (lookup.status !== 'fulfilled') continue;
    const { query, results } = lookup.value;
    if (!results.length) continue;
    const lines = results.map((result, index) => {
      const title = result.title || 'Untitled';
      const snippet = result.snippet || result.url;
      return `${index + 1}. ${title}: ${snippet}`.slice(0, 300);
    });
    chunks.push(`Query: ${query}\n${lines.join('\n')}`);
  }
  return chunks.join('\n\n').slice(0, maxChars);
}
