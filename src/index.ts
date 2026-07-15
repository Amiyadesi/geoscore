import type { Env, ModuleResult } from './lib/types';
import { CF_FAST_CHAT_MODEL, GROQ_CHAT_MODEL, OPENROUTER_CHAT_MODEL } from './lib/ai-models';
import { callLlm, sanitizeLlmProviderError } from './lib/llm';
import { CITATION_PREDICTOR_SYSTEM, buildCitationPrompt } from './prompts';
import { fetchWithTimeout } from './lib/http';
import { auditRateLimit, searchRateLimit, getClientIp } from './lib/rate-limit';
import { getCachedAudit, cacheKey } from './lib/cache';
import {
  buildAuditContext,
  buildRecommendations,
  buildNormalizedChecks,
  CHECK_SEVERITIES,
  FACTUAL_CHECK_IDS,
  isSiteArchetype,
  mergeLighthouseChecks,
  scoreChecks,
  SCORE_POLICY,
  SCORE_VERSION,
  type AuditContext,
  type NormalizedCheck,
} from './lib/audit-core';
import { fetchAuditPage, validateAuditTargetUrl } from './lib/audit-pages';
import { handleSearch } from './routes/search';
import { handleAudit, normaliseDomain, projectLegacyScores } from './routes/audit';
import { LighthouseUpstreamError, runLighthouse, type LighthouseResult } from './modules/lighthouse';
import { handleChat } from './routes/chat';
import { handleFix } from './routes/fix';
import { handleBusinesses } from './routes/businesses';
import { handleLlmsGen } from './routes/llms_gen';
import { handleSerpGen } from './routes/serp_gen';
import { handleSchemaGen } from './routes/schema_gen';
import { handleGeoProbe } from './routes/geo_probe';
import { handleHistory } from './routes/history';
import { handleEvidenceMap } from './routes/evidence-map';
import { handleAnswerModels } from './routes/answer-models';
import {
  handleMonitorProjects,
  MONITOR_RETENTION_LIMIT,
  runWeeklyMonitorProjects,
} from './routes/monitoring';
import {
  EVIDENCE_SNAPSHOT_VERSION,
  MAX_FREE_ANSWER_PROVIDERS_PER_RUN,
  MAX_FREE_EVIDENCE_QUERIES,
  MAX_FREE_SEARCH_PROVIDERS_PER_QUERY,
} from './lib/query-evidence';
import { buildRepairGroups } from './lib/repair-groups';
import { handleFeedback, handleLearningAdmin } from './routes/feedback';
import {
  corsHeaders,
  jsonError as secureJsonError,
  isValidPublicHostname,
  PUBLIC_DOMAIN_ERROR,
  publicApiUrl,
  publicAppUrl,
  requireAdmin,
  withCors,
} from './lib/security';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Project-Token, X-API-Key',
};

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(req, env) });
    }

    return withCors(await routeRequest(req, env, ctx), req, env);
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await env.BUDGET_KV.delete(`browser:${yesterday}`);
    await env.BUDGET_KV.delete(`ai:${yesterday}`);

    // Capture weekly dated evidence for monitoring projects and aggregate learning patterns.
    if (event.cron === '0 8 * * 1') { // Mondays at 08:00 UTC
      await Promise.all([
        runWeeklyMonitorProjects(env),
        runWeeklyLearning(env),
      ]);
    }
  },
};

const PUBLIC_SOURCE_URL = 'https://github.com/Amiyadesi/geoscore';
export const PRODUCT_VERSION = '2.3.0';
const MAX_AUDIT_PAGES = 5;
const OPTIONAL_ANONYMOUS_MODULES = [
  'keywords',
  'ai_content_insights',
  'off_page_seo',
  'site_intel',
  'redirect_chain',
  'security_audit',
  'ssl_cert',
  'domain_intel',
  'broken_links',
] as const;

