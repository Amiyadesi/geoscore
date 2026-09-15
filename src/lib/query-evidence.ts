import type { AuditContext, SiteArchetype } from './audit-core';

export const EVIDENCE_SNAPSHOT_VERSION = '1.0.0' as const;
export const QUERY_PLAN_VERSION = '1.1.0' as const;
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

/**
 * Specificity rungs, from the vaguest field probe to a navigational query.
 *
 * Rungs 0 and 1 deliberately exclude the brand and the root domain: they are the
 * only probes that can show whether the target is observable to a searcher who
 * does not already know it exists. Rung numbers grow with specificity, so a
 * smaller number is a vaguer query.
 */
export type EvidenceQueryRung = 0 | 1 | 2 | 3;

export type EvidenceQueryRungLabel =
  | 'generic'
  | 'field'
  | 'branded'
  | 'navigational';

export const EVIDENCE_RUNG_LABELS: Record<EvidenceQueryRung, EvidenceQueryRungLabel> = {
  0: 'generic',
  1: 'field',
  2: 'branded',
  3: 'navigational',
};

/** Rungs that never mention the brand, so they measure reach rather than recall of the name. */
export const MAX_BRAND_FREE_RUNG: EvidenceQueryRung = 1;

export function isBrandFreeRung(rung: EvidenceQueryRung): boolean {
  return rung <= MAX_BRAND_FREE_RUNG;
}

export interface PlannedEvidenceQuery {
  id: string;
  intent: EvidenceQueryIntent;
  query: string;
  rung: EvidenceQueryRung;
  rung_label: EvidenceQueryRungLabel;
  brand_free: boolean;
}

