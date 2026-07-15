import type {
  AuditRecommendation,
  CheckCategory,
  CheckSeverity,
  NormalizedCheck,
} from './audit-core';
import type { EvidenceStage } from './query-evidence';

export interface RepairGroupEvidenceItem {
  check_id: string;
  page_url: string | null;
  source: string;
  confidence: number;
  observed: string[];
}

export interface RepairGroupTask {
  recommendation_id: string;
  check_id: string;
  title: string;
  why: string;
  fix: string;
  verify: string;
  localized: AuditRecommendation['localized'];
}

export interface RepairGroup {
  id: string;
  stage: EvidenceStage;
  page_url: string | null;
  category: CheckCategory | 'mixed';
  severity: CheckSeverity;
  priority: number;
  check_ids: string[];
  evidence_items: RepairGroupEvidenceItem[];
  tasks: RepairGroupTask[];
  verification_steps: string[];
}

const DISCOVERY = new Set([
  'seo.robots', 'seo.sitemap', 'seo.rss_feed', 'geo.llms_txt',
  'geo.common_crawl_presence', 'geo.ai_crawler_policy',
]);
const FETCH = new Set([
  'seo.page_fetch', 'seo.https_transport', 'seo.response_time', 'seo.mobile_usability',
  'seo.lab_performance', 'seo.lab_lcp', 'seo.lab_cls', 'seo.lab_tbt',
  'seo.cwv_lcp', 'seo.cwv_cls', 'seo.cwv_inp', 'seo.cwv_fcp', 'seo.cwv_ttfb',
]);
const RETRIEVAL = new Set([
  'seo.canonical', 'seo.hreflang', 'seo.open_graph', 'seo.internal_links',
  'seo.cross_page_titles', 'seo.sample_coverage',
]);
const SELECTION = new Set([
  'geo.entity_identity', 'geo.entity_consistency', 'geo.author_signal',
  'geo.cross_page_consistency', 'geo.knowledge_graph',
]);
const ATTRIBUTION = new Set([
  'geo.claim_source_support', 'geo.statistic_provenance', 'geo.source_links',
]);

export function repairStageForCheck(checkId: string): EvidenceStage {
  if (DISCOVERY.has(checkId)) return 'discovery';
  if (FETCH.has(checkId)) return 'fetch';
  if (RETRIEVAL.has(checkId)) return 'retrieval';
  if (SELECTION.has(checkId)) return 'selection';
  if (ATTRIBUTION.has(checkId)) return 'attribution';
  return 'parse';
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function severityRank(severity: CheckSeverity): number {
  return { critical: 4, major: 3, minor: 2, info: 1 }[severity];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function buildRepairGroups(
  checks: NormalizedCheck[],
  recommendations: AuditRecommendation[],
): RepairGroup[] {
  const checkById = new Map(checks.map(check => [check.id, check]));
  const buckets = new Map<string, Array<{ check: NormalizedCheck; recommendation: AuditRecommendation }>>();

  for (const recommendation of recommendations) {
    const check = checkById.get(recommendation.id);
    if (!check || check.status !== 'fail' || check.predicted === true || check.weight <= 0) continue;
    const stage = repairStageForCheck(check.id);
    const pageUrl = check.page_url ?? recommendation.page_url ?? null;
    const key = `${stage}\u0000${pageUrl ?? 'site'}`;
    const items = buckets.get(key) ?? [];
    items.push({ check, recommendation });
    buckets.set(key, items);
  }

  return [...buckets.entries()].map(([key, items]) => {
    items.sort((left, right) => right.recommendation.priority - left.recommendation.priority ||
      left.check.id.localeCompare(right.check.id));
    const stage = repairStageForCheck(items[0].check.id);
    const pageUrl = items[0].check.page_url ?? items[0].recommendation.page_url ?? null;
    const categories = unique(items.map(item => item.check.category));
    const severity = items.map(item => item.check.severity)
      .sort((left, right) => severityRank(right) - severityRank(left))[0];
    const checkIds = items.map(item => item.check.id);
    return {
      id: `repair-${stage}-${stableHash(key)}`,
      stage,
      page_url: pageUrl,
      category: categories.length === 1 ? categories[0] as CheckCategory : 'mixed',
      severity,
      priority: Math.max(...items.map(item => item.recommendation.priority)),
      check_ids: checkIds,
      evidence_items: items.map(item => ({
        check_id: item.check.id,
        page_url: item.check.page_url ?? item.recommendation.page_url ?? null,
        source: item.check.source,
        confidence: item.check.confidence,
        observed: item.check.evidence.map(evidence => String(evidence).slice(0, 1000)),
      })),
      tasks: items.map(item => ({
        recommendation_id: item.recommendation.id,
        check_id: item.check.id,
        title: item.recommendation.title,
        why: item.recommendation.why,
        fix: item.recommendation.fix,
        verify: item.recommendation.verify,
        localized: item.recommendation.localized,
      })),
      verification_steps: unique(items.map(item => item.recommendation.verify)),
    } satisfies RepairGroup;
  }).sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
}