export function buildPublicMeta(env: Pick<Env, 'AUDIT_RATE_LIMIT_PER_HOUR'>) {
  const parsedLimit = Number.parseInt(env.AUDIT_RATE_LIMIT_PER_HOUR ?? '', 10);
  const freshAuditLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 8;
  const informationalChecks = FACTUAL_CHECK_IDS.filter(id => CHECK_SEVERITIES[id] === 'info').length;
  return {
    version: PRODUCT_VERSION,
    score_version: SCORE_VERSION,
    snapshot_version: EVIDENCE_SNAPSHOT_VERSION,
    max_pages: MAX_AUDIT_PAGES,
    max_audited_pages: MAX_AUDIT_PAGES,
    audit_modes: ['site', 'url'] as const,
    rate_limit: {
      fresh_audits: freshAuditLimit,
      fresh_audits_per_hour: freshAuditLimit,
      window_hours: 1,
    },
    checks: {
      factual: FACTUAL_CHECK_IDS.length,
      scoring: FACTUAL_CHECK_IDS.length - informationalChecks,
      informational: informationalChecks,
      predicted: 1,
      total: FACTUAL_CHECK_IDS.length + 1,
    },
    scoring: {
      method: 'weighted_known_applicable_with_caps',
      minimum_overall_coverage: SCORE_POLICY.minimum_overall_coverage,
      minimum_overall_confidence: SCORE_POLICY.minimum_overall_confidence,
      severity_caps: SCORE_POLICY.severity_caps,
      unknown_error_penalty: false,
      predicted_weight: 0,
    },
    limits: {
      evidence_queries_per_project: MAX_FREE_EVIDENCE_QUERIES,
      search_providers_per_query: MAX_FREE_SEARCH_PROVIDERS_PER_QUERY,
      answer_providers_per_run: MAX_FREE_ANSWER_PROVIDERS_PER_RUN,
      monitoring_schedule: 'weekly' as const,
      retained_snapshots: MONITOR_RETENTION_LIMIT,
    },
    license: 'MIT',
    source_url: PUBLIC_SOURCE_URL,
    capabilities: {
      query_evidence_map: true,
      api_answer_snapshots: true,
      accountless_monitoring: true,
      request_scoped_api_key: true,
      api_key_persistence: 'none' as const,
      consumer_ai_citation_monitoring: false,
      full_markdown_repair_report: true,
      lighthouse_score_merge: true,
      optional_modules_not_run: OPTIONAL_ANONYMOUS_MODULES,
    },
  };
}

class LighthouseAuditUpdateError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'LighthouseAuditUpdateError';
  }
}

async function persistLighthouseAuditUpdate(
  env: Env,
  auditId: string,
  domain: string,
  lighthouse: LighthouseResult,
): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare(
    `SELECT full_json FROM audits WHERE id = ? AND status = 'complete' LIMIT 1`,
  ).bind(auditId).first<{ full_json: string | null }>();
  if (!row?.full_json) {
    throw new LighthouseAuditUpdateError('AUDIT_NOT_FOUND', 'No completed audit was found for audit_id', 404);
  }

  let audit: Record<string, any>;
  try {
    audit = JSON.parse(row.full_json) as Record<string, any>;
  } catch {
    throw new LighthouseAuditUpdateError('AUDIT_DATA_INVALID', 'The stored audit cannot accept performance evidence', 409);
  }
  if (String(audit.domain ?? '').toLowerCase() !== domain) {
    throw new LighthouseAuditUpdateError('AUDIT_DOMAIN_MISMATCH', 'audit_id does not belong to the requested domain', 409);
  }
  const context = audit.audit_context as AuditContext | undefined;
  const storedChecks = Array.isArray(audit.normalized_checks)
    ? audit.normalized_checks
    : Array.isArray(audit.checks) ? audit.checks : null;
  if (!context || !storedChecks) {
    throw new LighthouseAuditUpdateError('AUDIT_VERSION_UNSUPPORTED', 'The stored audit predates evidence-first scoring', 409);
  }

  const pageUrl = typeof lighthouse.url === 'string'
    ? lighthouse.url
    : typeof audit.pages_audited?.[0]?.url === 'string' ? audit.pages_audited[0].url : `https://${domain}/`;
  const checks = mergeLighthouseChecks(storedChecks as NormalizedCheck[], lighthouse as unknown as Record<string, any>, pageUrl);
  const scoreSummary = scoreChecks(checks);
  const legacyScores = projectLegacyScores(scoreSummary, audit.modules ?? {});
  const modules = {
    ...(audit.modules ?? {}),
    lighthouse: {
      status: lighthouse.status === 'partial' ? 'partial' : 'ok',
      data: lighthouse,
    },
  };
  const recommendations = buildRecommendations(context, checks);
  const repairGroups = buildRepairGroups(checks, recommendations);
  const updatedAudit = {
    ...audit,
    score_version: scoreSummary.score_version,
    checks,
    normalized_checks: checks,
    score_summary: scoreSummary,
    recommendations_v2: recommendations,
    repair_groups: repairGroups,
    modules,
    ...legacyScores,
  };

  await env.DB.prepare(
    `UPDATE audits SET foundation_score = ?, weakness_score = ?, full_json = ? WHERE id = ? AND status = 'complete'`,
  ).bind(legacyScores.seo_score, legacyScores.geo_score, JSON.stringify(updatedAudit), auditId).run();

  return {
    audit_id: auditId,
    score_version: scoreSummary.score_version,
    score_summary: scoreSummary,
    normalized_checks: checks,
    recommendations_v2: recommendations,
    ...legacyScores,
  };
}

