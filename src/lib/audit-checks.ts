import type { FetchedAuditPage } from './audit-pages';
import type { ModuleResult } from './types';
import { contentPagesFor, directAnswerApplicable, geoPageSignals, normalizedEntityName, normalizedSiteLabel, sampledEntitySignals } from './audit-context';
import type { AuditContext, CheckStatus, NormalizedCheck } from './audit-contract';
import { check } from './audit-scoring';
import { isTextLengthGood, textLengthRange } from './metadata-quality';

interface NamedAuditCheck {
  name?: string;
  rule?: string;
  passed: boolean;
  detail?: string;
}

interface PageMetaEvidence {
  canonical_url?: string;
  title?: string;
  description?: string;
  lang?: string;
  article_author?: string;
}

interface CrawlerGroupEvidence {
  blocked?: unknown[];
}

interface CrawlerPolicyEvidence {
  version?: string;
  robots_status?: string;
  search_index?: CrawlerGroupEvidence;
  training?: CrawlerGroupEvidence;
  user_fetch?: CrawlerGroupEvidence;
}

interface TechnicalAuditData {
  checks?: NamedAuditCheck[];
  page_meta?: PageMetaEvidence;
  h1_tags?: unknown[];
  image_audit?: {
    total?: number;
    missing_alt?: number;
    missing_alt_srcs?: string[];
  };
  response_time_ms?: number;
  transport_evidence_available?: boolean;
  render_blocking_scripts?: number;
  compression?: { enabled?: boolean; encoding?: string };
  page_weight_kb?: number;
  dom_element_count?: number;
  security_headers?: { score?: number };
  rss_feed_url?: string;
  blocked_ai_bots?: unknown[];
  crawler_policy_v2?: CrawlerPolicyEvidence;
  llms_txt_status?: string;
  llms_txt_present?: boolean;
}

interface ContentAuditData {
  has_noindex?: boolean;
  word_count?: number;
  external_links?: number;
}

interface SchemaAuditData {
  schemas_found?: string[];
  coverage?: Record<string, boolean>;
}

interface FetchPresenceEvidence {
  fetch_status?: string;
  exists?: boolean;
  url?: string;
}

interface RobotsAuditData {
  robots_txt?: FetchPresenceEvidence & {
    blocks_all?: boolean;
    blocks_googlebot?: boolean;
  };
  sitemap?: FetchPresenceEvidence;
}

interface OnPageAuditData {
  headings?: { skipped_level?: boolean };
  links?: { internal?: number };
  images?: {
    total?: number;
    missing_alt?: number;
    missing_dimensions?: number;
    responsive?: number;
  };
  content?: { word_count?: number };
}

interface AccessibilityAuditData {
  wcag_checks?: NamedAuditCheck[];
}

interface MobileAuditData {
  has_viewport_meta?: boolean;
  viewport_content?: string;
  tap_target_issues?: number;
  font_size_ok?: boolean;
  has_responsive_images?: boolean;
  meaningful_image_count?: number;
}

interface CruxMetricEvidence {
  p75?: number;
}

type CruxMetric = 'lcp' | 'cls' | 'inp' | 'fcp' | 'ttfb';

interface CruxAuditData {
  has_data?: boolean;
  issues?: string[];
  lcp?: CruxMetricEvidence;
  cls?: CruxMetricEvidence;
  inp?: CruxMetricEvidence;
  fcp?: CruxMetricEvidence;
  ttfb?: CruxMetricEvidence;
}

export interface LighthouseEvidence {
  score?: number | null;
  lcp_ms?: number | null;
  cls?: number | null;
  tbt_ms?: number | null;
}

interface AuthorityAuditData {
  wikidata_id?: string;
  wikipedia?: string;
}

interface PredictedGeoData {
  is_reliable?: boolean;
  citation_rate?: number;
}

interface ExternalCheckEvidence {
  status?: string;
  confidence?: number;
  source?: string;
  page_url?: string;
  evidence?: unknown[];
}

function moduleData<T extends object>(modules: Record<string, ModuleResult>, name: string): T | null {
  const result = modules[name];
  const available = result?.status === 'ok' || result?.status === 'partial';
  return available && result.data && typeof result.data === 'object' ? result.data as T : null;
}

function statusFromModule(modules: Record<string, ModuleResult>, name: string): CheckStatus | null {
  const status = modules[name]?.status;
  return status === 'failed' ? 'error' : status === 'skipped' ? 'unknown' : null;
}

