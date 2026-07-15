import type { AuditContext, SiteArchetype } from './audit-core';

export const EVIDENCE_SNAPSHOT_VERSION = '1.0.0' as const;
export const QUERY_PLAN_VERSION = '1.0.0' as const;
export const MAX_FREE_EVIDENCE_QUERIES = 3;
export const MAX_FREE_SEARCH_PROVIDERS_PER_QUERY = 2;
export const MAX_FREE_ANSWER_PROVIDERS_PER_RUN = 1;

export type EvidenceQueryIntent =
  | 'branded'
  | 'informational'
  | 'task'
  | 'comparison'
  | 'local'
  | 'navigational';

export type EvidenceStage =
  | 'discovery'
  | 'fetch'
  | 'parse'
  | 'retrieval'
  | 'selection'
  | 'attribution';

export interface PlannedEvidenceQuery {
  id: string;
  intent: EvidenceQueryIntent;
  query: string;
}

export interface EvidenceQueryPlan {
  version: typeof QUERY_PLAN_VERSION;
  generated_from: 'audit_context';
  root_domain: string;
  locale: string;
  site_archetype: SiteArchetype;
  queries: PlannedEvidenceQuery[];
}

export type EvidenceProviderRunStatus =
  | 'complete'
  | 'empty'
  | 'timeout'
  | 'auth_error'
  | 'rate_limited'
  | 'upstream_error'
  | 'invalid_request'
  | 'circuit_open';

export interface EvidenceError {
  code: string;
  scope: 'request' | 'provider_run' | 'extraction' | 'answer_snapshot' | 'answer_api';
  retryable: boolean;
  message: string;
  provider?: string;
  query_index?: number;
  retry_after_seconds?: number;
}

export interface EvidenceSearchResult {
  source_id: string;
  query: string;
  matched_queries: string[];
  provider: string;
  providers: string[];
  provider_rank: number;
  provider_ranks: Record<string, number>;
  url: string;
  canonical_url: string;
  title: string;
  snippet: string;
  retrieved_at: string;
  registrable_domain?: string;
  fusion_score: number;
  rerank_score: number | null;
  extract_status: 'complete' | 'not_requested' | 'blocked' | 'timeout' | 'error';
  content?: string;
  content_hash?: string | null;
}

export interface EvidenceProviderRun {
  provider: string;
  query: string;
  status: EvidenceProviderRunStatus;
  latency_ms: number | null;
  result_count: number;
  cache_hit: boolean;
  error: EvidenceError | null;
}

export interface EvidenceUsage {
  provider_calls: number;
  extract_pages: number;
  cache_hits: number;
  estimated_credits: number | null;
  elapsed_ms: number;
}

export interface EvidenceSearchSnapshot {
  evidence_version: string;
  request_id: string;
  query_plan: {
    queries: string[];
    locale: string;
  };
  results: EvidenceSearchResult[];
  provider_runs: EvidenceProviderRun[];
  usage: EvidenceUsage;
  partial: boolean;
  degraded: boolean;
  errors: EvidenceError[];
}

export interface AnswerSnapshotCitation {
  url: string;
  title: string;
  source_id?: string;
}

export interface AnswerSnapshotObservation {
  query: string;
  status: 'complete' | 'empty' | 'timeout' | 'auth_error' | 'rate_limited' | 'upstream_error' | 'invalid_response';
  provider: string;
  model: string;
  answer: string;
  citations: AnswerSnapshotCitation[];
  observed_at: string;
  latency_ms: number | null;
  error: EvidenceError | null;
}

export interface AnswerSnapshot {
  snapshot_version: string;
  request_id: string;
  observations: AnswerSnapshotObservation[];
  usage: {
    requests: number;
    input_tokens: number | null;
    output_tokens: number | null;
    elapsed_ms: number;
  };
  partial: boolean;
  degraded: boolean;
  limitations: string[];
  errors: EvidenceError[];
}

export type EvidenceMapStatus = 'complete' | 'partial' | 'unavailable' | 'error';
export type EvidenceSourceType = 'audited_site' | 'documentation' | 'community' | 'publisher' | 'other';