async function routeRequest(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;

    const ip = getClientIp(req);

    if (pathname === '/api/meta' && req.method === 'GET') {
      return new Response(JSON.stringify(buildPublicMeta(env)), {
        headers: {
          'Content-Type': 'application/json',
          ...CORS_HEADERS,
          'Cache-Control': 'public, max-age=300',
        },
      });
    }

    if (pathname === '/api/health' && (req.method === 'GET' || req.method === 'HEAD')) {
      return handleHealth(env, req.method === 'HEAD');
    }

    if (pathname === '/api/llm-test' && req.method === 'GET') {
      const denied = requireAdmin(req, env);
      if (denied) return denied;
      return handleLlmTest(env);
    }

    if (pathname === '/api/stats' && req.method === 'GET') {
      try {
        const row = await env.DB.prepare(`SELECT COUNT(*) as count FROM audits WHERE status='complete'`).first<{count:number}>();
        return new Response(JSON.stringify({ audits: row?.count ?? 0 }), {
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, 'Cache-Control': 'public, max-age=300' },
        });
      } catch {
        return new Response(JSON.stringify({ audits: 0 }), { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
      }
    }

    if (pathname === '/api/businesses' && req.method === 'GET') {
      return handleBusinesses(env);
    }

    if (pathname === '/api/recent' && req.method === 'GET') {
      try {
        const rows = await env.DB.prepare(
          `SELECT b.domain, a.foundation_score as seo_score, a.weakness_score as geo_score,
                  a.full_json, COALESCE(a.completed_at, a.created_at) as ts
           FROM audits a JOIN businesses b ON a.business_id = b.id
           WHERE a.status = 'complete'
             AND a.id = (
               SELECT a2.id
               FROM audits a2
               WHERE a2.business_id = a.business_id AND a2.status = 'complete'
               ORDER BY COALESCE(a2.completed_at, a2.created_at) DESC,
                        a2.created_at DESC,
                        a2.id DESC
               LIMIT 1
             )
           ORDER BY ts DESC LIMIT 10`
        ).all<{ domain: string; seo_score: number | null; geo_score: number | null; full_json: string | null; ts: number }>();
        const recent = (rows.results ?? []).map(r => {
          let scoreVersion: string | null = null;
          let storedOverall: number | null | undefined;
          try {
            const parsed = r.full_json ? JSON.parse(r.full_json) : null;
            scoreVersion = parsed?.score_version ?? parsed?.score_summary?.score_version ?? null;
            if (parsed && Object.prototype.hasOwnProperty.call(parsed, 'overall_score')) {
              storedOverall = typeof parsed.overall_score === 'number' ? parsed.overall_score : null;
            } else if (parsed?.score_summary?.overall && Object.prototype.hasOwnProperty.call(parsed.score_summary.overall, 'score')) {
              storedOverall = typeof parsed.score_summary.overall.score === 'number'
                ? parsed.score_summary.overall.score
                : null;
            }
          } catch { /* legacy row without valid full JSON */ }
          const overall = storedOverall !== undefined
            ? storedOverall
            : typeof r.seo_score === 'number' && typeof r.geo_score === 'number'
              ? Math.round(r.seo_score * 0.55 + r.geo_score * 0.45)
              : null;
          return { domain: r.domain, overall_score: overall, score_version: scoreVersion };
        });
        return new Response(JSON.stringify({ recent }), {
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, 'Cache-Control': 'public, max-age=60' },
        });
      } catch {
        return new Response(JSON.stringify({ recent: [] }), { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
      }
    }

    if (pathname === '/api/search' && req.method === 'GET') {
      const { limited } = await searchRateLimit(env, ip);
      if (limited) return rateLimitedResponse(60);
      return handleSearch(req, env);
    }

    if (pathname === '/api/answer-models' && req.method === 'POST') {
      const { limited } = await searchRateLimit(env, ip);
      if (limited) return rateLimitedResponse(60);
      return handleAnswerModels(req, env);
    }

    const evidenceMapMatch = pathname.match(/^\/api\/audits\/([^/]+)\/evidence-map$/);
    if (evidenceMapMatch && req.method === 'POST') {
      const { limited } = await searchRateLimit(env, ip);
      if (limited) return rateLimitedResponse(60);
      return handleEvidenceMap(req, decodeURIComponent(evidenceMapMatch[1]), env);
    }

    if (pathname === '/api/monitor-projects' || pathname.startsWith('/api/monitor-projects/')) {
      const { limited } = await searchRateLimit(env, ip);
      if (limited && req.method !== 'GET') return rateLimitedResponse(60);
      return handleMonitorProjects(req, env);
    }

    if (pathname.startsWith('/api/audit/') && pathname.endsWith('/cache') && req.method === 'DELETE') {
      const denied = requireAdmin(req, env);
      if (denied) return denied;
      const raw = decodeURIComponent(pathname.replace('/api/audit/', '').replace('/cache', ''));
      const domain = parseNormalisedPublicDomain(raw);
      if (!domain) return jsonError(PUBLIC_DOMAIN_ERROR, 400);
      const requestedMode = url.searchParams.get('mode');
      if (requestedMode && requestedMode !== 'site' && requestedMode !== 'url') {
        return jsonError('Invalid audit mode', 400);
      }
      const mode: 'site' | 'url' = requestedMode === 'url' ? 'url' : 'site';
      const rawTargetUrl = url.searchParams.get('url');
      const targetUrl = mode === 'url' && rawTargetUrl
        ? validateAuditTargetUrl(rawTargetUrl, domain)
        : null;
      if (mode === 'url' && !targetUrl) {
        return jsonError('URL mode requires an absolute URL on the submitted registrable domain', 400);
      }
      const rawHint = url.searchParams.get('archetype_hint');
      if (rawHint && !isSiteArchetype(rawHint)) {
        return jsonError('Invalid archetype_hint', 400);
      }
      await env.AUDIT_KV.delete(cacheKey(domain, {
        mode,
        targetUrl,
        archetypeHint: rawHint,
      }));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    if (pathname.startsWith('/api/audit/') && req.method === 'GET') {
      const raw = decodeURIComponent(pathname.replace('/api/audit/', ''));
      const domain = parseNormalisedPublicDomain(raw);
      if (!domain) {
        return jsonError(PUBLIC_DOMAIN_ERROR, 400);
      }
      const requestedMode = url.searchParams.get('mode');
      if (requestedMode && requestedMode !== 'site' && requestedMode !== 'url') {
        return jsonError('Invalid audit mode', 400);
      }
      const mode: 'site' | 'url' = requestedMode === 'url' ? 'url' : 'site';
      const rawTargetUrl = url.searchParams.get('url');
      const targetUrl = mode === 'url' && rawTargetUrl
        ? validateAuditTargetUrl(rawTargetUrl, domain)
        : null;
      if (mode === 'url' && !targetUrl) {
        return jsonError('URL mode requires an absolute URL on the submitted registrable domain', 400);
      }
      const rawHint = url.searchParams.get('archetype_hint');
      if (rawHint && !isSiteArchetype(rawHint)) {
        return jsonError('Invalid archetype_hint', 400);
      }
      const auditOptions = { mode, targetUrl, archetypeHint: rawHint };
      // ?fresh=1 — atomically bust cache then re-audit (no separate DELETE call needed)
      if (url.searchParams.get('fresh') === '1') {
        await env.AUDIT_KV.delete(cacheKey(domain, auditOptions));
      }
      // Cache hits are free — don't consume rate limit quota
      const cached = await getCachedAudit(env, domain, auditOptions);
      const adminBypass = !!env.ADMIN_TOKEN && req.headers.get('Authorization') === `Bearer ${env.ADMIN_TOKEN}`;
      if (!cached && !adminBypass) {
        const { limited, retryAfter } = await auditRateLimit(env, ip);
        if (limited) return rateLimitedResponse(retryAfter);
      }
      return handleAudit(domain, env, auditOptions);
    }

    if (pathname.startsWith('/api/chat/') && req.method === 'POST') {
      const auditId = pathname.replace('/api/chat/', '').trim();
      if (!auditId || auditId.length < 10) return jsonError('Invalid audit ID', 400);
      return handleChat(req, auditId, env, ctx);
    }

    if (pathname === '/api/fix' && req.method === 'POST') {
      return handleFix(req, env);
    }

    if (pathname === '/api/llms-gen' && req.method === 'POST') {
      return handleLlmsGen(req, env);
    }
    if (pathname === '/api/serp-gen' && req.method === 'POST') {
      return handleSerpGen(req, env);
    }
    if (pathname === '/api/schema-gen' && req.method === 'POST') {
      return handleSchemaGen(req, env);
    }
    if (pathname === '/api/geo-probe' && req.method === 'POST') {
      return handleGeoProbe(req, env);
    }

    // Proxy llms.txt fetches — direct browser fetch is blocked by CORS on most sites
    if (pathname === '/api/fetch-llms' && req.method === 'GET') {
      const raw = url.searchParams.get('domain') ?? '';
      const domain = parseStrictPublicDomain(raw);
      if (!domain) return jsonError(PUBLIC_DOMAIN_ERROR, 400);
      try {
        const res = await fetchWithTimeout(`https://${domain}/llms.txt`, { timeoutMs: 6000 });
        if (!res.ok) {
          return new Response(JSON.stringify({ error: `HTTP ${res.status} — no llms.txt at this URL` }), {
            status: res.status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          });
        }
        const text = await res.text();
        return new Response(text, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS_HEADERS, 'Cache-Control': 'public, max-age=3600' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: `Could not reach ${domain}/llms.txt` }), {
          status: 502, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }
    }

    // ── Lighthouse / PageSpeed Insights — runs in its own Worker invocation ──
    // Keeps subrequest count separate from the main audit's parallel fetch budget.
    if (pathname === '/api/lighthouse' && req.method === 'GET') {
      const raw = url.searchParams.get('domain') ?? '';
      const domain = parseStrictPublicDomain(raw);
      if (!domain) return jsonError(PUBLIC_DOMAIN_ERROR, 400);
      const rawAuditId = url.searchParams.get('audit_id');
      const auditId = rawAuditId?.trim() || null;
      if (auditId && !/^[A-Za-z0-9_-]{10,64}$/.test(auditId)) {
        return new Response(JSON.stringify({
          ok: false,
          status: 'error',
          source: 'audit_store',
          error: { code: 'INVALID_AUDIT_ID', message: 'audit_id is invalid', retryable: false },
          strategies: [],
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }
      if (!env.PAGESPEED_API_KEY) {
        return new Response(JSON.stringify({
          ok: false,
          status: 'error',
          source: 'Google PageSpeed Insights API',
          error: {
            code: 'PAGESPEED_NOT_CONFIGURED',
            message: 'PageSpeed Insights is not configured',
            retryable: false,
          },
          strategies: [],
        }), {
          status: 503,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }
      let result: LighthouseResult;
      try {
        result = await runLighthouse(domain, env.PAGESPEED_API_KEY);
      } catch (err: unknown) {
        const upstream = err instanceof LighthouseUpstreamError ? err : null;
        return new Response(JSON.stringify({
          ok: false,
          status: 'error',
          source: 'Google PageSpeed Insights API',
          error: {
            code: upstream?.code ?? 'PAGESPEED_UPSTREAM_ERROR',
            message: upstream?.message ?? 'PageSpeed Insights request failed',
            retryable: upstream?.retryable ?? true,
          },
          strategies: upstream?.strategies ?? [],
        }), {
          status: upstream?.httpStatus ?? 502,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }

      let auditUpdate: Record<string, unknown> | null = null;
      if (auditId) {
        try {
          auditUpdate = await persistLighthouseAuditUpdate(env, auditId, domain, result);
        } catch (err: unknown) {
          const updateError = err instanceof LighthouseAuditUpdateError ? err : null;
          return new Response(JSON.stringify({
            ok: false,
            status: 'error',
            source: 'audit_store',
            error: {
              code: updateError?.code ?? 'AUDIT_UPDATE_FAILED',
              message: updateError?.message ?? 'Performance evidence could not be stored',
              retryable: !updateError || updateError.httpStatus >= 500,
            },
            strategies: [result.mobile, result.desktop],
          }), {
            status: updateError?.httpStatus ?? 500,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          });
        }
      }

      return new Response(JSON.stringify({ ok: true, data: result, audit_update: auditUpdate }), {
        headers: {
          'Content-Type': 'application/json',
          ...CORS_HEADERS,
          'Cache-Control': auditId ? 'no-store' : 'public, max-age=300',
        },
      });
    }

    // Proxy OG / social-card images — avoids CORS block when downloading from the browser
    if (pathname === '/api/fetch-image' && req.method === 'GET') {
      const imageUrl = url.searchParams.get('url') ?? '';
      if (!/^https?:\/\//i.test(imageUrl)) {
        return new Response(JSON.stringify({ error: 'invalid url' }), {
          status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }
      try {
        const imgRes = await fetchWithTimeout(imageUrl, {
          timeoutMs: 10000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SiteAuditBot/1.0)' },
        });
        if (!imgRes.ok) throw new Error(`upstream ${imgRes.status}`);
        const body = await imgRes.arrayBuffer();
        const ct = imgRes.headers.get('content-type') || 'image/jpeg';
        return new Response(body, {
          headers: {
            'Content-Type': ct,
            'Cache-Control': 'public, max-age=3600',
            ...CORS_HEADERS,
          },
        });
      } catch {
        return new Response(JSON.stringify({ error: 'Could not fetch image' }), {
          status: 502, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }
    }

    // Shareable report: GET /api/share/:domain  — returns the latest complete audit's full JSON
    if (pathname.startsWith('/api/share/') && req.method === 'GET') {
      const raw = decodeURIComponent(pathname.replace('/api/share/', ''));
      const domain = parseStrictPublicDomain(raw);
      if (!domain) return jsonError(PUBLIC_DOMAIN_ERROR, 400);
      try {
        const biz = await env.DB.prepare(
          'SELECT id FROM businesses WHERE domain = ? LIMIT 1'
        ).bind(domain).first<{ id: number }>();
        if (!biz) return new Response(JSON.stringify({ error: 'No audit found for this domain' }), {
          status: 404, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
        const row = await env.DB.prepare(
          `SELECT full_json FROM audits WHERE business_id = ? AND status = 'complete'
           ORDER BY COALESCE(completed_at, created_at) DESC, created_at DESC, id DESC LIMIT 1`
        ).bind(biz.id).first<{ full_json: string }>();
        if (!row?.full_json) return new Response(JSON.stringify({ error: 'No complete audit found' }), {
          status: 404, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
        return new Response(row.full_json, {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=1800',
            ...CORS_HEADERS,
          },
        });
      } catch {
        return jsonError('Database error', 500);
      }
    }

    if (pathname.startsWith('/api/history/') && req.method === 'GET') {
      const raw = decodeURIComponent(pathname.replace('/api/history/', ''));
      const domain = parseStrictPublicDomain(raw);
      if (!domain) return jsonError(PUBLIC_DOMAIN_ERROR, 400);
      return handleHistory(domain, env);
    }

    // ── Compare endpoint: GET /api/compare?domains=a.com,b.com ──────────────
    if (pathname === '/api/compare' && req.method === 'GET') {
      const raw = url.searchParams.get('domains') ?? '';
      const submittedDomains = raw.split(',').map(d => d.trim()).filter(Boolean);
      const domains = submittedDomains.map(parseStrictPublicDomain);
      if (domains.some(domain => !domain)) return jsonError(PUBLIC_DOMAIN_ERROR, 400);
      if (domains.length < 2) return jsonError('Provide at least 2 comma-separated domains', 400);
      const { limited } = await auditRateLimit(env, ip);
      if (limited) return rateLimitedResponse(60);
      return handleCompare(domains as string[], env);
    }

    // ── Embed widget script: GET /embed.js ───────────────────────────────────
    if (pathname === '/embed.js' && req.method === 'GET') {
      return handleEmbedScript(url, env);
    }

    // ── Feedback: POST /api/feedback ─────────────────────────────────────────
    if (pathname === '/api/feedback' && req.method === 'POST') {
      const denied = requireAdmin(req, env);
      if (denied) return denied;
      return handleFeedback(req, env);
    }

    // ── Learning admin: GET /api/learning ────────────────────────────────────
    if (pathname === '/api/learning' && req.method === 'GET') {
      const denied = requireAdmin(req, env);
      if (denied) return denied;
      return handleLearningAdmin(env);
    }

    return jsonError('Not found', 404);
}

function parseStrictPublicDomain(raw: string): string | null {
  const trimmed = raw.trim();
  const domain = trimmed.toLowerCase();
  return domain === normaliseDomain(trimmed) && isValidPublicHostname(domain) ? domain : null;
}

function parseNormalisedPublicDomain(raw: string): string | null {
  const domain = normaliseDomain(raw);
  return isValidPublicHostname(domain) ? domain : null;
}

async function handleLlmTest(env: Env): Promise<Response> {
  const TEST_MESSAGES = [
    { role: 'user' as const, content: 'Reply with exactly: {"ok":true}' },
  ];
  const result: Record<string, unknown> = {
    ts: Date.now(),
    configuration: {
      internal_ai_configured: !!env.AI,
      external_api_configured: !!(env.API_KEY && env.API_BASE_URL && env.API_MODEL),
    },
  };
  const diagnosticSecrets = [env.API_KEY, env.GROQ_API_KEY, env.OPENROUTER_API_KEY];
  const safeDiagnostic = (value: unknown): string =>
    sanitizeLlmProviderError(String(value), diagnosticSecrets);

  // Test CF AI
  try {
    const cfResult = await env.AI.run(CF_FAST_CHAT_MODEL, {
      messages: TEST_MESSAGES,
      max_tokens: 20,
    } as Parameters<typeof env.AI.run>[1]);
    const text = (cfResult as { response?: string }).response ?? '';
    result.internal_ai = { ok: true, text: safeDiagnostic(text).slice(0, 100) };
  } catch (e) {
    result.internal_ai = { ok: false, error: safeDiagnostic(e) };
  }

  // Generic API_KEY diagnostic. This route is admin-only and never feeds public UI.
  if (!env.API_KEY) {
    result.external_primary = { ok: false, error: 'External API is not configured' };
  } else {
    try {
      const baseUrl = (env.API_BASE_URL ?? '').replace(/\/+$/, '');
      const model = env.API_MODEL ?? '';
      if (!baseUrl || !model) {
        result.external_primary = { ok: false, error: 'External API is not configured' };
      } else {
        const endpoint = /\/chat\/completions$/i.test(baseUrl)
          ? baseUrl
          : `${baseUrl}/chat/completions`;
        const res = await fetchWithTimeout(endpoint, {
          timeoutMs: 12_000,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: TEST_MESSAGES,
            max_tokens: 20,
            temperature: 0,
          }),
        });
        if (res.ok) {
          const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
          const text = data.choices?.[0]?.message?.content ?? '';
          result.external_primary = { ok: true, text: safeDiagnostic(text).slice(0, 100) };
        } else {
          const body = await res.text().catch(() => '');
          result.external_primary = {
            ok: false,
            status: res.status,
            error: safeDiagnostic(body),
          };
        }
      }
    } catch (e) {
      result.external_primary = {
        ok: false,
        error: safeDiagnostic(e),
      };
    }
  }

  // Test Groq (independently — don't depend on CF AI result)
  if (!env.GROQ_API_KEY) {
    result.external_secondary = { ok: false, error: 'External API not configured' };
  } else {
    try {
      const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
        timeoutMs: 12_000,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: GROQ_CHAT_MODEL,
          messages: TEST_MESSAGES,
          max_tokens: 20,
          temperature: 0,
        }),
      });
      if (res.ok) {
        const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
        const text = data.choices?.[0]?.message?.content ?? '';
        result.external_secondary = { ok: true, text: safeDiagnostic(text).slice(0, 100) };
      } else {
        const body = await res.text().catch(() => '');
        result.external_secondary = {
          ok: false,
          status: res.status,
          error: safeDiagnostic(body),
        };
      }
    } catch (e) {
      result.external_secondary = {
        ok: false,
        error: safeDiagnostic(e),
      };
    }
  }

  // Test OpenRouter independently. It remains optional even when Groq is configured.
  if (!env.OPENROUTER_API_KEY) {
    result.external_reserve = { ok: false, error: 'External API not configured' };
  } else {
    try {
      const res = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
        timeoutMs: 12_000,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': env.PUBLIC_APP_URL,
          'X-Title': 'Sayori GeoScore',
        },
        body: JSON.stringify({
          model: OPENROUTER_CHAT_MODEL,
          messages: TEST_MESSAGES,
          max_tokens: 20,
          temperature: 0,
        }),
      });
      if (res.ok) {
        const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
        const text = data.choices?.[0]?.message?.content ?? '';
        result.external_reserve = { ok: true, text: safeDiagnostic(text).slice(0, 100) };
      } else {
        const body = await res.text().catch(() => '');
        result.external_reserve = {
          ok: false,
          status: res.status,
          error: safeDiagnostic(body),
        };
      }
    } catch (e) {
      result.external_reserve = {
        ok: false,
        error: safeDiagnostic(e),
      };
    }
  }

  // Test real geo-query generation prompt (bypasses KV cache — uses live AI call)
  const GEO_MESSAGES = [
    { role: 'system' as const, content: 'You are an SEO expert. Output ONLY a JSON array. No markdown, no explanation.' },
    { role: 'user' as const, content: 'Generate exactly 3 search queries that an AI (ChatGPT, Perplexity, Google AI) would answer by citing THIS specific business.\n\nVertical: tech\nPage content: Example SaaS company that helps teams collaborate\n\nReturn ONLY a JSON array of exactly 3 strings, e.g. ["best team tool","how to collaborate online","top collaboration apps"]' },
  ];
  // Try CF AI directly (no KV cache involvement)
  try {
    const cfResult = await env.AI.run(CF_FAST_CHAT_MODEL, {
      messages: GEO_MESSAGES,
      max_tokens: 250,
    } as Parameters<typeof env.AI.run>[1]);
    const raw = (cfResult as { response?: string }).response ?? '';
    const match = raw.match(/\[[\s\S]*?\]/);
    result.geo_query_test = {
      ok: !!match,
      raw: safeDiagnostic(raw).slice(0, 300),
      parsed: match ? safeDiagnostic(match[0]) : null,
    };
  } catch (e) {
    result.geo_query_test = { ok: false, error: safeDiagnostic(e) };
  }

  // Test the same callLlm path used by audit modules, including JSON mode fallback.
  try {
    const raw = await callLlm([
      { role: 'system', content: CITATION_PREDICTOR_SYSTEM },
      {
        role: 'user',
        content: buildCitationPrompt(
          'best team collaboration software',
          'Example SaaS company that helps teams collaborate, publish docs, and manage projects.',
          'Page has structured data and verifiable signals',
        ),
      },
    ], 256, env, { jsonMode: true, temperature: 0 });
    const match = raw.match(/\{[\s\S]*\}/);
    result.citation_callllm_test = {
      ok: !!match,
      raw: safeDiagnostic(raw).slice(0, 300),
      parsed: match ? safeDiagnostic(match[0]).slice(0, 300) : null,
    };
  } catch (e) {
    result.citation_callllm_test = { ok: false, error: safeDiagnostic(e) };
  }

  try {
    const raw = await callLlm([
      {
        role: 'system',
        content: 'You are an SEO analyst. Return JSON only.',
      },
      {
        role: 'user',
        content: 'Return {"business_context":{"description":"test","industry_niche":"test","target_audience":"test"},"ai_visibility_score":50}',
      },
    ], 256, env, { jsonMode: true, temperature: 0 });
    const match = raw.match(/\{[\s\S]*\}/);
    result.content_callllm_test = {
      ok: !!match,
      raw: safeDiagnostic(raw).slice(0, 300),
      parsed: match ? safeDiagnostic(match[0]).slice(0, 300) : null,
    };
  } catch (e) {
    result.content_callllm_test = { ok: false, error: safeDiagnostic(e) };
  }

  return new Response(JSON.stringify(result, null, 2), {
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

async function handleHealth(env: Env, headOnly = false): Promise<Response> {
  const checks: Record<string, string> = {};
  const t = async (name: string, fn: () => Promise<unknown>) => {
    try { await fn(); checks[name] = 'ok'; }
    catch { checks[name] = 'error'; }
  };
  await Promise.all([
    t('d1', () => env.DB.prepare('SELECT 1').run()),
    t('kv', () => env.AUDIT_KV.get('health-check')),
    t('budget_kv', () => env.BUDGET_KV.get('health-check')),
  ]);
  const allOk = Object.values(checks).every(v => v === 'ok');
  const body = headOnly ? null : JSON.stringify({ status: allOk ? 'ok' : 'degraded', checks, ts: Date.now() });
  return new Response(body, {
    status: allOk ? 200 : 503,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function jsonError(msg: string, status: number): Response {
  return secureJsonError(msg, status);
}

function rateLimitedResponse(retryAfter: number): Response {
  return new Response(
    JSON.stringify({ error: 'Rate limit exceeded', retryAfter }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfter),
        ...CORS_HEADERS,
      },
    }
  );
}

// ── /api/compare ─────────────────────────────────────────────────────────────
async function handleCompare(domains: string[], env: Env): Promise<Response> {
  const { runTechnicalSeo } = await import('./modules/technical_seo');
  const { runSchemaAudit }  = await import('./modules/schema_audit');
  const { runContentQuality } = await import('./modules/content_quality');

  const results: Record<string, object> = {};

  await Promise.all(domains.map(async (domain) => {
    try {
      // Check KV cache first — free lookup
      const cached = await getCachedAudit(env, domain);
      if (cached) {
        const parsed = JSON.parse(cached);
        results[domain] = {
          overall_score: parsed.overall_score ?? parsed.score_summary?.overall?.score ?? null,
          seo_score:     parsed.seo_score ?? parsed.score_summary?.seo?.score ?? null,
          geo_score:     parsed.geo_score ?? parsed.score_summary?.geo?.score ?? null,
          score_version: parsed.score_version ?? parsed.score_summary?.score_version ?? null,
          coverage: parsed.score_summary?.overall?.coverage ?? null,
        };
        return;
      }

      const page = await fetchAuditPage({ url: `https://${domain}/`, page_type: 'home', source: 'requested' });
      const context = buildAuditContext({ domain, pages: [page] });
      const [tech, schema, content, auth, geo] = await Promise.all([
        runTechnicalSeo(domain, page.html, page.headers, page.response_ms, page.final_url)
          .then(data => ({ status: 'ok', data } as ModuleResult))
          .catch(error => ({ status: 'failed', error: error instanceof Error ? error.message : 'technical audit failed' } as ModuleResult)),
        runSchemaAudit(domain, page.html, [], context.site_archetype)
          .then(data => ({ status: 'ok', data } as ModuleResult))
          .catch(error => ({ status: 'failed', error: error instanceof Error ? error.message : 'schema audit failed' } as ModuleResult)),
        runContentQuality(domain, page.html)
          .then(data => ({ status: 'ok', data } as ModuleResult))
          .catch(error => ({ status: 'failed', error: error instanceof Error ? error.message : 'content audit failed' } as ModuleResult)),
        Promise.resolve({ status: 'skipped', data: null } as ModuleResult),
        Promise.resolve({ status: 'skipped', data: null } as ModuleResult),
      ]);
      const modules: Record<string, ModuleResult> = {
        technical_seo: tech,
        schema_audit: schema,
        content_quality: content,
        authority: auth,
        geo_predicted: geo,
      };
      const summary = scoreChecks(buildNormalizedChecks(context, [page], modules));

      results[domain] = {
        overall_score: summary.overall.score,
        seo_score: summary.seo.score,
        geo_score: summary.geo.score,
        score_version: summary.score_version,
        coverage: summary.overall.coverage,
      };
    } catch {
      results[domain] = { overall_score: null, seo_score: null, geo_score: null, score_version: null, coverage: 0 };
    }
  }));

  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// ── Weekly pattern learning (Layer 3) ────────────────────────────────────────
async function runWeeklyLearning(env: Env): Promise<void> {
  try {
    // Find corrections that happened 2+ times for the same field/value pair in the last 7 days
    const patterns = await env.DB.prepare(`
      SELECT field, reported_value, correct_value,
             COUNT(DISTINCT domain) as domain_count,
             GROUP_CONCAT(domain, ',') as domains
      FROM feedback
      WHERE created_at > unixepoch() - 7 * 86400
        AND correct_value IS NOT NULL
      GROUP BY field, reported_value, correct_value
      HAVING domain_count >= 2
    `).all();

    for (const p of (patterns.results ?? [])) {
      const row = p as {
        field: string;
        reported_value: string;
        correct_value: string;
        domain_count: number;
        domains: string;
      };
      await env.DB.prepare(`
        INSERT INTO learning_patterns (pattern_type, trigger_signal, correction, example_domains, confidence)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING
      `).bind(
        `${row.field}_misclassification`,
        row.reported_value,
        row.correct_value,
        row.domains,
        row.domain_count,
      ).run();
    }
  } catch { /* skip if tables don't exist yet */ }
}

// ── /embed.js ─────────────────────────────────────────────────────────────────
function handleEmbedScript(url: URL, env: Env): Response {
  const domain = url.searchParams.get('domain') ?? '';
  const auditUrl = `${publicAppUrl(env)}/?d=${encodeURIComponent(domain)}`;

  const script = `(function(){
  var d = document.currentScript.getAttribute('data-domain') || ${JSON.stringify(domain)};
  var el = document.createElement('a');
  el.href = ${JSON.stringify(publicAppUrl(env) + '/?d=')} + encodeURIComponent(d);
  el.target = '_blank';
  el.rel = 'noopener';
  el.style.cssText = 'display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:6px 12px;text-decoration:none;font-family:Inter,system-ui,sans-serif;font-size:12px;color:#334155;box-shadow:0 1px 3px rgba(0,0,0,0.08)';
  el.innerHTML = '<svg width="16" height="16" viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="6" fill="#2563eb"/><path d="M7 22L13 13L18 18L24 9" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24" cy="9" r="2.5" fill="#34d399"/></svg> <span>GeoScore Audit</span>';
  document.currentScript.parentNode.insertBefore(el, document.currentScript.nextSibling);
})();`;

  return new Response(script, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=3600',
      ...CORS_HEADERS,
    },
  });
}