export function buildLighthouseChecks(
  lighthouse: LighthouseEvidence | null,
  pageUrl?: string,
  unavailableStatus: CheckStatus = 'unknown',
): NormalizedCheck[] {
  const definitions: Array<{
    id: string;
    value: number;
    threshold: number;
    unit: string;
    weight: number;
    higherIsBetter?: boolean;
  }> = [
    { id: 'seo.lab_performance', value: Number(lighthouse?.score), threshold: 90, unit: '/100', weight: 2, higherIsBetter: true },
    { id: 'seo.lab_lcp', value: Number(lighthouse?.lcp_ms), threshold: 2500, unit: 'ms', weight: 2 },
    { id: 'seo.lab_cls', value: Number(lighthouse?.cls), threshold: 0.1, unit: '', weight: 2 },
    { id: 'seo.lab_tbt', value: Number(lighthouse?.tbt_ms), threshold: 200, unit: 'ms', weight: 1 },
  ];
  return definitions.map(definition => {
    const hasValue = Number.isFinite(definition.value);
    const passed = definition.higherIsBetter
      ? definition.value >= definition.threshold
      : definition.value <= definition.threshold;
    return check({
      id: definition.id,
      category: 'seo',
      weight: definition.weight,
      status: !lighthouse ? unavailableStatus : hasValue ? (passed ? 'pass' : 'fail') : unavailableStatus,
      confidence: hasValue ? 0.9 : 0,
      source: 'Google PageSpeed Insights API',
      pageUrl,
      evidence: hasValue
        ? [`${definition.value}${definition.unit}; ${definition.higherIsBetter ? '>=' : '<='} ${definition.threshold}${definition.unit}`]
        : ['PageSpeed lab evidence has not completed'],
    });
  });
}

export function mergeLighthouseChecks(
  checks: NormalizedCheck[],
  lighthouse: LighthouseEvidence,
  pageUrl?: string,
): NormalizedCheck[] {
  const replacements = new Map(buildLighthouseChecks(lighthouse, pageUrl).map(item => [item.id, item]));
  const merged = checks.map(item => replacements.get(item.id) ?? item);
  const present = new Set(merged.map(item => item.id));
  for (const item of replacements.values()) {
    if (!present.has(item.id)) merged.push(item);
  }
  return merged;
}

