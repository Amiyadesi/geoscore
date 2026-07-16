import { CHECK_SEVERITIES, CHECK_TITLES, SCORE_POLICY, SCORE_VERSION, type CategoryScore, type CheckCategory, type CheckSeverity, type CheckStatus, type MonitorScoreBaseline, type NormalizedCheck, type ScoreCapReason, type ScoreSummary } from './audit-contract';
import { clamp01 } from './audit-context';

export function check(input: {
  id: string;
  category: CheckCategory;
  title?: string;
  status: CheckStatus;
  severity?: CheckSeverity;
  weight?: number;
  confidence?: number;
  source?: string;
  pageUrl?: string;
  evidence?: string[];
  predicted?: boolean;
}): NormalizedCheck {
  const fallbackTitle = input.title ?? input.id;
  const localizedTitle = CHECK_TITLES[input.id] ?? { en: fallbackTitle, zh: fallbackTitle };
  const severity = input.predicted ? 'info' : input.severity ?? CHECK_SEVERITIES[input.id] ?? 'minor';
  return {
    id: input.id,
    category: input.category,
    title: fallbackTitle,
    localized_title: localizedTitle,
    status: input.status,
    severity,
    weight: input.predicted || severity === 'info' ? 0 : Math.max(0, input.weight ?? 1),
    confidence: clamp01(input.confidence ?? (input.status === 'unknown' || input.status === 'error' ? 0 : 1)),
    source: input.source ?? 'audit',
    page_url: input.pageUrl,
    evidence: input.evidence ?? [],
    predicted: input.predicted,
  };
}

function scoreCapReasons(
  applicable: NormalizedCheck[],
  coverage: number,
  confidence: number,
): ScoreCapReason[] {
  const reasons: ScoreCapReason[] = [];
  const failures = applicable.filter(item => item.status === 'fail');
  const addFailureCap = (severity: CheckSeverity, code: ScoreCapReason['code'], cap: number) => {
    const checkIds = failures.filter(item => item.severity === severity).map(item => item.id);
    if (checkIds.length) reasons.push({ code, cap, check_ids: checkIds });
  };
  const repeatedCap = (severity: 'critical' | 'major', count: number) => {
    const base = SCORE_POLICY.severity_caps[severity];
    const rule = SCORE_POLICY.repeated_failure_caps[severity];
    return Math.max(rule.floor, base - Math.max(0, count - 1) * rule.step);
  };
  const criticalCount = failures.filter(item => item.severity === 'critical').length;
  const majorCount = failures.filter(item => item.severity === 'major').length;
  addFailureCap('critical', 'CRITICAL_FAILURE', repeatedCap('critical', criticalCount));
  addFailureCap('major', 'MAJOR_FAILURE', repeatedCap('major', majorCount));
  addFailureCap('minor', 'MINOR_FAILURE', SCORE_POLICY.severity_caps.minor);

  const coverageCap = SCORE_POLICY.coverage_caps.find(rule => coverage < rule.below);
  if (coverageCap) reasons.push({ code: 'LOW_COVERAGE', cap: coverageCap.cap, check_ids: [] });

  const confidenceCap = SCORE_POLICY.confidence_caps.find(rule => confidence < rule.below);
  if (confidenceCap) reasons.push({ code: 'LOW_CONFIDENCE', cap: confidenceCap.cap, check_ids: [] });
  return reasons;
}

function categoryScore(checks: NormalizedCheck[]): CategoryScore {
  const applicable = checks.filter(item => item.status !== 'not_applicable' && !item.predicted && item.weight > 0);
  const known = applicable.filter(item => item.status === 'pass' || item.status === 'fail');
  const totalWeight = applicable.reduce((sum, item) => sum + item.weight, 0);
  const knownWeight = known.reduce((sum, item) => sum + item.weight, 0);
  const passWeight = known.filter(item => item.status === 'pass').reduce((sum, item) => sum + item.weight, 0);
  const coverage = totalWeight > 0 ? knownWeight / totalWeight : 0;
  const confidence = knownWeight > 0
    ? known.reduce((sum, item) => sum + item.confidence * item.weight, 0) / knownWeight
    : 0;
  const rawScore = knownWeight > 0 ? Math.round(passWeight / knownWeight * 100) : null;
  const normalizedCoverage = clamp01(coverage);
  const normalizedConfidence = clamp01(confidence);
  const capReasons = scoreCapReasons(applicable, normalizedCoverage, normalizedConfidence);
  const cap = capReasons.reduce((value, reason) => Math.min(value, reason.cap), 100);
  return {
    score: rawScore === null ? null : Math.min(rawScore, cap),
    raw_score: rawScore,
    coverage: normalizedCoverage,
    confidence: normalizedConfidence,
    cap,
    cap_reasons: capReasons,
  };
}

export function scoreChecks(checks: NormalizedCheck[]): ScoreSummary {
  const seo = categoryScore(checks.filter(item => item.category === 'seo'));
  const geo = categoryScore(checks.filter(item => item.category === 'geo'));
  const all = categoryScore(checks);
  const sufficient = all.score !== null &&
    all.coverage >= SCORE_POLICY.minimum_overall_coverage &&
    all.confidence >= SCORE_POLICY.minimum_overall_confidence;
  const availableCategories = [
    { score: seo.score, raw: seo.raw_score, weight: 0.55 },
    { score: geo.score, raw: geo.raw_score, weight: 0.45 },
  ].filter(item => item.score !== null);
  const availableWeight = availableCategories.reduce((sum, item) => sum + item.weight, 0);
  const weightedScore = availableCategories.length
    ? Math.round(availableCategories.reduce((sum, item) => sum + item.score! * item.weight, 0) / availableWeight)
    : null;
  const weightedRawScore = availableCategories.length
    ? Math.round(availableCategories.reduce((sum, item) => sum + item.raw! * item.weight, 0) / availableWeight)
    : null;
  return {
    score_version: SCORE_VERSION,
    status: sufficient ? 'complete' : 'insufficient_evidence',
    overall: {
      ...all,
      raw_score: weightedRawScore,
      score: sufficient && weightedScore !== null ? Math.min(weightedScore, all.cap) : null,
    },
    seo,
    geo,
  };
}

export function monitorBaselineFromSummary(summary: ScoreSummary): MonitorScoreBaseline {
  return {
    score_version: summary.score_version,
    score: summary.overall.score,
    coverage: summary.overall.coverage,
    confidence: summary.overall.confidence,
  };
}

export function canCompareMonitorBaseline(
  previous: Partial<MonitorScoreBaseline> | null,
  current: MonitorScoreBaseline,
): previous is MonitorScoreBaseline {
  return !!previous && previous.score_version === current.score_version &&
    typeof previous.score === 'number' && typeof current.score === 'number' &&
    (previous.coverage ?? 0) >= SCORE_POLICY.minimum_overall_coverage &&
    current.coverage >= SCORE_POLICY.minimum_overall_coverage &&
    (previous.confidence ?? 0) >= SCORE_POLICY.minimum_overall_confidence &&
    current.confidence >= SCORE_POLICY.minimum_overall_confidence;
}
