import type { ModuleResult } from './types';
import type { FetchedAuditPage } from './audit-pages';
import { registrableRoot } from './audit-pages';

export const SCORE_VERSION = '2.0.0';

export const SITE_ARCHETYPES = [
  'personal_blog', 'editorial', 'news_media', 'documentation', 'saas', 'ecommerce',
  'local_business', 'professional_services', 'portfolio', 'community', 'nonprofit',
  'other', 'unknown',
] as const;

export type SiteArchetype = typeof SITE_ARCHETYPES[number];
export type CheckStatus = 'pass' | 'fail' | 'not_applicable' | 'unknown' | 'error';
export type CheckCategory = 'seo' | 'geo';

export interface AuditEvidence {
  source: string;
  page_url?: string;
  value: string;
  confidence: number;
}

export interface AuditEntity {
  name: string;
  type: string;
  source: string;
  page_url?: string;
}

export interface AuditContext {
  site_archetype: SiteArchetype;
  industry_vertical: string | null;
  business_model: string | null;
  entity: AuditEntity | null;
  locality: string | null;
  locale: string;
  root_domain: string;
  page_types: string[];
  confidence: number;
  evidence: AuditEvidence[];
}

export interface NormalizedCheck {
  id: string;
  category: CheckCategory;
  title: string;
  status: CheckStatus;
  weight: number;
  confidence: number;
  source: string;
  page_url?: string;
  evidence: string[];
  predicted?: boolean;
}

export interface CategoryScore {
  score: number | null;
  coverage: number;
  confidence: number;
}

export interface ScoreSummary {
  score_version: string;
  status: 'complete' | 'insufficient_evidence';
  overall: CategoryScore;
  seo: CategoryScore;
  geo: CategoryScore;
}

export interface MonitorScoreBaseline {
  score_version: string;
  score: number | null;
  coverage: number;
  confidence: number;
}

export interface AuditRecommendation {
  id: string;
  template_id: string;
  category: CheckCategory;
  priority: number;
  title: string;
  page_url?: string;
  evidence: string;
  why: string;
  fix: string;
  verify: string;
  what_to_do: string;
  validation: string;
  impact: 'high' | 'medium' | 'low';
  effort: 'low' | 'medium' | 'high';
}

export interface BuildAuditContextInput {
  domain: string;
  pages: Array<Pick<FetchedAuditPage, 'url' | 'page_type' | 'status' | 'html' | 'locale'>>;
  industryVertical?: string | null;
  locality?: string | null;
  archetypeHint?: string | null;
}

type JsonObject = Record<string, unknown>;