export interface EvidenceMapSource {
  source_id: string;
  query: string;
  title: string;
  url: string;
  canonical_url: string;
  domain: string;
  source_type: EvidenceSourceType;
  provider: string;
  provider_rank: number;
  retrieved_at: string;
  mapped_page_url: string | null;
  target_domain: boolean;
  extract_status: EvidenceSearchResult['extract_status'];
}

export interface EvidenceMapOpportunity {
  query: string;
  intent: EvidenceQueryIntent | 'unknown';
  reason: 'target_not_observed';
  example_source_ids: string[];
}

export interface EvidenceStageDiagnosis {
  stage: EvidenceStage;
  status: 'pass' | 'risk' | 'unknown';
  evidence: string[];
}

export interface EvidenceMapSnapshot {
  snapshot_version: typeof EVIDENCE_SNAPSHOT_VERSION;
  status: EvidenceMapStatus;
  observed_at: string;
  affects_score: false;
  score_version: string;
  query_plan: EvidenceQueryPlan;
  search_snapshot: EvidenceSearchSnapshot | null;
  answer_snapshot: AnswerSnapshot | null;
  gateway_error: {
    code: string;
    retryable: boolean;
    message: string;
  } | null;
  answer_gateway_error: {
    code: string;
    retryable: boolean;
    message: string;
  } | null;
  target: {
    root_domain: string;
    appearances: number;
    observed_queries: string[];
    mapped_pages: string[];
  };
  sources: EvidenceMapSource[];
  opportunities: EvidenceMapOpportunity[];
  diagnosis: EvidenceStageDiagnosis[];
  limitations: string[];
}

interface QueryCandidate {
  intent: EvidenceQueryIntent;
  value: string;
}

const EDITORIAL_ARCHETYPES = new Set<SiteArchetype>(['personal_blog', 'editorial']);