/** A brand-free probe the plan knows how to run but does not spend the free budget on. */
export interface UnprobedEvidenceRung {
  rung: EvidenceQueryRung;
  rung_label: EvidenceQueryRungLabel;
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
  /**
   * Rungs this plan generated but did not run because the free budget is three
   * queries. They are instructions, not observations: nothing here was measured.
   */
  unprobed_rungs: UnprobedEvidenceRung[];
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

/** One planned query plus what the dated snapshot observed for it. */
export interface EvidenceRungObservation {
  rung: EvidenceQueryRung;
  rung_label: EvidenceQueryRungLabel;
  brand_free: boolean;
  intent: EvidenceQueryIntent;
  query: string;
  observed: boolean;
  observed_sources: number;
  observed_providers: string[];
}

/**
 * How vague a query still surfaced the target, as measured on one dated
 * snapshot. Never a score input and never a ranking promise.
 */
export interface EvidenceAnchoringSummary {
  /**
   * The vaguest brand-free rung the target was observed at, or `null` when no
   * brand-free probe returned it. `null` describes this snapshot only; it does
   * not predict that reach cannot improve.
   */
  vaguest_brand_free_rung_observed: EvidenceQueryRung | null;
  brand_free_observed: boolean;
  rungs: EvidenceRungObservation[];
  /** Probes this plan knows how to run but did not spend budget on. */
  unprobed_rungs: UnprobedEvidenceRung[];
  /** The vaguest unprobed probe, i.e. the next thing worth measuring. */
  next_probe: UnprobedEvidenceRung | null;
  limitations: string[];
}

/**
 * Reads anchoring off a completed snapshot. `matchedQueries` resolves which
 * planned queries a source record satisfied, because a single provider result
 * can match several probes.
 */
export function buildAnchoringSummary(
  plan: EvidenceQueryPlan,
  sources: EvidenceMapSource[],
  matchedQueries: (source: EvidenceMapSource) => string[],
): EvidenceAnchoringSummary {
  const targetSources = sources.filter(source => source.target_domain);
  const rungs: EvidenceRungObservation[] = plan.queries.map(query => {
    const key = query.query.toLocaleLowerCase('en-US');
    const matched = targetSources.filter(source =>
      matchedQueries(source).some(item => item.toLocaleLowerCase('en-US') === key));
    return {
      rung: query.rung,
      rung_label: query.rung_label,
      brand_free: query.brand_free,
      intent: query.intent,
      query: query.query,
      observed: matched.length > 0,
      observed_sources: matched.length,
      observed_providers: [...new Set(matched.map(source => source.provider))].sort(),
    };
  });

  const brandFreeObserved = rungs.filter(rung => rung.brand_free && rung.observed);
  return {
    vaguest_brand_free_rung_observed: brandFreeObserved.length
      ? brandFreeObserved.reduce((best, rung) => (rung.rung < best.rung ? rung : best)).rung
      : null,
    brand_free_observed: brandFreeObserved.length > 0,
    rungs,
    unprobed_rungs: plan.unprobed_rungs,
    next_probe: [...plan.unprobed_rungs].sort((left, right) => left.rung - right.rung)[0] ?? null,
    limitations: [
      'Rung wording is a deterministic probe built from the audit context, not a claim about where the target belongs.',
      'Observed means the target domain appeared in a dated provider result for that probe; it does not prove an assistant cited it.',
      'A probe with no target result can also mean the provider has no coverage for that wording.',
    ],
  };
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
  anchoring: EvidenceAnchoringSummary;
  limitations: string[];
}

interface QueryCandidate {
  intent: EvidenceQueryIntent;
  value: string;
  /** Set only for generated rung probes; otherwise derived from the value and intent. */
  rung?: EvidenceQueryRung;
}

/**
 * The role word a searcher would add to a field name. It stays deliberately
 * generic because the audit has no evidence about the target's real title, and
 * the probe wording is always shown to the user verbatim.
 */
const GENERIC_ROLE_WORDS: Partial<Record<SiteArchetype, { zh: string; en: string }>> = {
  personal_blog: { zh: '作者', en: 'author' },
  editorial: { zh: '作者', en: 'author' },
  portfolio: { zh: '创作者', en: 'creator' },
  documentation: { zh: '维护者', en: 'maintainers' },
  saas: { zh: '厂商', en: 'vendors' },
  ecommerce: { zh: '商家', en: 'stores' },
  local_business: { zh: '商家', en: 'businesses' },
  professional_services: { zh: '专业人士', en: 'specialists' },
  community: { zh: '社区', en: 'communities' },
  nonprofit: { zh: '公益组织', en: 'nonprofits' },
  news_media: { zh: '媒体', en: 'publishers' },
};

const DEFAULT_ROLE_WORD = { zh: '从业者', en: 'practitioners' };

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

function appendRungCandidate(
  candidates: QueryCandidate[],
  rung: EvidenceQueryRung,
  intent: EvidenceQueryIntent,
  ...parts: Array<string | null | undefined>
): void {
  const before = candidates.length;
  appendCandidate(candidates, intent, ...parts);
  if (candidates.length > before) candidates[candidates.length - 1].rung = rung;
}

function mentionsTarget(value: string, entity: string, rootDomain: string): boolean {
  const haystack = value.toLocaleLowerCase('en-US');
  return [entity, rootDomain]
    .map(item => item.toLocaleLowerCase('en-US'))
    .filter(item => item.length >= 2)
    .some(needle => haystack.includes(needle));
}

function candidateRung(candidate: QueryCandidate, entity: string, rootDomain: string): EvidenceQueryRung {
  if (candidate.rung !== undefined) return candidate.rung;
  if (!mentionsTarget(candidate.value, entity, rootDomain)) return 1;
  return candidate.intent === 'navigational' ? 3 : 2;
}

/**
 * Classifies an arbitrary query string against the audit context. Monitoring
 * rebuilds a plan from stored rows, which no longer carry the generated rung,
 * so the classification is recomputed from the text instead of guessed.
 */
export function classifyEvidenceQuery(
  query: string,
  intent: EvidenceQueryIntent,
  context: Pick<AuditContext, 'entity' | 'root_domain'>,
): { rung: EvidenceQueryRung; rung_label: EvidenceQueryRungLabel; brand_free: boolean } {
  const entity = compactTerm(context.entity?.name, 120);
  const rootDomain = compactTerm(context.root_domain, 253);
  const rung = candidateRung({ intent, value: query }, entity, rootDomain);
  return { rung, rung_label: EVIDENCE_RUNG_LABELS[rung], brand_free: isBrandFreeRung(rung) };
}

/**
 * The vaguest probes the audit can honestly build: the role word a searcher
 * would add to the field the site already declares. Without a declared field
 * there is nothing to probe, so no probe is invented.
 */
function genericRungCandidates(
  archetype: SiteArchetype,
  vertical: string,
  locality: string,
  zh: boolean,
): QueryCandidate[] {
  if (!vertical) return [];
  const role = GENERIC_ROLE_WORDS[archetype] ?? DEFAULT_ROLE_WORD;
  const candidates: QueryCandidate[] = [];
  appendRungCandidate(candidates, 1, 'informational', locality || null, vertical, zh ? role.zh : role.en);
  appendRungCandidate(candidates, 0, 'informational', locality || null, zh ? role.zh : role.en);
  return candidates;
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

  candidates.push(...genericRungCandidates(context.site_archetype, vertical, locality, zh));

  const seen = new Set<string>();
  const unique = candidates.filter(candidate => {
    const key = candidate.value.toLocaleLowerCase('en-US');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Selection order is a product decision, not an optimization: the brand-anchored
  // query comes first because the answer snapshot and the "is the brand itself
  // observable" reading are built on it, then exactly one brand-free field probe,
  // then the navigational query that stands in for direct-name reach. Deeper
  // brand-free rungs stay unprobed so the free plan keeps its three-query budget.
  const rungOf = (candidate: QueryCandidate) => candidateRung(candidate, entity, rootDomain);
  const anchored = unique.filter(candidate => !isBrandFreeRung(rungOf(candidate)));
  const navigational = unique.filter(candidate => candidate.intent === 'navigational');
  const generatedRung = (rung: EvidenceQueryRung) => candidates.find(candidate => candidate.rung === rung);

  const selected: QueryCandidate[] = [];
  const select = (candidate?: QueryCandidate) => {
    if (!candidate || selected.length >= MAX_FREE_EVIDENCE_QUERIES) return;
    const key = candidate.value.toLocaleLowerCase('en-US');
    if (selected.some(item => item.value.toLocaleLowerCase('en-US') === key)) return;
    selected.push(candidate);
  };
  [anchored[0], generatedRung(1), navigational[0], anchored[1]].forEach(select);
  unique.forEach(select);

  const selectedValues = new Set(selected.map(candidate => candidate.value.toLocaleLowerCase('en-US')));
  const unprobedRungs: UnprobedEvidenceRung[] = candidates
    .filter(candidate => candidate.rung !== undefined && !selectedValues.has(candidate.value.toLocaleLowerCase('en-US')))
    .map(candidate => ({
      rung: candidate.rung as EvidenceQueryRung,
      rung_label: EVIDENCE_RUNG_LABELS[candidate.rung as EvidenceQueryRung],
      intent: candidate.intent,
      query: candidate.value,
    }));

  const queries: PlannedEvidenceQuery[] = selected.map((candidate, index) => {
    const rung = rungOf(candidate);
    return {
      id: `q${index + 1}-${candidate.intent}`,
      intent: candidate.intent,
      query: candidate.value,
      rung,
      rung_label: EVIDENCE_RUNG_LABELS[rung],
      brand_free: isBrandFreeRung(rung),
    };
  });

  return {
    version: QUERY_PLAN_VERSION,
    generated_from: 'audit_context',
    root_domain: rootDomain,
    locale: compactTerm(context.locale, 35) || 'en',
    site_archetype: context.site_archetype,
    queries,
    unprobed_rungs: unprobedRungs,
  };
}