export function isSiteArchetype(value: string | null | undefined): value is SiteArchetype {
  return !!value && (SITE_ARCHETYPES as readonly string[]).includes(value);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function flattenJsonLd(value: unknown, output: JsonObject[]): void {
  if (Array.isArray(value)) {
    for (const item of value) flattenJsonLd(item, output);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const object = value as JsonObject;
  if (object['@type']) output.push(object);
  if (object['@graph']) flattenJsonLd(object['@graph'], output);
  for (const nested of Object.values(object)) {
    if (nested !== object['@graph'] && (Array.isArray(nested) || (nested && typeof nested === 'object'))) {
      flattenJsonLd(nested, output);
    }
  }
}

function extractJsonLdNodes(pages: BuildAuditContextInput['pages']): Array<{ node: JsonObject; pageUrl: string }> {
  const nodes: Array<{ node: JsonObject; pageUrl: string }> = [];
  for (const page of pages) {
    if (page.status !== 'complete' || !page.html) continue;
    for (const match of page.html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const extracted: JsonObject[] = [];
        flattenJsonLd(JSON.parse(match[1]), extracted);
        nodes.push(...extracted.map(node => ({ node, pageUrl: page.url })));
      } catch { /* malformed schema is represented by a separate normalized check */ }
    }
  }
  return nodes;
}

function nodeTypes(node: JsonObject): string[] {
  const raw = node['@type'];
  return (Array.isArray(raw) ? raw : [raw]).filter((value): value is string => typeof value === 'string');
}

function schemaTypes(nodes: Array<{ node: JsonObject }>): Set<string> {
  return new Set(nodes.flatMap(({ node }) => nodeTypes(node)));
}

const LOCAL_TYPES = new Set([
  'LocalBusiness', 'Dentist', 'Physician', 'Hospital', 'MedicalClinic', 'Pharmacy',
  'LegalService', 'Attorney', 'Accountant', 'RealEstateAgent', 'Plumber', 'Electrician',
  'AutoRepair', 'BeautySalon', 'HairSalon', 'Restaurant', 'CafeOrCoffeeShop', 'Hotel',
  'LodgingBusiness', 'Veterinary', 'ChildCare', 'ProfessionalService', 'HealthClub',
]);

function classifyArchetype(
  types: Set<string>,
  pages: BuildAuditContextInput['pages'],
  hint?: string | null,
): { archetype: SiteArchetype; confidence: number; evidence: AuditEvidence[] } {
  const firstPage = pages.find(page => page.status === 'complete');
  const pageUrl = firstPage?.url;
  const html = pages.map(page => page.html).join('\n');
  const lower = html.toLowerCase();
  const pageTypes = new Set(pages.map(page => page.page_type));
  const hasType = (...values: string[]) => values.some(value => types.has(value));
  const hasLocal = [...types].some(type => LOCAL_TYPES.has(type) || type.endsWith('Store'));

  if (isSiteArchetype(hint)) {
    return {
      archetype: hint,
      confidence: 0.98,
      evidence: [{ source: 'request_hint', page_url: pageUrl, value: `archetype_hint=${hint}`, confidence: 0.98 }],
    };
  }
  if (hasLocal) return strong('local_business', 'LocalBusiness-compatible JSON-LD', pageUrl);
  if (hasType('SoftwareApplication', 'WebApplication')) return strong('saas', 'Software application JSON-LD', pageUrl);
  if (hasType('NewsMediaOrganization', 'NewsArticle', 'Newspaper')) return strong('news_media', 'News-specific JSON-LD', pageUrl);
  if (hasType('Product') && !hasType('SoftwareApplication', 'WebApplication')) return strong('ecommerce', 'Product JSON-LD', pageUrl);
  if (hasType('DiscussionForumPosting')) return strong('community', 'Discussion forum JSON-LD', pageUrl);
  if (hasType('NGO', 'Nonprofit501c3')) return strong('nonprofit', 'Nonprofit JSON-LD', pageUrl);
  if (hasType('Blog') && hasType('Person')) return strong('personal_blog', 'Blog and Person JSON-LD', pageUrl);
  if (hasType('ProfilePage') && hasType('Person')) return strong('portfolio', 'Person profile JSON-LD', pageUrl, 0.9);
  if (hasType('Blog', 'BlogPosting', 'Article', 'TechArticle')) return strong('editorial', 'Editorial JSON-LD', pageUrl, 0.9);
  // Text collected from representative articles and archive pages is only a
  // weak site-level signal. It must not override schema-backed homepage identity.
  if (hasType('OnlineBusiness') && /\b(forum|community)\b/i.test(lower)) {
    return strong('community', 'Online business schema with community structure', pageUrl, 0.78);
  }
  if (/\b(forum|community)\b/i.test(lower)) return strong('community', 'Community/forum page copy', pageUrl, 0.66);
  if (/\b(nonprofit|non-profit|charity|foundation)\b/i.test(lower)) {
    return strong('nonprofit', 'Nonprofit page copy', pageUrl, 0.66);
  }
  if (pageTypes.has('documentation') || /\b(documentation|developer docs|api reference)\b/i.test(lower)) {
    return strong('documentation', 'Documentation paths and navigation', pageUrl, 0.78);
  }
  if (hasType('Service') && hasType('Organization')) return strong('professional_services', 'Service and Organization JSON-LD', pageUrl, 0.82);
  if (hasType('Person') && /\b(portfolio|projects|作品集)\b/i.test(lower)) return strong('portfolio', 'Person and portfolio structure', pageUrl, 0.8);

  const sameSitePricing = /href=["'][^"']*\/(pricing|plans)(?:[\/?#"'])/i.test(html);
  const productActions = /href=["'][^"']*\/(signup|sign-up|dashboard|app)(?:[\/?#"'])/i.test(html);
  if (sameSitePricing && productActions) return strong('saas', 'Pricing and product application navigation', pageUrl, 0.68);
  if (/href=["'][^"']*\/(cart|checkout|collections|products)(?:[\/?#"'])/i.test(html)) {
    return strong('ecommerce', 'Commerce navigation', pageUrl, 0.68);
  }
  if (/\b(personal blog|my blog|个人博客|个人空间|随笔)\b/i.test(lower)) {
    return strong('personal_blog', 'Personal blog title or page copy', pageUrl, 0.66);
  }
  if (hasType('Organization', 'Corporation', 'WebSite')) return strong('other', 'Generic organization or website JSON-LD', pageUrl, 0.55);
  return { archetype: 'unknown', confidence: 0.25, evidence: [] };
}

function strong(archetype: SiteArchetype, value: string, pageUrl?: string, confidence = 0.94) {
  return {
    archetype,
    confidence,
    evidence: [{ source: 'site_structure', page_url: pageUrl, value, confidence }],
  };
}

function entityForArchetype(
  nodes: Array<{ node: JsonObject; pageUrl: string }>,
  archetype: SiteArchetype,
): AuditEntity | null {
  const priorities: string[] = archetype === 'local_business'
    ? [...LOCAL_TYPES, 'Organization', 'Corporation', 'Person', 'WebSite']
    : archetype === 'news_media'
      ? ['NewsMediaOrganization', 'Organization', 'Corporation', 'Person', 'WebSite']
      : archetype === 'saas'
        ? ['Organization', 'Corporation', 'SoftwareApplication', 'WebApplication', 'WebSite']
        : archetype === 'ecommerce'
          ? ['Organization', 'Corporation', 'Brand', 'Product', 'WebSite']
          : ['personal_blog', 'portfolio', 'editorial'].includes(archetype)
            ? ['Person', 'ProfilePage', 'Organization', 'Corporation', 'Blog', 'WebSite']
            : ['Organization', 'Corporation', 'LocalBusiness', 'Person', 'WebSite', 'Blog'];
  for (const type of priorities) {
    const match = nodes.find(({ node }) => nodeTypes(node).includes(type) && typeof node.name === 'string' && node.name.trim());
    if (!match) continue;
    return {
      name: String(match.node.name).trim().slice(0, 200),
      type,
      source: 'json_ld',
      page_url: match.pageUrl,
    };
  }
  return null;
}

