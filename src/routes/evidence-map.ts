import type { AuditContext } from '../lib/audit-core';
import { isSiteArchetype } from '../lib/audit-core';
import { registrableRoot } from '../lib/audit-pages';
import {
  EVIDENCE_SNAPSHOT_VERSION,
  planEvidenceQueries,
  type EvidenceMapOpportunity,
  type EvidenceMapSnapshot,
  type EvidenceMapSource,
  type EvidenceQueryIntent,
  type EvidenceStageDiagnosis,
} from '../lib/query-evidence';
import {
  requestAnswerSnapshots,
  requestEvidenceSearch,
  validateRequestScopedAnswerConfig,
  type AnswerGatewayResult,
  type EvidenceGatewayResult,
  type RequestScopedAnswerConfig,
} from '../lib/search-gateway';
import type { Env } from '../lib/types';

interface StoredAudit {
  audit_id: string;
  domain: string;
  score_version: string;
  audit_context: AuditContext;
  pages_audited: Array<Record<string, unknown>>;
  score_summary?: unknown;
  [key: string]: unknown;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isAuditContext(value: unknown): value is AuditContext {
  const item = object(value);
  return !!item &&
    typeof item.site_archetype === 'string' &&
    isSiteArchetype(item.site_archetype) &&
    typeof item.root_domain === 'string' &&
    typeof item.locale === 'string' &&
    Array.isArray(item.page_types) &&
    typeof item.confidence === 'number' &&
    Array.isArray(item.evidence);
}

function parseStoredAudit(raw: string, auditId: string): StoredAudit | null {
  try {
    const parsed = object(JSON.parse(raw));
    if (!parsed || parsed.audit_id !== auditId || typeof parsed.domain !== 'string' ||
        typeof parsed.score_version !== 'string' || !isAuditContext(parsed.audit_context) ||
        !Array.isArray(parsed.pages_audited)) return null;
    return parsed as unknown as StoredAudit;
  } catch {
    return null;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function requestScopedAnswerConfig(
  req: Request,
): Promise<{ config: RequestScopedAnswerConfig | null; response: Response | null }> {
  const declaredLength = Number.parseInt(req.headers.get('Content-Length') ?? '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > 4096) {
    return {
      config: null,
      response: jsonResponse({ error: { code: 'CUSTOM_API_CONFIG_INVALID', message: 'Custom API configuration is invalid.' } }, 400),
    };
  }
  const raw = await req.text();
  let body: Record<string, unknown> = {};
  if (raw.trim()) {
    if (raw.length > 4096) {
      return {
        config: null,
        response: jsonResponse({ error: { code: 'CUSTOM_API_CONFIG_INVALID', message: 'Custom API configuration is invalid.' } }, 400),
      };
    }
    try {
      const parsed = object(JSON.parse(raw));
      if (!parsed) throw new Error('invalid body');
      body = parsed;
    } catch {
      return {
        config: null,
        response: jsonResponse({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, 400),
      };
    }
  }
  if (Object.keys(body).some(key => key !== 'api_base_url' && key !== 'api_model')) {
    return {
      config: null,
      response: jsonResponse({ error: { code: 'CUSTOM_API_CONFIG_INVALID', message: 'Custom API configuration is invalid.' } }, 400),
    };
  }
  const validated = validateRequestScopedAnswerConfig(
    req.headers.get('X-API-Key'),
    body.api_base_url,
    body.api_model,
  );
  if (validated.ok === false) {
    return {
      config: null,
      response: jsonResponse({
        error: {
          code: validated.code,
          message: validated.code === 'CUSTOM_API_CONFIG_INCOMPLETE'
            ? 'API key, HTTPS base URL, and model must be provided together.'
            : 'Custom API configuration is invalid.',
        },
      }, 400),
    };
  }
  return { config: validated.config, response: null };
}

function normalizeUrlKey(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = '';
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return null;
  }
}

function auditPageUrls(pages: Array<Record<string, unknown>>): string[] {
  const urls: string[] = [];
  for (const page of pages) {
    const value = typeof page.final_url === 'string'
      ? page.final_url
      : typeof page.url === 'string' ? page.url : '';
    const normalized = normalizeUrlKey(value);
    if (normalized && !urls.includes(normalized)) urls.push(normalized);
  }
  return urls;
}

function sourceType(domain: string, targetRoot: string, url: string): EvidenceMapSource['source_type'] {
  if (domain === targetRoot) return 'audited_site';
  const host = new URL(url).hostname.toLowerCase();
  if (/^(docs?|developer|developers|support)\./.test(host) ||
      /github\.com$|gitlab\.com$|readthedocs\.io$|devdocs\.io$/.test(host)) return 'documentation';
  if (/reddit\.com$|stackoverflow\.com$|stackexchange\.com$|quora\.com$|linux\.do$/.test(host)) return 'community';
  if (/medium\.com$|substack\.com$|wordpress\.com$|news|blog/.test(host)) return 'publisher';
  return 'other';
}

function mappedPageUrl(canonicalUrl: string, pages: string[]): string | null {
  const canonical = normalizeUrlKey(canonicalUrl);
  if (!canonical) return null;
  return pages.find(page => page === canonical) ?? null;
}

function queryIntent(query: string, plan: ReturnType<typeof planEvidenceQueries>): EvidenceQueryIntent | 'unknown' {
  return plan.queries.find(item => item.query === query)?.intent ?? 'unknown';
}

function buildDiagnosis(
  gateway: EvidenceGatewayResult,
  sources: EvidenceMapSource[],
  queryCount: number,
): EvidenceStageDiagnosis[] {
  const targetSources = sources.filter(source => source.target_domain);
  const completedRuns = gateway.snapshot?.provider_runs.filter(run => run.status === 'complete' || run.status === 'empty') ?? [];
  const extracted = targetSources.filter(source => source.extract_status === 'complete');
  const fetchFailures = targetSources.filter(source => ['blocked', 'timeout', 'error'].includes(source.extract_status));
  const bestRank = targetSources.reduce((best, source) => Math.min(best, source.provider_rank), Number.POSITIVE_INFINITY);

  const retrieval: EvidenceStageDiagnosis = gateway.snapshot
    ? {
        stage: 'retrieval',
        status: completedRuns.length ? 'pass' : 'risk',
        evidence: [`${completedRuns.length} provider runs completed for ${queryCount} planned queries.`],
      }
    : {
        stage: 'retrieval',
        status: 'unknown',
        evidence: [gateway.error?.code ?? 'No external evidence snapshot is available.'],
      };
  const discovery: EvidenceStageDiagnosis = targetSources.length
    ? { stage: 'discovery', status: 'pass', evidence: [`The audited root appeared in ${targetSources.length} result records.`] }
    : gateway.snapshot?.results.length
      ? { stage: 'discovery', status: 'risk', evidence: ['External results were observed, but the audited root was not present.'] }
      : { stage: 'discovery', status: 'unknown', evidence: ['There is not enough search evidence to assess discovery.'] };
  const fetch: EvidenceStageDiagnosis = extracted.length
    ? { stage: 'fetch', status: fetchFailures.length ? 'risk' : 'pass', evidence: [`${extracted.length} audited-site results were extracted; ${fetchFailures.length} fetches were blocked or failed.`] }
    : targetSources.length
      ? { stage: 'fetch', status: fetchFailures.length ? 'risk' : 'unknown', evidence: ['No audited-site result produced extracted content.'] }
      : { stage: 'fetch', status: 'unknown', evidence: ['The audited site was not observed, so fetchability cannot be inferred.'] };
  const parse: EvidenceStageDiagnosis = extracted.length
    ? { stage: 'parse', status: 'pass', evidence: [`${extracted.length} audited-site result records include extracted content.`] }
    : { stage: 'parse', status: 'unknown', evidence: ['No extracted audited-site content is available for parse assessment.'] };
  const selection: EvidenceStageDiagnosis = targetSources.length
    ? {
        stage: 'selection',
        status: bestRank <= 5 ? 'pass' : 'risk',
        evidence: [`Best observed provider rank for the audited root was ${bestRank}.`],
      }
    : gateway.snapshot?.results.length
      ? { stage: 'selection', status: 'risk', evidence: ['Other sources were selected while the audited root was not observed.'] }
      : { stage: 'selection', status: 'unknown', evidence: ['There is not enough evidence to assess result selection.'] };
  const attribution: EvidenceStageDiagnosis = {
    stage: 'attribution',
    status: 'unknown',
    evidence: ['Search evidence does not prove attribution by consumer answer interfaces.'],
  };
  return [discovery, fetch, parse, retrieval, selection, attribution];
}

export function buildEvidenceMapSnapshot(
  audit: StoredAudit,
  gateway: EvidenceGatewayResult,
  answerGateway: AnswerGatewayResult,
  observedAt = new Date().toISOString(),
): EvidenceMapSnapshot {
  const plan = planEvidenceQueries(audit.audit_context);
  const pages = auditPageUrls(audit.pages_audited);
  const results = gateway.snapshot?.results ?? [];
  const sources: EvidenceMapSource[] = results.map(result => {
    let domain = result.registrable_domain ?? '';
    if (!domain) {
      try { domain = registrableRoot(new URL(result.canonical_url).hostname) ?? ''; } catch { domain = ''; }
    }
    const targetDomain = domain === audit.audit_context.root_domain;
    return {
      source_id: result.source_id,
      query: result.query,
      title: result.title,
      url: result.url,
      canonical_url: result.canonical_url,
      domain,
      source_type: sourceType(domain, audit.audit_context.root_domain, result.canonical_url),
      provider: result.provider,
      provider_rank: result.provider_rank,
      retrieved_at: result.retrieved_at,
      mapped_page_url: targetDomain ? mappedPageUrl(result.canonical_url, pages) : null,
      target_domain: targetDomain,
      extract_status: result.extract_status,
    };
  });
  const targetSources = sources.filter(source => source.target_domain);
  const observedQueries = [...new Set(targetSources.flatMap(source => {
    const result = results.find(item => item.source_id === source.source_id);
    return result?.matched_queries.length ? result.matched_queries : [source.query];
  }).filter(Boolean))];
  const opportunities: EvidenceMapOpportunity[] = plan.queries
    .filter(query => !observedQueries.includes(query.query))
    .map(query => ({
      query: query.query,
      intent: queryIntent(query.query, plan),
      reason: 'target_not_observed' as const,
      example_source_ids: sources.filter(source => source.query === query.query && !source.target_domain)
        .slice(0, 3)
        .map(source => source.source_id),
    }));

  return {
    snapshot_version: EVIDENCE_SNAPSHOT_VERSION,
    status: gateway.status === 'complete' && answerGateway.status === 'complete'
      ? 'complete'
      : gateway.snapshot || answerGateway.snapshot
        ? 'partial'
        : gateway.status === 'unavailable' && answerGateway.status === 'unavailable' ? 'unavailable' : 'error',
    observed_at: observedAt,
    affects_score: false,
    score_version: audit.score_version,
    query_plan: plan,
    search_snapshot: gateway.snapshot,
    answer_snapshot: answerGateway.snapshot,
    gateway_error: gateway.error ? {
      code: gateway.error.code,
      retryable: gateway.error.retryable,
      message: gateway.error.message,
    } : null,
    answer_gateway_error: answerGateway.error ? {
      code: answerGateway.error.code,
      retryable: answerGateway.error.retryable,
      message: answerGateway.error.message,
    } : null,
    target: {
      root_domain: audit.audit_context.root_domain,
      appearances: targetSources.length,
      observed_queries: observedQueries,
      mapped_pages: [...new Set(targetSources.map(source => source.mapped_page_url).filter((url): url is string => !!url))],
    },
    sources,
    opportunities,
    diagnosis: buildDiagnosis(gateway, sources, plan.queries.length),
    limitations: [
      'This is a dated search and API evidence snapshot, not a factual SEO or GEO score input.',
      'Search results do not prove citations in ChatGPT, Perplexity, Gemini, or Google AI Overview consumer interfaces.',
    ],
  };
}

export async function handleEvidenceMap(req: Request, auditId: string, env: Env): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } }, 405);
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(auditId)) {
    return jsonResponse({ error: { code: 'INVALID_AUDIT_ID', message: 'Invalid audit ID' } }, 400);
  }
  const requestConfig = await requestScopedAnswerConfig(req);
  if (requestConfig.response) return requestConfig.response;

  let row: { full_json: string | null } | null;
  try {
    row = await env.DB.prepare(
      `SELECT full_json FROM audits WHERE id = ? AND status = 'complete' LIMIT 1`,
    ).bind(auditId).first<{ full_json: string | null }>();
  } catch {
    return jsonResponse({ error: { code: 'AUDIT_STORE_UNAVAILABLE', message: 'Audit storage is temporarily unavailable', retryable: true } }, 503);
  }
  if (!row?.full_json) {
    return jsonResponse({ error: { code: 'AUDIT_NOT_FOUND', message: 'Completed audit not found' } }, 404);
  }
  const audit = parseStoredAudit(row.full_json, auditId);
  if (!audit) {
    return jsonResponse({ error: { code: 'AUDIT_VERSION_UNSUPPORTED', message: 'The stored audit cannot create an evidence map' } }, 409);
  }

  const plan = planEvidenceQueries(audit.audit_context);
  const [gateway, answerGateway] = await Promise.all([
    requestEvidenceSearch(env, plan),
    requestAnswerSnapshots(env, plan, requestConfig.config),
  ]);
  const evidenceMap = buildEvidenceMapSnapshot(audit, gateway, answerGateway);
  const updatedAudit = { ...audit, evidence_map: evidenceMap };
  try {
    await env.DB.prepare(
      `UPDATE audits SET full_json = ? WHERE id = ? AND status = 'complete'`,
    ).bind(JSON.stringify(updatedAudit), auditId).run();
  } catch {
    return jsonResponse({ error: { code: 'AUDIT_STORE_UNAVAILABLE', message: 'The evidence snapshot could not be stored', retryable: true } }, 503);
  }

  return jsonResponse({
    ok: true,
    data: evidenceMap,
    score_summary: audit.score_summary ?? null,
  });
}