export function buildNormalizedChecks(
  context: AuditContext,
  pages: FetchedAuditPage[],
  modules: Record<string, ModuleResult>,
): NormalizedCheck[] {
  const zh = context.locale.toLowerCase().startsWith('zh');
  const primary = pages[0];
  const technical = moduleData<TechnicalAuditData>(modules, 'technical_seo');
  const content = moduleData<ContentAuditData>(modules, 'content_quality');
  const schema = moduleData<SchemaAuditData>(modules, 'schema_audit');
  const robots = moduleData<RobotsAuditData>(modules, 'robots_sitemap');
  const onPage = moduleData<OnPageAuditData>(modules, 'on_page_seo');
  const accessibility = moduleData<AccessibilityAuditData>(modules, 'accessibility');
  const mobile = moduleData<MobileAuditData>(modules, 'mobile_audit');
  const crux = moduleData<CruxAuditData>(modules, 'crux');
  const lighthouse = moduleData<LighthouseEvidence>(modules, 'lighthouse');
  const authority = moduleData<AuthorityAuditData>(modules, 'authority');
  const geo = moduleData<PredictedGeoData>(modules, 'geo_predicted');
  const htmlValidation = moduleData<ExternalCheckEvidence>(modules, 'html_validator');
  const commonCrawl = moduleData<ExternalCheckEvidence>(modules, 'common_crawl');
  const completedPages = pages.filter(page => page.status === 'complete');
  const failedPages = pages.filter(page => page.status === 'error');
  const primaryAvailable = primary?.status === 'complete' && !!primary.html;
  const siteEvidenceAvailable = completedPages.some(page => !!page.html);
  const schemas = new Set<string>(schema?.schemas_found ?? []);
  const output: NormalizedCheck[] = [];
  const pageUrl = primary?.url;
  const geoSignals = completedPages.map(geoPageSignals);
  const contentSignals = contentPagesFor(context, geoSignals);
  const namedTechnicalCheck = (name: string): { passed: boolean; detail?: string } | null => {
    const candidate = Array.isArray(technical?.checks)
      ? technical.checks.find((item: unknown) => !!item && typeof item === 'object' && (item as Record<string, unknown>).name === name)
      : null;
    return candidate && typeof candidate.passed === 'boolean' ? candidate : null;
  };
  const namedWcagCheck = (prefix: string): { passed: boolean; detail?: string } | null => {
    const candidate = Array.isArray(accessibility?.wcag_checks)
      ? accessibility.wcag_checks.find((item: unknown) =>
          !!item && typeof item === 'object' && String((item as Record<string, unknown>).rule ?? '').startsWith(prefix))
      : null;
    return candidate && typeof candidate.passed === 'boolean' ? candidate : null;
  };

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

  const onPageError = statusFromModule(modules, 'on_page_seo');
  const mobileError = statusFromModule(modules, 'mobile_audit');
  const accessibilityError = statusFromModule(modules, 'accessibility');
  const cruxError = statusFromModule(modules, 'crux');
  const lighthouseError = statusFromModule(modules, 'lighthouse');
  const titleLength = namedTechnicalCheck('Title tag length (30-70 chars)');
  const descriptionLength = namedTechnicalCheck('Meta description (100-170 chars)');
  const httpsEnabled = namedTechnicalCheck('HTTPS enabled');
  const responseTime = namedTechnicalCheck('Response time < 2s');
  const openGraph = namedTechnicalCheck('Open Graph tags complete');
  const compression = namedTechnicalCheck('HTML compression (GZIP/Brotli)');
  const imageAlt = namedTechnicalCheck('Image alt attributes');
  const rssFeed = namedTechnicalCheck('RSS / Atom feed');
  const pageLanguages = completedPages
    .map(page => page.html.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1]?.toLowerCase().split(/[-_]/)[0] ?? '')
    .filter(Boolean);
  const multilingual = new Set(pageLanguages).size > 1;
  const hreflang = namedTechnicalCheck('hreflang for multilingual');
  const imageTotal = Number(onPage?.images?.total ?? technical?.image_audit?.total ?? 0);
  const missingAlt = Number(onPage?.images?.missing_alt ?? technical?.image_audit?.missing_alt ?? 0);
  const missingDimensions = Number(onPage?.images?.missing_dimensions ?? 0);
  const responsiveImages = Number(onPage?.images?.responsive ?? 0);
  const meaningfulImageCount = Number(mobile?.meaningful_image_count ?? imageTotal);
  const transportEvidenceAvailable = technical?.transport_evidence_available !== false && primary?.fetch_source !== 'browser_run';

  output.push(check({
    id: 'seo.https_transport', category: 'seo', weight: 3,
    status: !primaryAvailable ? 'unknown' : techError ?? (httpsEnabled ? (httpsEnabled.passed ? 'pass' : 'fail') : 'unknown'),
    source: 'technical_seo', pageUrl,
    evidence: httpsEnabled ? [httpsEnabled.detail ?? (httpsEnabled.passed ? 'HTTPS is enabled' : 'HTTPS is not enabled')] : [],
  }));
  output.push(check({
    id: 'seo.response_time', category: 'seo', weight: 2,
    status: !primaryAvailable || !transportEvidenceAvailable ? 'unknown' : techError ?? (responseTime
      ? (responseTime.passed ? 'pass' : 'fail')
      : Number.isFinite(Number(technical?.response_time_ms)) ? (Number(technical?.response_time_ms) < 2000 ? 'pass' : 'fail') : 'unknown'),
    source: 'technical_seo', pageUrl,
    evidence: !transportEvidenceAvailable ? ['Target response timing was not available from the page fetch provider'] : responseTime ? [responseTime.detail ?? `${Number(technical?.response_time_ms ?? 0)}ms`] : [],
  }));
  output.push(check({
    id: 'seo.title_length', category: 'seo', weight: 1,
    status: !primaryAvailable ? 'unknown' : !pageMeta?.title ? 'not_applicable' : techError ?? (titleLength
      ? (titleLength.passed ? 'pass' : 'fail')
      : isTextLengthGood(String(pageMeta.title), pageMeta.lang ?? context.locale) ? 'pass' : 'fail'),
    source: 'technical_seo', pageUrl,
    evidence: titleLength ? [titleLength.detail ?? `${String(pageMeta?.title ?? '').length} characters`] : pageMeta?.title ? [`${String(pageMeta.title).length} characters; target ${textLengthRange(String(pageMeta.title), pageMeta.lang ?? context.locale).label}`] : [],
  }));
  output.push(check({
    id: 'seo.meta_description_length', category: 'seo', weight: 1,
    status: !primaryAvailable ? 'unknown' : !pageMeta?.description ? 'not_applicable' : techError ?? (descriptionLength
      ? (descriptionLength.passed ? 'pass' : 'fail')
      : String(pageMeta.description).length >= 100 && String(pageMeta.description).length <= 170 ? 'pass' : 'fail'),
    source: 'technical_seo', pageUrl,
    evidence: descriptionLength ? [descriptionLength.detail ?? `${String(pageMeta?.description ?? '').length} characters`] : [],
  }));
  output.push(check({
    id: 'seo.hreflang', category: 'seo', weight: 1,
    status: !primaryAvailable ? 'unknown' : !multilingual ? 'not_applicable' : techError ?? (hreflang ? (hreflang.passed ? 'pass' : 'fail') : 'unknown'),
    source: 'technical_seo', pageUrl,
    evidence: !multilingual ? [`One sampled language detected: ${pageLanguages[0] ?? context.locale}`] : hreflang ? [hreflang.detail ?? `${new Set(pageLanguages).size} sampled languages`] : [],
  }));
  output.push(check({
    id: 'seo.open_graph', category: 'seo', weight: 1,
    status: !primaryAvailable ? 'unknown' : techError ?? (openGraph ? (openGraph.passed ? 'pass' : 'fail') : 'unknown'),
    source: 'technical_seo', pageUrl, evidence: openGraph ? [openGraph.detail ?? 'Core Open Graph fields checked'] : [],
  }));
  output.push(check({
    id: 'seo.mobile_viewport', category: 'seo', weight: 2,
    status: !primaryAvailable ? 'unknown' : mobileError ?? (mobile ? (mobile.has_viewport_meta ? 'pass' : 'fail') : 'unknown'),
    source: 'mobile_audit', pageUrl,
    evidence: mobile ? [mobile.has_viewport_meta ? `viewport=${mobile.viewport_content ?? 'present'}` : 'No viewport meta tag found'] : [],
  }));
  const mobileUsable = !!mobile && mobile.has_viewport_meta === true
    && Number(mobile.tap_target_issues ?? 0) === 0 && mobile.font_size_ok !== false;
  output.push(check({
    id: 'seo.mobile_usability', category: 'seo', weight: 2,
    status: !primaryAvailable ? 'unknown' : mobileError ?? (mobile ? (mobileUsable ? 'pass' : 'fail') : 'unknown'),
    source: 'mobile_audit', pageUrl,
    evidence: mobile ? [`viewport=${mobile.has_viewport_meta ? 'present' : 'missing'}`, `${Number(mobile.tap_target_issues ?? 0)} tap-target issues`, `font sizes ${mobile.font_size_ok === false ? 'need review' : 'pass basic check'}`] : [],
  }));
  output.push(check({
    id: 'seo.heading_hierarchy', category: 'seo', weight: 1,
    status: !primaryAvailable ? 'unknown' : onPageError ?? (onPage?.headings ? (onPage.headings.skipped_level ? 'fail' : 'pass') : 'unknown'),
    source: 'on_page_seo', pageUrl,
    evidence: onPage?.headings ? [onPage.headings.skipped_level ? 'A heading level is skipped' : 'No skipped heading levels detected'] : [],
  }));
  output.push(check({
    id: 'seo.internal_links', category: 'seo', weight: 1,
    status: !primaryAvailable ? 'unknown' : onPageError ?? (onPage?.links ? (Number(onPage.links.internal ?? 0) > 0 ? 'pass' : 'fail') : 'unknown'),
    source: 'on_page_seo', pageUrl, evidence: onPage?.links ? [`${Number(onPage.links.internal ?? 0)} internal links`] : [],
  }));
  output.push(check({
    id: 'seo.image_alt', category: 'seo', weight: 1,
    status: !primaryAvailable ? 'unknown' : imageTotal === 0 ? 'not_applicable' : onPageError ?? techError ?? (imageAlt ? (imageAlt.passed ? 'pass' : 'fail') : missingAlt === 0 ? 'pass' : 'fail'),
    source: onPage?.images ? 'on_page_seo' : 'technical_seo', pageUrl,
    evidence: imageTotal === 0 ? ['No images found'] : [`${missingAlt}/${imageTotal} images missing alt text`, ...((technical?.image_audit?.missing_alt_srcs ?? []) as string[]).slice(0, 5)],
  }));
  output.push(check({
    id: 'seo.image_dimensions', category: 'seo', weight: 1,
    status: !primaryAvailable ? 'unknown' : imageTotal === 0 ? 'not_applicable' : onPageError ?? (onPage?.images ? (missingDimensions === 0 ? 'pass' : 'fail') : 'unknown'),
    source: 'on_page_seo', pageUrl, evidence: imageTotal === 0 ? ['No images found'] : [`${missingDimensions}/${imageTotal} images lack dimensions`],
  }));
  output.push(check({
    id: 'seo.responsive_images', category: 'seo', weight: 1,
    status: !primaryAvailable ? 'unknown' : meaningfulImageCount === 0 ? 'not_applicable' : mobileError ?? onPageError ?? (mobile || onPage?.images ? (mobile?.has_responsive_images || responsiveImages > 0 ? 'pass' : 'fail') : 'unknown'),
    source: 'mobile_audit', pageUrl,
    evidence: meaningfulImageCount === 0 ? ['No content images found; avatars, logos, icons, and sprites are excluded'] : [`${responsiveImages}/${meaningfulImageCount} content images expose srcset/sizes`, `mobile responsive image signal=${mobile?.has_responsive_images === true ? 'present' : 'not detected'}`],
  }));
  output.push(check({
    id: 'seo.render_blocking', category: 'seo', weight: 1,
    status: !primaryAvailable ? 'unknown' : techError ?? (technical ? (Number(technical.render_blocking_scripts ?? 0) === 0 ? 'pass' : 'fail') : 'unknown'),
    source: 'technical_seo', pageUrl, evidence: technical ? [`${Number(technical.render_blocking_scripts ?? 0)} render-blocking scripts`] : [],
  }));
  output.push(check({
    id: 'seo.html_compression', category: 'seo', weight: 1,
    status: !primaryAvailable || !transportEvidenceAvailable ? 'unknown' : techError ?? (compression ? (compression.passed ? 'pass' : 'fail') : technical?.compression ? (technical.compression.enabled ? 'pass' : 'fail') : 'unknown'),
    source: 'technical_seo', pageUrl,
    evidence: !transportEvidenceAvailable ? ['Target response headers and transfer encoding were not available from the page fetch provider'] : compression ? [compression.detail ?? 'Compression checked'] : technical?.compression ? [`encoding=${technical.compression.encoding ?? 'none'}`] : [],
  }));
  output.push(check({
    id: 'seo.page_weight', category: 'seo', weight: 1,
    status: !primaryAvailable || !transportEvidenceAvailable ? 'unknown' : techError ?? (technical && Number.isFinite(Number(technical.page_weight_kb)) ? (Number(technical.page_weight_kb) <= 500 ? 'pass' : 'fail') : 'unknown'),
    source: 'technical_seo', pageUrl, evidence: !transportEvidenceAvailable ? ['Target transfer size was not available from the page fetch provider'] : technical ? [`HTML document ${Number(technical.page_weight_kb ?? 0)} KB`] : [],
  }));
  output.push(check({
    id: 'seo.dom_size', category: 'seo', weight: 1,
    status: !primaryAvailable ? 'unknown' : techError ?? (technical && Number.isFinite(Number(technical.dom_element_count)) ? (Number(technical.dom_element_count) <= 1500 ? 'pass' : 'fail') : 'unknown'),
    source: 'technical_seo', pageUrl, evidence: technical ? [`${Number(technical.dom_element_count ?? 0)} DOM elements`] : [],
  }));

  const wcagChecks: Array<[string, string]> = [
    ['seo.form_labels', 'Form inputs have labels'],
    ['seo.aria_landmarks', 'ARIA landmarks present'],
    ['seo.descriptive_links', 'Links have descriptive text'],
    ['seo.skip_navigation', 'Skip navigation link'],
  ];
  for (const [id, prefix] of wcagChecks) {
    const result = namedWcagCheck(prefix);
    output.push(check({
      id, category: 'seo', weight: 1,
      status: !primaryAvailable ? 'unknown' : accessibilityError ?? (result ? (result.passed ? 'pass' : 'fail') : 'unknown'),
      source: 'accessibility', pageUrl, evidence: result ? [result.detail ?? (result.passed ? `${prefix} passed` : `${prefix} failed`)] : [],
    }));
  }
  output.push(check({
    id: 'seo.security_headers', category: 'seo', weight: 0,
    status: !primaryAvailable || !transportEvidenceAvailable ? 'unknown' : techError ?? (technical?.security_headers ? (Number(technical.security_headers.score ?? 0) >= 80 ? 'pass' : 'fail') : 'unknown'),
    source: 'technical_seo', pageUrl, evidence: !transportEvidenceAvailable ? ['Target response headers were not available from the page fetch provider'] : technical?.security_headers ? [`Header coverage score ${Number(technical.security_headers.score ?? 0)}/100`] : [],
  }));

  const pushCruxMetric = (id: string, metric: CruxMetric, threshold: number, weight: number) => {
    const value = Number(crux?.[metric]?.p75);
    const hasMetric = crux?.has_data === true && Number.isFinite(value);
    output.push(check({
      id, category: 'seo', weight,
      status: cruxError ?? (!crux || crux.has_data !== true ? 'unknown' : hasMetric ? (value <= threshold ? 'pass' : 'fail') : 'unknown'),
      confidence: hasMetric ? 0.95 : 0, source: 'Chrome UX Report', pageUrl,
      evidence: hasMetric ? [`p75=${value}${metric === 'cls' ? '' : 'ms'}; good threshold <= ${threshold}${metric === 'cls' ? '' : 'ms'}`] : [crux?.issues?.[0] ?? 'No CrUX field data available'],
    }));
  };
  pushCruxMetric('seo.cwv_lcp', 'lcp', 2500, 2);
  pushCruxMetric('seo.cwv_cls', 'cls', 0.1, 2);
  pushCruxMetric('seo.cwv_inp', 'inp', 200, 2);
  pushCruxMetric('seo.cwv_fcp', 'fcp', 1800, 1);
  pushCruxMetric('seo.cwv_ttfb', 'ttfb', 800, 1);

  output.push(...buildLighthouseChecks(lighthouse, pageUrl, lighthouseError ?? 'unknown'));

  const feedApplicable = ['personal_blog', 'editorial', 'news_media'].includes(context.site_archetype);
  output.push(check({
    id: 'seo.rss_feed', category: 'seo', weight: 1,
    status: !primaryAvailable ? 'unknown' : !feedApplicable ? 'not_applicable' : techError ?? (rssFeed ? (rssFeed.passed ? 'pass' : 'fail') : technical ? (technical.rss_feed_url ? 'pass' : 'fail') : 'unknown'),
    source: 'technical_seo', pageUrl, evidence: !feedApplicable ? [`${context.site_archetype} does not require a feed`] : rssFeed ? [rssFeed.detail ?? 'RSS/Atom feed checked'] : [],
  }));
  const blockedAiBots = Array.isArray(technical?.blocked_ai_bots) ? technical.blocked_ai_bots.filter((item: unknown): item is string => typeof item === 'string') : [];
  const crawlerPolicy = technical?.crawler_policy_v2 ?? null;
  const searchBlocked = Array.isArray(crawlerPolicy?.search_index?.blocked)
    ? crawlerPolicy.search_index.blocked.filter((item: unknown): item is string => typeof item === 'string')
    : [];
  const trainingBlocked = Array.isArray(crawlerPolicy?.training?.blocked)
    ? crawlerPolicy.training.blocked.filter((item: unknown): item is string => typeof item === 'string')
    : [];
  const userFetchBlocked = Array.isArray(crawlerPolicy?.user_fetch?.blocked)
    ? crawlerPolicy.user_fetch.blocked.filter((item: unknown): item is string => typeof item === 'string')
    : [];
  const crawlerPolicyKnown = crawlerPolicy?.version === '2' && crawlerPolicy?.robots_status !== 'error';
  const crawlerEvidence = crawlerPolicyKnown
    ? [
        searchBlocked.length
          ? `Search/index crawlers blocked: ${searchBlocked.join(', ')}`
          : 'No supported search/index crawler block was detected',
        trainingBlocked.length
          ? `Training crawlers blocked by publisher choice: ${trainingBlocked.join(', ')}`
          : 'No supported training crawler block was detected',
        userFetchBlocked.length
          ? `User-triggered fetchers blocked: ${userFetchBlocked.join(', ')}`
          : 'No supported user-triggered fetcher block was detected',
      ]
    : technical
      ? [blockedAiBots.length ? `Legacy crawler blocks detected: ${blockedAiBots.join(', ')}` : 'Crawler policy evidence is unavailable']
      : [];
  output.push(check({
    id: 'geo.ai_crawler_policy', category: 'geo', weight: 0,
    status: techError ?? (technical
      ? crawlerPolicy
        ? !crawlerPolicyKnown ? 'unknown' : searchBlocked.length > 0 ? 'fail' : 'pass'
        : blockedAiBots.length > 0 ? 'fail' : 'pass'
      : 'unknown'),
    source: 'technical_seo', pageUrl,
    evidence: crawlerEvidence,
  }));

  const identityApplicable = context.site_archetype !== 'unknown';
  output.push(check({ id: 'geo.entity_identity', category: 'geo', title: zh ? '实体身份清晰度' : 'Entity identity clarity', weight: 3,
    status: !siteEvidenceAvailable || !identityApplicable ? 'unknown' : context.entity ? 'pass' : 'fail', confidence: context.entity ? 0.98 : context.confidence,
    source: context.entity?.source ?? 'audit_context', pageUrl: context.entity?.page_url,
    evidence: !siteEvidenceAvailable ? ['No fetched page content was available for entity verification'] : context.entity ? [`${context.entity.type}: ${context.entity.name}`] : ['No trusted schema entity found'] }));
  const entitySignals = context.entity ? sampledEntitySignals(pages, context.entity.type) : [];
  const expectedEntity = normalizedEntityName(context.entity?.name ?? '');
  const entityConflicts = entitySignals.filter(item =>
    !item.names.some(name => normalizedEntityName(name) === expectedEntity),
  );
  output.push(check({
    id: 'geo.entity_consistency', category: 'geo',
    title: zh ? '跨页面实体一致性' : 'Cross-page entity consistency',
    weight: 2,
    status: !context.entity || completedPages.length < 2
      ? 'not_applicable'
      : entitySignals.length < 2
        ? 'unknown'
        : entityConflicts.length > 0 ? 'fail' : 'pass',
    confidence: entitySignals.length >= 2 && entityConflicts.length === 0 ? 0.92 : entityConflicts.length > 0 ? 0.88 : 0,
    source: 'json_ld',
    pageUrl: entityConflicts[0]?.pageUrl ?? context.entity?.page_url,
    evidence: !context.entity
      ? ['No trusted entity is available for cross-page comparison']
      : entitySignals.length < 2
        ? ['Fewer than two sampled pages expose a comparable typed entity']
        : entityConflicts.length > 0
          ? entityConflicts.flatMap(item => item.names.map(name => `${item.pageUrl}: ${name}`)).slice(0, 8)
          : entitySignals.flatMap(item => item.names.map(name => `${item.pageUrl}: ${name}`)).slice(0, 8),
  }));
  const authorPages = contentSignals.filter(page => page.pageType === 'article');
  const personalSiteResponsible = context.site_archetype === 'personal_blog' && context.entity?.type === 'Person';
  const missingAuthorPages = authorPages.filter(page =>
    page.authorNames.length === 0 && page.publisherNames.length === 0 && !personalSiteResponsible,
  );
  output.push(check({ id: 'geo.author_signal', category: 'geo', title: zh ? '内容责任归属' : 'Content responsibility', weight: 2,
    status: !primaryAvailable ? 'unknown' : authorPages.length === 0 ? 'not_applicable' : missingAuthorPages.length > 0 ? 'fail' : 'pass',
    source: 'json_ld', pageUrl, evidence: !primaryAvailable
      ? ['Primary page content was not available']
      : authorPages.length === 0
        ? ['No sampled article page requires content responsibility attribution']
      : missingAuthorPages.length > 0
        ? missingAuthorPages.map(page => `${page.pageUrl}: no explicit author or responsible publisher`).slice(0, 8)
        : authorPages.flatMap(page => page.authorNames.length > 0
          ? page.authorNames.map(name => `${page.pageUrl}: author ${name}`)
          : page.publisherNames.length > 0
            ? page.publisherNames.map(name => `${page.pageUrl}: publisher ${name}`)
            : [`${page.pageUrl}: site Person ${context.entity?.name ?? ''}`]
        ).slice(0, 8) }));
  const wordCount = Number(content?.word_count ?? onPage?.content?.word_count ?? 0);
  const extractableText = geoSignals.reduce((total, page) => total + page.text.length, 0);
  output.push(check({ id: 'geo.extractability', category: 'geo', title: zh ? '内容可提取性' : 'Content extractability', weight: 3,
    status: !primaryAvailable ? 'unknown' : contentError ?? (content
      ? (wordCount >= 100 || extractableText >= 240 ? 'pass' : 'fail')
      : 'unknown'), source: 'content_quality', pageUrl,
    evidence: !primaryAvailable ? ['Primary page content was not available'] : content ? [`${wordCount} extracted words/terms`, `${extractableText} visible text characters`] : [] }));
  const directPages = contentSignals.filter(page => directAnswerApplicable(context, page));
  const directAnswerPages = directPages.filter(page => {
    const first = page.paragraphs[0] ?? '';
    return first.length >= 40 && first.length <= 700 && page.text.indexOf(first.slice(0, 24)) >= 0;
  });
  output.push(check({
    id: 'geo.direct_answer', category: 'geo', title: zh ? '直接回答结构' : 'Direct answer structure', weight: 2,
    status: directPages.length === 0 ? 'not_applicable' : directAnswerPages.length === directPages.length ? 'pass' : 'fail',
    confidence: directPages.length > 0 ? 0.82 : 0,
    source: 'page_structure', pageUrl: directPages[0]?.pageUrl ?? pageUrl,
    evidence: directPages.length === 0
      ? ['No sampled page type or query-shaped content requires a direct answer']
      : directPages.map(page => `${page.pageUrl}: ${directAnswerPages.includes(page) ? 'lead paragraph is directly extractable' : 'no concise lead answer'}`).slice(0, 8),
  }));
  const claimPages = contentSignals.filter(page => page.claims.length > 0);
  const claims = claimPages.flatMap(page => page.claims.map(claim => ({ ...claim, pageUrl: page.pageUrl })));
  const supportedClaims = claims.filter(claim => claim.supported);
  output.push(check({
    id: 'geo.claim_source_support', category: 'geo', title: zh ? '声明与来源关联' : 'Claim-to-source support', weight: 2,
    status: claims.length === 0 ? 'not_applicable' : supportedClaims.length / claims.length >= 0.6 ? 'pass' : 'fail',
    confidence: claims.length > 0 ? 0.78 : 0,
    source: 'content_sources', pageUrl: claims[0]?.pageUrl ?? pageUrl,
    evidence: claims.length === 0
      ? ['No source-dependent claims were detected in sampled content']
      : [`${supportedClaims.length}/${claims.length} detected claims have an adjacent source or citation`, ...claims.slice(0, 6).map(claim => `${claim.pageUrl}: ${claim.supported ? 'supported' : 'unsupported'} — ${claim.text.slice(0, 160)}`)],
  }));
  const statistics = claimPages.flatMap(page => page.statistics.map(stat => ({ ...stat, pageUrl: page.pageUrl })));
  const sourcedStatistics = statistics.filter(stat => stat.supported);
  output.push(check({
    id: 'geo.statistic_provenance', category: 'geo', title: zh ? '统计数据来源' : 'Statistic provenance', weight: 1,
    status: statistics.length === 0 ? 'not_applicable' : sourcedStatistics.length === statistics.length ? 'pass' : 'fail',
    confidence: statistics.length > 0 ? 0.8 : 0,
    source: 'content_sources', pageUrl: statistics[0]?.pageUrl ?? pageUrl,
    evidence: statistics.length === 0
      ? ['No numeric or statistical claims were detected']
      : [`${sourcedStatistics.length}/${statistics.length} detected statistics have a source signal`, ...statistics.slice(0, 6).map(stat => `${stat.pageUrl}: ${stat.supported ? 'sourced' : 'no source'} — ${stat.text.slice(0, 160)}`)],
  }));
  const freshnessPages = contentSignals.filter(page => page.pageType === 'article' || page.pageType === 'documentation');
  const datedPages = freshnessPages.filter(page => page.dates.length > 0);
  output.push(check({
    id: 'geo.freshness', category: 'geo', title: zh ? '内容时效信号' : 'Content freshness signals', weight: 1,
    status: freshnessPages.length === 0 ? 'not_applicable' : datedPages.length === freshnessPages.length ? 'pass' : 'fail',
    confidence: freshnessPages.length > 0 ? 0.75 : 0,
    source: 'metadata', pageUrl: freshnessPages[0]?.pageUrl ?? pageUrl,
    evidence: freshnessPages.length === 0
      ? ['No sampled article, documentation, or news page requires a freshness signal']
      : freshnessPages.map(page => `${page.pageUrl}: ${page.dates[0] ?? 'no published/modified date'}`).slice(0, 8),
  }));
  const labelPages = geoSignals.filter(page => page.siteLabels.length > 0);
  const labels = [...new Set(labelPages.flatMap(page => page.siteLabels.map(normalizedSiteLabel)).filter(Boolean))];
  output.push(check({
    id: 'geo.cross_page_consistency', category: 'geo', title: zh ? '跨页面站点身份一致性' : 'Cross-page site identity consistency', weight: 2,
    status: completedPages.length < 2 || labelPages.length < 2 ? 'not_applicable' : labels.length === 1 ? 'pass' : 'fail',
    confidence: labelPages.length >= 2 ? 0.86 : 0,
    source: 'page_metadata', pageUrl: labelPages[0]?.pageUrl ?? pageUrl,
    evidence: labelPages.length < 2
      ? ['Fewer than two sampled pages expose a comparable site identity label']
      : labelPages.flatMap(page => page.siteLabels.map(label => `${page.pageUrl}: ${label}`)).slice(0, 8),
  }));
  output.push(check({ id: 'geo.source_links', category: 'geo', title: zh ? '来源与外部引用' : 'Sources and outbound citations', weight: 0,
    status: !primaryAvailable
      ? 'unknown'
      : claims.length === 0
        ? 'not_applicable'
        : contentError ?? (content ? ((content.external_links ?? 0) > 0 ? 'pass' : 'fail') : 'unknown'), source: 'content_quality', pageUrl,
    evidence: !primaryAvailable ? ['Primary page content was not available'] : claims.length === 0 ? ['No source-dependent claims require outbound citations'] : content ? [`${content.external_links ?? 0} external links`] : [] }));
  output.push(check({ id: 'geo.llms_txt', category: 'geo', title: 'llms.txt', weight: 0,
    status: techError ?? (technical
      ? technical.llms_txt_status === 'error'
        ? 'unknown'
        : technical.llms_txt_present ? 'pass' : 'not_applicable'
      : 'unknown'), source: 'technical_seo',
    evidence: technical
      ? [technical.llms_txt_status === 'error'
        ? 'llms.txt could not be verified'
        : technical.llms_txt_present ? 'llms.txt found' : 'llms.txt is optional and was not found']
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