function inferLocale(pages: BuildAuditContextInput['pages']): string {
  const explicit = pages.find(page => page.locale)?.locale;
  if (explicit) return explicit;
  const text = pages.map(page => page.html.replace(/<[^>]+>/g, ' ')).join(' ').slice(0, 5000);
  return /[\u3400-\u9fff]/.test(text) ? 'zh-CN' : 'en';
}

function businessModel(archetype: SiteArchetype): string | null {
  const models: Partial<Record<SiteArchetype, string>> = {
    personal_blog: 'content', editorial: 'content', news_media: 'publishing', documentation: 'documentation',
    saas: 'software', ecommerce: 'commerce', local_business: 'local_service',
    professional_services: 'professional_service', portfolio: 'portfolio', community: 'community',
    nonprofit: 'nonprofit',
  };
  return models[archetype] ?? null;
}

export function buildAuditContext(input: BuildAuditContextInput): AuditContext {
  const nodes = extractJsonLdNodes(input.pages);
  const types = schemaTypes(nodes);
  const classification = classifyArchetype(types, input.pages, input.archetypeHint);
  const entity = entityForArchetype(nodes, classification.archetype);
  const evidence = [...classification.evidence];
  if (entity) {
    evidence.push({
      source: entity.source,
      page_url: entity.page_url,
      value: `${entity.type}: ${entity.name}`,
      confidence: 0.98,
    });
  }
  const root = registrableRoot(input.domain) ?? input.domain.toLowerCase();
  const contextConfidence = clamp01(classification.confidence * 0.75 + (entity ? 0.25 : 0));
  return {
    site_archetype: classification.archetype,
    industry_vertical: input.industryVertical && input.industryVertical !== 'general' ? input.industryVertical : null,
    business_model: businessModel(classification.archetype),
    entity,
    locality: input.locality && input.locality !== 'your area' ? input.locality : null,
    locale: inferLocale(input.pages),
    root_domain: root,
    page_types: [...new Set(input.pages.map(page => page.page_type))],
    confidence: contextConfidence,
    evidence,
  };
}

export function check(input: {
  id: string;
  category: CheckCategory;
  title?: string;
  status: CheckStatus;
  weight?: number;
  confidence?: number;
  source?: string;
  pageUrl?: string;
  evidence?: string[];
  predicted?: boolean;
}): NormalizedCheck {
  return {
    id: input.id,
    category: input.category,
    title: input.title ?? input.id,
    status: input.status,
    weight: Math.max(0, input.weight ?? 1),
    confidence: clamp01(input.confidence ?? (input.status === 'unknown' || input.status === 'error' ? 0 : 1)),
    source: input.source ?? 'audit',
    page_url: input.pageUrl,
    evidence: input.evidence ?? [],
    predicted: input.predicted,
  };
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
  return {
    score: knownWeight > 0 ? Math.round(passWeight / knownWeight * 100) : null,
    coverage: clamp01(coverage),
    confidence: clamp01(confidence),
  };
}