function compactTerm(value: string | null | undefined, maxLength = 120): string {
  return (value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function appendCandidate(
  candidates: QueryCandidate[],
  intent: EvidenceQueryIntent,
  ...parts: Array<string | null | undefined>
): void {
  const value = parts.map(part => compactTerm(part)).filter(Boolean).join(' ').trim();
  if (value.length >= 2) candidates.push({ intent, value: value.slice(0, 240) });
}

function editorialQueries(
  candidates: QueryCandidate[],
  entity: string,
  vertical: string,
  rootDomain: string,
  zh: boolean,
  hasAboutPage: boolean,
): void {
  appendCandidate(candidates, 'branded', entity, zh ? '博客 文章' : 'blog articles');
  appendCandidate(
    candidates,
    'informational',
    entity,
    vertical || null,
    zh ? (vertical ? '相关文章' : '最新文章') : (vertical ? 'articles' : 'latest articles'),
  );
  appendCandidate(
    candidates,
    'navigational',
    hasAboutPage ? entity : rootDomain,
    zh ? (hasAboutPage ? '关于 作者' : '文章归档') : (hasAboutPage ? 'about author' : 'article archive'),
  );
}

/**
 * Builds a deterministic, bounded search plan from audited facts only.
 * Page HTML, recommendation text, provider output, and model output are
 * intentionally absent from this API so they cannot silently change intent.
 */
export function planEvidenceQueries(context: AuditContext): EvidenceQueryPlan {
  const zh = context.locale.toLowerCase().startsWith('zh');
  const rootDomain = compactTerm(context.root_domain, 253);
  const entity = compactTerm(context.entity?.name, 120) || rootDomain;
  const vertical = compactTerm(context.industry_vertical, 100);
  const locality = compactTerm(context.locality, 100);
  const pageTypes = new Set(context.page_types.map(type => type.toLowerCase()));
  const candidates: QueryCandidate[] = [];

  if (EDITORIAL_ARCHETYPES.has(context.site_archetype)) {
    editorialQueries(candidates, entity, vertical, rootDomain, zh, pageTypes.has('about'));
  } else {
    switch (context.site_archetype) {
      case 'news_media':
        appendCandidate(candidates, 'branded', entity, zh ? '新闻' : 'news');
        appendCandidate(candidates, 'informational', vertical || entity, zh ? '最新报道' : 'latest reporting');
        appendCandidate(candidates, 'navigational', entity, zh ? '关于 编辑部' : 'about newsroom');
        break;
      case 'documentation':
        appendCandidate(candidates, 'branded', entity, zh ? '文档' : 'documentation');
        appendCandidate(candidates, 'task', entity, vertical || null, zh ? '使用指南' : 'guide');
        appendCandidate(candidates, 'navigational', entity, pageTypes.has('docs') ? 'API reference' : (zh ? '文档目录' : 'documentation index'));
        break;
      case 'saas':
        appendCandidate(candidates, 'branded', entity, zh ? '软件 功能' : 'software features');
        appendCandidate(candidates, 'task', vertical || entity, zh ? '软件 使用指南' : 'software guide');
        appendCandidate(candidates, 'comparison', vertical || entity, zh ? '软件对比' : 'software comparison');
        break;
      case 'ecommerce':
        appendCandidate(candidates, 'branded', entity, zh ? '商品' : 'products');
        appendCandidate(candidates, 'informational', vertical || entity, zh ? '选购指南' : 'buying guide');
        appendCandidate(candidates, 'comparison', vertical || entity, zh ? '产品对比' : 'product comparison');
        break;
      case 'local_business':
        appendCandidate(candidates, 'local', entity, locality || null);
        appendCandidate(candidates, 'local', vertical || entity, locality || null, zh ? '本地' : 'nearby');
        appendCandidate(candidates, 'navigational', entity, locality || null, zh ? '地址 联系方式' : 'location contact');
        break;
      case 'professional_services':
        appendCandidate(candidates, 'branded', entity, zh ? '专业服务' : 'professional services');
        appendCandidate(candidates, 'local', vertical || entity, locality || null, zh ? '专业人士' : 'specialist');
        appendCandidate(candidates, 'navigational', entity, zh ? '联系方式' : 'contact');
        break;
      case 'portfolio':
        appendCandidate(candidates, 'branded', entity, zh ? '作品集' : 'portfolio');
        appendCandidate(candidates, 'informational', entity, vertical || null, zh ? '项目' : 'projects');
        appendCandidate(candidates, 'navigational', entity, zh ? '关于' : 'about');
        break;
      case 'community':
        appendCandidate(candidates, 'branded', entity, zh ? '社区' : 'community');
        appendCandidate(candidates, 'informational', vertical || entity, zh ? '社区资源' : 'community resources');
        appendCandidate(candidates, 'navigational', entity, zh ? '社区指南' : 'community guide');
        break;
      case 'nonprofit':
        appendCandidate(candidates, 'branded', entity, zh ? '公益组织' : 'nonprofit');
        appendCandidate(candidates, 'informational', entity, zh ? '使命 项目' : 'mission programs');
        appendCandidate(candidates, 'informational', vertical || entity, zh ? '公益资源' : 'nonprofit resources');
        break;
      case 'other':
      case 'unknown':
      default:
        appendCandidate(candidates, 'branded', entity);
        appendCandidate(candidates, 'informational', entity, vertical || null);
        appendCandidate(candidates, 'navigational', `site:${rootDomain}`);
        break;
    }
  }

  const seen = new Set<string>();
  const queries = candidates
    .filter(candidate => {
      const key = candidate.value.toLocaleLowerCase('en-US');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_FREE_EVIDENCE_QUERIES)
    .map((candidate, index) => ({
      id: `q${index + 1}-${candidate.intent}`,
      intent: candidate.intent,
      query: candidate.value,
    }));

  return {
    version: QUERY_PLAN_VERSION,
    generated_from: 'audit_context',
    root_domain: rootDomain,
    locale: compactTerm(context.locale, 35) || 'en',
    site_archetype: context.site_archetype,
    queries,
  };
}