export function scoreChecks(checks: NormalizedCheck[]): ScoreSummary {
  const seo = categoryScore(checks.filter(item => item.category === 'seo'));
  const geo = categoryScore(checks.filter(item => item.category === 'geo'));
  const all = categoryScore(checks);
  const sufficient = all.score !== null && all.coverage >= 0.4 && all.confidence >= 0.35;
  const availableCategories = [seo, geo].filter(item => item.score !== null);
  const weightedScore = availableCategories.length
    ? Math.round(availableCategories.reduce((sum, item) => sum + item.score!, 0) / availableCategories.length)
    : null;
  return {
    score_version: SCORE_VERSION,
    status: sufficient ? 'complete' : 'insufficient_evidence',
    overall: { ...all, score: sufficient ? weightedScore : null },
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
    (previous.coverage ?? 0) >= 0.4 && current.coverage >= 0.4;
}

function moduleData<T extends Record<string, unknown>>(modules: Record<string, ModuleResult>, name: string): T | null {
  const result = modules[name];
  return result?.status === 'ok' || result?.status === 'partial' ? result.data as T : null;
}

function statusFromModule(modules: Record<string, ModuleResult>, name: string): CheckStatus | null {
  const status = modules[name]?.status;
  return status === 'failed' ? 'error' : status === 'skipped' ? 'unknown' : null;
}

export function buildNormalizedChecks(
  context: AuditContext,
  pages: FetchedAuditPage[],
  modules: Record<string, ModuleResult>,
): NormalizedCheck[] {
  const zh = context.locale.toLowerCase().startsWith('zh');
  const primary = pages[0];
  const technical = moduleData<Record<string, any>>(modules, 'technical_seo');
  const content = moduleData<Record<string, any>>(modules, 'content_quality');
  const schema = moduleData<Record<string, any>>(modules, 'schema_audit');
  const robots = moduleData<Record<string, any>>(modules, 'robots_sitemap');
  const onPage = moduleData<Record<string, any>>(modules, 'on_page_seo');
  const authority = moduleData<Record<string, any>>(modules, 'authority');
  const geo = moduleData<Record<string, any>>(modules, 'geo_predicted');
  const htmlValidation = moduleData<Record<string, any>>(modules, 'html_validator');
  const commonCrawl = moduleData<Record<string, any>>(modules, 'common_crawl');
  const completedPages = pages.filter(page => page.status === 'complete');
  const failedPages = pages.filter(page => page.status === 'error');
  const primaryAvailable = primary?.status === 'complete' && !!primary.html;
  const siteEvidenceAvailable = completedPages.some(page => !!page.html);
  const schemas = new Set<string>(schema?.schemas_found ?? []);
  const output: NormalizedCheck[] = [];
  const pageUrl = primary?.url;

  output.push(check({
    id: 'seo.page_fetch', category: 'seo', title: zh ? '页面可抓取性' : 'Page fetchability', weight: 3,
    status: primary?.status === 'complete' ? 'pass' : 'error', confidence: primary?.status === 'complete' ? 1 : 0,
    source: 'page_fetch', pageUrl, evidence: primary?.status === 'complete' ? [`HTTP ${primary.status_code}`] : [primary?.error ?? 'Page fetch failed'],
  }));

  output.push(check({
    id: 'seo.sample_coverage', category: 'seo', title: zh ? '整站抽样覆盖' : 'Site sample coverage', weight: 1,
    status: completedPages.length >= (pages.length > 1 ? 2 : 1) ? 'pass' : failedPages.length ? 'error' : 'unknown',
    confidence: pages.length ? completedPages.length / pages.length : 0, source: 'site_sampler',
    evidence: [`${completedPages.length}/${pages.length} pages fetched`],
  }));

  const techError = statusFromModule(modules, 'technical_seo');
  const contentError = statusFromModule(modules, 'content_quality');
  const schemaError = statusFromModule(modules, 'schema_audit');
  const robotsError = statusFromModule(modules, 'robots_sitemap');
  const pageMeta = technical?.page_meta;
  const robotsTxt = robots?.robots_txt;
  const robotsEvidence = !robotsTxt
    ? []
    : robotsTxt.fetch_status === 'blocked'
      ? ['robots.txt fetch was blocked']
      : robotsTxt.blocks_all
        ? ['robots.txt blocks all crawlers with Disallow: /']
        : robotsTxt.blocks_googlebot
          ? ['robots.txt blocks Googlebot with Disallow: /']
          : robotsTxt.exists
            ? ['robots.txt fetched without a site-wide block']
            : ['robots.txt not found'];
  output.push(check({ id: 'seo.indexability', category: 'seo', title: zh ? '索引状态' : 'Indexability', weight: 3,
    status: !primaryAvailable ? 'unknown' : contentError ?? (content ? (content.has_noindex ? 'fail' : 'pass') : 'unknown'), source: 'content_quality', pageUrl,
    evidence: !primaryAvailable ? ['Primary page content was not available'] : content ? [content.has_noindex ? 'meta robots contains noindex' : 'No noindex directive found'] : [] }));
  output.push(check({ id: 'seo.robots', category: 'seo', title: 'robots.txt', weight: 2,
    status: robotsError ?? (robots ? (robotsTxt?.fetch_status === 'blocked' ? 'unknown' : robotsTxt?.blocks_all || robotsTxt?.blocks_googlebot ? 'fail' : robotsTxt?.exists ? 'pass' : 'fail') : 'unknown'),
    source: 'robots_sitemap', evidence: robotsEvidence }));
  output.push(check({ id: 'seo.sitemap', category: 'seo', title: 'XML sitemap', weight: 2,
    status: robotsError ?? (robots ? (robots.sitemap?.fetch_status === 'blocked' ? 'unknown' : robots.sitemap?.exists ? 'pass' : 'fail') : 'unknown'), source: 'robots_sitemap',
    evidence: robots?.sitemap?.fetch_status === 'blocked' ? ['Sitemap fetch was blocked'] : robots?.sitemap?.url ? [robots.sitemap.url] : ['No sitemap verified'] }));
  output.push(check({ id: 'seo.canonical', category: 'seo', title: 'Canonical URL', weight: 2,
    status: !primaryAvailable ? 'unknown' : techError ?? (technical ? (pageMeta?.canonical_url ? 'pass' : 'fail') : 'unknown'), source: 'technical_seo', pageUrl,
    evidence: !primaryAvailable ? ['Primary page content was not available'] : pageMeta?.canonical_url ? [pageMeta.canonical_url] : ['No canonical link found'] }));
  output.push(check({ id: 'seo.title', category: 'seo', title: zh ? '页面标题' : 'Page title', weight: 2,
    status: !primaryAvailable ? 'unknown' : techError ?? (technical ? (pageMeta?.title ? 'pass' : 'fail') : 'unknown'), source: 'technical_seo', pageUrl,
    evidence: !primaryAvailable ? ['Primary page content was not available'] : pageMeta?.title ? [pageMeta.title] : ['No title found'] }));
  output.push(check({ id: 'seo.meta_description', category: 'seo', title: 'Meta description', weight: 2,
    status: !primaryAvailable ? 'unknown' : techError ?? (technical ? (pageMeta?.description ? 'pass' : 'fail') : 'unknown'), source: 'technical_seo', pageUrl,
    evidence: !primaryAvailable ? ['Primary page content was not available'] : pageMeta?.description ? [pageMeta.description] : ['Missing meta description'] }));
  output.push(check({ id: 'seo.h1', category: 'seo', title: 'H1', weight: 2,
    status: !primaryAvailable ? 'unknown' : techError ?? (technical ? ((technical.h1_tags?.length ?? 0) === 1 ? 'pass' : 'fail') : 'unknown'), source: 'technical_seo', pageUrl,
    evidence: !primaryAvailable ? ['Primary page content was not available'] : technical ? [`${technical.h1_tags?.length ?? 0} H1 elements`] : [] }));
  output.push(check({ id: 'seo.language', category: 'seo', title: zh ? '页面语言声明' : 'Page language declaration', weight: 1,
    status: !primaryAvailable ? 'unknown' : techError ?? (technical ? (pageMeta?.lang ? 'pass' : 'fail') : 'unknown'), source: 'technical_seo', pageUrl,
    evidence: !primaryAvailable ? ['Primary page content was not available'] : pageMeta?.lang ? [`lang=${pageMeta.lang}`] : ['No html lang attribute found'] }));
  output.push(check({ id: 'seo.schema_presence', category: 'seo', title: zh ? '结构化数据存在性' : 'Structured data presence', weight: 2,
    status: !primaryAvailable ? 'unknown' : schemaError ?? (schema ? (schemas.size ? 'pass' : 'fail') : 'unknown'), source: 'schema_audit', pageUrl,
    evidence: !primaryAvailable ? ['Primary page content was not available'] : schemas.size ? [...schemas].slice(0, 10) : ['No valid JSON-LD types found'] }));
  const schemaCoverage = Object.entries(schema?.coverage ?? {})
    .filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean');
  const missingApplicableSchemas = schemaCoverage.filter(([, present]) => !present).map(([name]) => name);
  const schemaFitApplicable = context.site_archetype !== 'unknown' && schemaCoverage.length > 0;
  output.push(check({
    id: 'seo.schema_fit', category: 'seo', title: zh ? '结构化数据类型适配' : 'Structured data archetype fit', weight: 2,
    status: !primaryAvailable
      ? 'unknown'
      : schemaError ?? (!schema || !schemaFitApplicable ? 'unknown' : missingApplicableSchemas.length ? 'fail' : 'pass'),
    source: 'schema_audit', pageUrl,
    evidence: !primaryAvailable
      ? ['Primary page content was not available']
      : !schema
        ? ['Schema audit data was not available']
        : context.site_archetype === 'unknown'
          ? ['Site archetype is unknown, so schema fit cannot be evaluated']
          : schemaCoverage.length === 0
            ? [`No applicable schema coverage was reported for ${context.site_archetype}`]
            : missingApplicableSchemas.length
              ? [`Detected archetype: ${context.site_archetype}`, `Missing applicable schema: ${missingApplicableSchemas.join(', ')}`]
              : [`Detected archetype: ${context.site_archetype}`, `Applicable schema present: ${schemaCoverage.map(([name]) => name).join(', ')}`],
  }));
  output.push(check({
    id: 'seo.html_conformance', category: 'seo', title: zh ? 'HTML 规范性' : 'HTML conformance', weight: 1,
    status: htmlValidation && ['pass', 'fail', 'unknown', 'error'].includes(String(htmlValidation.status))
      ? htmlValidation.status as CheckStatus
      : statusFromModule(modules, 'html_validator') ?? 'unknown',
    confidence: Number(htmlValidation?.confidence ?? 0), source: String(htmlValidation?.source ?? 'W3C Nu HTML Checker'),
    pageUrl: typeof htmlValidation?.page_url === 'string' ? htmlValidation.page_url : pageUrl,
    evidence: Array.isArray(htmlValidation?.evidence)
      ? htmlValidation.evidence.filter((item: unknown): item is string => typeof item === 'string').slice(0, 12)
      : [modules.html_validator?.error ?? 'HTML validation was not available'],
  }));
  const sampledTitles = completedPages.map(page => page.title?.trim() ?? '');
  const allSampledTitlesPresent = sampledTitles.every(Boolean);
  output.push(check({ id: 'seo.cross_page_titles', category: 'seo', title: zh ? '跨页面标题一致性' : 'Cross-page title consistency', weight: 1,
    status: completedPages.length < 2
      ? 'not_applicable'
      : allSampledTitlesPresent && new Set(sampledTitles).size === sampledTitles.length
        ? 'pass'
        : 'fail',
    source: 'site_sampler', evidence: completedPages.map(page => `${page.url}: ${page.title ?? '(missing title)'}`).slice(0, 5) }));

  const identityApplicable = context.site_archetype !== 'unknown';
  output.push(check({ id: 'geo.entity_identity', category: 'geo', title: zh ? '实体身份清晰度' : 'Entity identity clarity', weight: 3,
    status: !siteEvidenceAvailable || !identityApplicable ? 'unknown' : context.entity ? 'pass' : 'fail', confidence: context.entity ? 0.98 : context.confidence,
    source: context.entity?.source ?? 'audit_context', pageUrl: context.entity?.page_url,
    evidence: !siteEvidenceAvailable ? ['No fetched page content was available for entity verification'] : context.entity ? [`${context.entity.type}: ${context.entity.name}`] : ['No trusted schema entity found'] }));
  const authorApplicable = ['personal_blog', 'editorial', 'news_media', 'portfolio'].includes(context.site_archetype);
  output.push(check({ id: 'geo.author_signal', category: 'geo', title: zh ? '作者归属信号' : 'Author attribution', weight: 2,
    status: !primaryAvailable ? 'unknown' : !authorApplicable ? 'not_applicable' : (schemas.has('Person') || pageMeta?.article_author ? 'pass' : 'fail'),
    source: 'schema_audit', pageUrl, evidence: !primaryAvailable ? ['Primary page content was not available'] : schemas.has('Person') ? ['Person schema found'] : pageMeta?.article_author ? [pageMeta.article_author] : ['No Person schema or article author metadata found'] }));
  const wordCount = Number(content?.word_count ?? onPage?.content?.word_count ?? 0);
  output.push(check({ id: 'geo.extractability', category: 'geo', title: zh ? '内容可提取性' : 'Content extractability', weight: 3,
    status: !primaryAvailable ? 'unknown' : contentError ?? (content ? (wordCount >= 100 ? 'pass' : 'fail') : 'unknown'), source: 'content_quality', pageUrl,
    evidence: !primaryAvailable ? ['Primary page content was not available'] : content ? [`${wordCount} extracted words/terms`] : [] }));
  output.push(check({ id: 'geo.source_links', category: 'geo', title: zh ? '来源与外部引用' : 'Sources and outbound citations', weight: 1,
    status: !primaryAvailable ? 'unknown' : contentError ?? (content ? ((content.external_links ?? 0) > 0 ? 'pass' : 'fail') : 'unknown'), source: 'content_quality', pageUrl,
    evidence: !primaryAvailable ? ['Primary page content was not available'] : content ? [`${content.external_links ?? 0} external links`] : [] }));
  output.push(check({ id: 'geo.llms_txt', category: 'geo', title: 'llms.txt', weight: 1,
    status: techError ?? (technical
      ? technical.llms_txt_status === 'error'
        ? 'unknown'
        : technical.llms_txt_present ? 'pass' : 'fail'
      : 'unknown'), source: 'technical_seo',
    evidence: technical
      ? [technical.llms_txt_status === 'error'
        ? 'llms.txt could not be verified'
        : technical.llms_txt_present ? 'llms.txt found' : 'llms.txt not found']
      : [] }));
  output.push(check({ id: 'geo.knowledge_graph', category: 'geo', title: zh ? '已验证知识图谱实体' : 'Verified knowledge-graph entity', weight: 1,
    status: statusFromModule(modules, 'authority') ?? (authority ? (authority.wikidata_id || authority.wikipedia ? 'pass' : 'unknown') : 'unknown'),
    confidence: authority?.wikidata_id || authority?.wikipedia ? 0.95 : 0, source: 'authority',
    evidence: authority?.wikidata_id ? [`Wikidata ${authority.wikidata_id}`] : authority?.wikipedia ? ['Verified Wikipedia page'] : ['No domain-verified entity found'] }));
  output.push(check({
    id: 'geo.common_crawl_presence', category: 'geo', title: zh ? 'Common Crawl 收录证据' : 'Common Crawl presence', weight: 0,
    status: commonCrawl && ['pass', 'unknown', 'error'].includes(String(commonCrawl.status))
      ? commonCrawl.status as CheckStatus
      : statusFromModule(modules, 'common_crawl') ?? 'unknown',
    confidence: Number(commonCrawl?.confidence ?? 0), source: String(commonCrawl?.source ?? 'Common Crawl Index'),
    pageUrl: typeof commonCrawl?.page_url === 'string' ? commonCrawl.page_url : `https://${context.root_domain}/`,
    evidence: Array.isArray(commonCrawl?.evidence)
      ? commonCrawl.evidence.filter((item: unknown): item is string => typeof item === 'string').slice(0, 12)
      : [modules.common_crawl?.error ?? 'Common Crawl evidence was not available'],
  }));
  output.push(check({ id: 'geo.predicted_citation', category: 'geo', title: zh ? 'Predicted AI 引用模拟' : 'Predicted AI citation simulation', weight: 0,
    status: geo?.is_reliable === false || !geo ? 'unknown' : (Number(geo.citation_rate ?? 0) >= 0.5 ? 'pass' : 'fail'),
    confidence: geo?.is_reliable === false ? 0 : 0.45, source: 'geo_predicted', predicted: true,
    evidence: geo?.citation_rate !== undefined ? [`Predicted citation rate ${Math.round(Number(geo.citation_rate) * 100)}%`] : [] }));

  return output;
}

const PRIORITIES: Record<string, number> = {
  'seo.page_fetch': 100, 'seo.indexability': 95, 'seo.robots': 90, 'seo.sitemap': 82,
  'seo.canonical': 78, 'seo.title': 75, 'seo.meta_description': 72, 'seo.h1': 70,
  'geo.entity_identity': 88, 'geo.author_signal': 76, 'geo.extractability': 74,
  'seo.schema_fit': 74, 'seo.schema_presence': 72, 'seo.html_conformance': 60,
  'geo.source_links': 55, 'geo.llms_txt': 40,
};

function recommendationCopy(checkItem: NormalizedCheck, zh: boolean) {
  const generic = zh
    ? { why: '该检查基于当前页面的可验证证据失败，会影响搜索引擎或 AI 系统理解页面。', fix: '根据检测证据修复对应页面，并保持内容与结构化数据一致。', verify: '重新审计该 URL，确认检查状态变为 pass。' }
    : { why: 'This check failed on verifiable page evidence and can reduce search or AI understanding.', fix: 'Correct the affected page using the observed evidence and keep visible content aligned with structured data.', verify: 'Re-audit the URL and confirm this check changes to pass.' };
  const copies: Record<string, { title: string; why: string; fix: string; verify: string }> = {
    'seo.indexability': zh
      ? { title: '移除意外的 noindex', why: '目标页明确声明 noindex，搜索引擎不会将它纳入正常索引。', fix: '如果页面应公开收录，移除 meta robots 或响应头中的 noindex；若本来就应隐藏，则无需修改。', verify: '检查页面源码和响应头，再用 URL Inspection 复验。' }
      : { title: 'Remove the unintended noindex directive', why: 'The target page explicitly asks search engines not to index it.', fix: 'If the page should be public, remove noindex from meta robots or response headers.', verify: 'Inspect source and headers, then re-test with URL Inspection.' },
    'seo.robots': zh
      ? { title: '修复 robots.txt 的抓取限制', why: 'robots.txt 的可验证规则阻止了站点或 Googlebot 抓取公开页面。', fix: '删除面向 User-agent: * 或 Googlebot 的意外 Disallow: /；只保留确实需要阻止的私有路径。', verify: '直接访问 robots.txt，用 Google robots.txt Tester 或重新审计确认公开页面不再被阻止。' }
      : { title: 'Remove the blocking robots.txt rule', why: 'A verified robots.txt rule prevents the site or Googlebot from crawling public pages.', fix: 'Remove unintended Disallow: / rules for User-agent: * or Googlebot, keeping only paths that should remain private.', verify: 'Open robots.txt and re-test until public pages are no longer blocked.' },
    'seo.sitemap': zh
      ? { title: '发布并声明 XML sitemap', why: '未能验证站点地图，代表页面的发现和更新信号会更弱。', fix: '生成包含 canonical URL 的 sitemap.xml，并在 robots.txt 中添加 Sitemap 指令。', verify: '访问 sitemap URL，确认返回有效 XML 后重新审计。' }
      : { title: 'Publish and declare an XML sitemap', why: 'No sitemap could be verified, weakening page discovery and update signals.', fix: 'Publish sitemap.xml with canonical URLs and reference it from robots.txt.', verify: 'Open the sitemap URL, validate its XML, and re-run the audit.' },
    'seo.canonical': zh
      ? { title: '为目标页添加 canonical', why: '页面没有声明首选 URL，重复内容信号可能被拆分。', fix: '在 head 中添加指向最终公开 URL 的 rel="canonical"。', verify: '查看渲染后的 head，并重新审计该 URL。' }
      : { title: 'Add a canonical URL to the target page', why: 'The page does not declare its preferred URL, so duplicate signals may be split.', fix: 'Add rel="canonical" in head pointing to the final public URL.', verify: 'Inspect the rendered head and re-audit this URL.' },
    'seo.title': zh
      ? { title: '为目标页添加唯一标题', why: '页面源码中没有可验证的 title，搜索结果和浏览器无法获得稳定的页面名称。', fix: '在 head 中添加简洁、唯一且与可见内容一致的 title；不要堆砌关键词。', verify: '查看页面源码中的 title，并重新审计该 URL。' }
      : { title: 'Add a unique page title', why: 'No verifiable title was found in the page source, leaving search results without a stable page name.', fix: 'Add a concise, unique title aligned with the visible content and avoid keyword stuffing.', verify: 'Inspect the title in page source and re-audit this URL.' },
    'seo.meta_description': zh
      ? { title: '补充 Meta description', why: '该页面缺少可供搜索结果和 AI 摘要使用的简洁描述。', fix: '添加与页面内容一致、具体且不虚构业务信息的 meta description。', verify: '查看页面源码中的 description，再重新审计。' }
      : { title: 'Add a specific meta description', why: 'The page lacks a concise description for search snippets and AI summaries.', fix: 'Add a factual meta description aligned with the visible page content.', verify: 'Inspect the description in page source and re-run the audit.' },
    'seo.h1': zh
      ? { title: '修复页面主标题结构', why: '页面没有且仅有一个可验证的 H1，主主题层级不清晰。', fix: '让每个页面保留一个描述该页核心主题的 H1，并将其他章节标题改为 H2/H3。', verify: '检查渲染后的标题层级，确认只有一个 H1 后重新审计。' }
      : { title: 'Fix the primary heading structure', why: 'The page does not have exactly one verifiable H1, making its main topic ambiguous.', fix: 'Keep one H1 that describes the page topic and use H2/H3 for subordinate sections.', verify: 'Inspect the rendered heading outline and re-audit after exactly one H1 remains.' },
    'seo.schema_fit': zh
      ? { title: '补齐与站点类型匹配的结构化数据', why: '页面已有结构化数据，但缺少证据中列出的适用类型，搜索和 AI 系统无法完整理解站点身份或页面关系。', fix: '只补充证据中列出的缺失 JSON-LD 类型和页面已经公开的真实字段，不添加与站点类型或可见内容无关的标记。', verify: '使用 Schema.org Validator 验证，并重新审计确认 schema fit 变为 pass。' }
      : { title: 'Complete the structured data for this site archetype', why: 'Structured data exists, but applicable types listed in the evidence are missing, leaving the site identity or page relationships incomplete.', fix: 'Add only the missing JSON-LD types listed in the evidence and fields supported by visible content.', verify: 'Validate with Schema.org Validator and re-audit until schema fit passes.' },
    'seo.html_conformance': zh
      ? { title: '修复已验证的 HTML 错误', why: 'W3C Nu 在目标页源码中发现了具体的 HTML 错误，可能妨碍解析器稳定理解页面结构。', fix: '按证据中的行号和错误信息修复源码；警告本身不视为失败。', verify: '重新运行 W3C Nu 检查并确认错误数为 0，再重新审计。' }
      : { title: 'Fix the validated HTML errors', why: 'W3C Nu found concrete HTML errors in the target source that can make document structure less reliable to parsers.', fix: 'Correct the source at the reported lines; warnings alone are not treated as failures.', verify: 'Re-run W3C Nu until the error count is zero, then re-audit.' },
    'geo.entity_identity': zh
      ? { title: '用可信 schema 明确站点实体', why: '没有找到可验证的 Person、Organization 或适用实体名称。', fix: '按站点类型添加 Person 或 Organization JSON-LD，名称和 URL 必须与页面可见信息一致。', verify: '使用 Schema.org Validator 验证，再重新审计。' }
      : { title: 'Define the site entity with trusted schema', why: 'No verifiable Person, Organization, or applicable entity name was found.', fix: 'Add Person or Organization JSON-LD appropriate to the site, matching visible names and URLs.', verify: 'Validate with Schema.org Validator and re-run the audit.' },
    'geo.author_signal': zh
      ? { title: '补充作者归属信息', why: '当前内容没有可靠的作者实体或文章作者元数据。', fix: '在文章可见区域标明作者，并用 Person 与 Article author JSON-LD 连接。', verify: '验证 Article.author 指向 Person，并重新审计代表文章。' }
      : { title: 'Add explicit author attribution', why: 'The content lacks a reliable author entity or article author metadata.', fix: 'Show the author visibly and connect Article.author to Person JSON-LD.', verify: 'Validate Article.author and re-audit a representative article.' },
    'geo.extractability': zh
      ? { title: '让核心内容可直接提取', why: '抓取到的正文证据不足，搜索和 AI 系统可能只看到空壳。', fix: '将标题、摘要和核心正文输出到服务端 HTML，并使用清晰的 H1/H2 结构。', verify: '禁用 JavaScript 查看页面源码，确认核心正文仍存在后重新审计。' }
      : { title: 'Make core content directly extractable', why: 'Too little body evidence was fetched, so search and AI systems may see an empty shell.', fix: 'Render the title, summary, and core copy in server HTML with clear H1/H2 structure.', verify: 'Disable JavaScript, inspect source, and re-run the audit.' },
  };
  return copies[checkItem.id] ?? { title: checkItem.title, ...generic };
}

export function buildRecommendations(context: AuditContext, checks: NormalizedCheck[]): AuditRecommendation[] {
  const zh = context.locale.toLowerCase().startsWith('zh');
  return checks
    .filter(item => item.status === 'fail' && !item.predicted)
    .map(item => {
      const copy = recommendationCopy(item, zh);
      const priority = PRIORITIES[item.id] ?? Math.round(item.weight * item.confidence * 10);
      const evidence = item.evidence.join('; ') || (zh ? '该页面未满足检查条件' : 'The page did not satisfy this check');
      const impact: AuditRecommendation['impact'] = priority >= 80 ? 'high' : priority >= 55 ? 'medium' : 'low';
      const effort: AuditRecommendation['effort'] = priority >= 90 ? 'medium' : 'low';
      return {
        id: item.id,
        template_id: item.id,
        category: item.category,
        priority,
        title: copy.title,
        page_url: item.page_url,
        evidence,
        why: copy.why,
        fix: copy.fix,
        verify: copy.verify,
        what_to_do: copy.fix,
        validation: copy.verify,
        impact,
        effort,
      };
    })
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
    .slice(0, 8);
}
