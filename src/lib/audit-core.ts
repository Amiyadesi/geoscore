import type { ModuleResult } from './types';
import type { FetchedAuditPage } from './audit-pages';
import { registrableRoot } from './audit-pages';

export const SCORE_VERSION = '2.2.0';

export const SCORE_POLICY = {
  minimum_overall_coverage: 0.6,
  minimum_overall_confidence: 0.5,
  severity_caps: { critical: 49, major: 79, minor: 94 },
  coverage_caps: [
    { below: 0.6, cap: 69 },
    { below: 0.75, cap: 79 },
    { below: 0.9, cap: 89 },
  ],
  confidence_caps: [
    { below: 0.5, cap: 69 },
    { below: 0.75, cap: 79 },
    { below: 0.9, cap: 89 },
  ],
} as const;

/** Public contract registry used by /api/meta; Predicted checks stay separate. */
export const FACTUAL_CHECK_IDS = [
  'seo.page_fetch', 'seo.sample_coverage', 'seo.indexability', 'seo.robots',
  'seo.sitemap', 'seo.canonical', 'seo.title', 'seo.meta_description', 'seo.h1',
  'seo.language', 'seo.schema_presence', 'seo.schema_fit', 'seo.html_conformance',
  'seo.cross_page_titles', 'seo.https_transport', 'seo.response_time',
  'seo.title_length', 'seo.meta_description_length', 'seo.hreflang', 'seo.open_graph',
  'seo.mobile_viewport', 'seo.mobile_usability', 'seo.heading_hierarchy',
  'seo.internal_links', 'seo.image_alt', 'seo.image_dimensions', 'seo.responsive_images',
  'seo.render_blocking', 'seo.html_compression', 'seo.page_weight', 'seo.dom_size',
  'seo.form_labels', 'seo.aria_landmarks', 'seo.descriptive_links', 'seo.skip_navigation',
  'seo.security_headers', 'seo.cwv_lcp', 'seo.cwv_cls', 'seo.cwv_inp', 'seo.cwv_fcp',
  'seo.cwv_ttfb', 'seo.lab_performance', 'seo.lab_lcp', 'seo.lab_cls', 'seo.lab_tbt',
  'seo.rss_feed', 'geo.ai_crawler_policy',
  'geo.entity_identity', 'geo.entity_consistency',
  'geo.author_signal', 'geo.extractability', 'geo.direct_answer',
  'geo.claim_source_support', 'geo.statistic_provenance', 'geo.freshness',
  'geo.cross_page_consistency', 'geo.source_links', 'geo.llms_txt',
  'geo.knowledge_graph', 'geo.common_crawl_presence',
] as const;

export interface LocalizedAuditText {
  en: string;
  zh: string;
}

/** Stable report labels. The audited-page locale only selects the legacy title field. */
export const CHECK_TITLES: Record<string, LocalizedAuditText> = {
  'seo.page_fetch': { en: 'Page fetchability', zh: '页面可抓取性' },
  'seo.sample_coverage': { en: 'Site sample coverage', zh: '整站抽样覆盖' },
  'seo.indexability': { en: 'Indexability', zh: '索引状态' },
  'seo.robots': { en: 'robots.txt', zh: 'robots.txt' },
  'seo.sitemap': { en: 'XML sitemap', zh: 'XML sitemap' },
  'seo.canonical': { en: 'Canonical URL', zh: 'Canonical URL' },
  'seo.title': { en: 'Page title', zh: '页面标题' },
  'seo.meta_description': { en: 'Meta description', zh: 'Meta description' },
  'seo.h1': { en: 'H1', zh: 'H1' },
  'seo.language': { en: 'Page language declaration', zh: '页面语言声明' },
  'seo.schema_presence': { en: 'Structured data presence', zh: '结构化数据存在性' },
  'seo.schema_fit': { en: 'Structured data archetype fit', zh: '结构化数据类型适配' },
  'seo.html_conformance': { en: 'HTML conformance', zh: 'HTML 规范性' },
  'seo.cross_page_titles': { en: 'Cross-page title consistency', zh: '跨页面标题一致性' },
  'seo.https_transport': { en: 'HTTPS transport', zh: 'HTTPS 传输' },
  'seo.response_time': { en: 'Server response time', zh: '服务器响应时间' },
  'seo.title_length': { en: 'Title length quality', zh: '标题长度质量' },
  'seo.meta_description_length': { en: 'Meta description length', zh: 'Meta description 长度' },
  'seo.hreflang': { en: 'Multilingual hreflang', zh: '多语言 hreflang' },
  'seo.open_graph': { en: 'Open Graph completeness', zh: 'Open Graph 完整性' },
  'seo.mobile_viewport': { en: 'Mobile viewport', zh: '移动端 viewport' },
  'seo.mobile_usability': { en: 'Basic mobile usability', zh: '基础移动端可用性' },
  'seo.heading_hierarchy': { en: 'Heading hierarchy', zh: '标题层级' },
  'seo.internal_links': { en: 'Internal linking', zh: '内部链接' },
  'seo.image_alt': { en: 'Image alternative text', zh: '图片替代文本' },
  'seo.image_dimensions': { en: 'Image dimensions', zh: '图片尺寸属性' },
  'seo.responsive_images': { en: 'Responsive images', zh: '响应式图片' },
  'seo.render_blocking': { en: 'Render-blocking scripts', zh: '阻塞渲染脚本' },
  'seo.html_compression': { en: 'HTML compression', zh: 'HTML 压缩' },
  'seo.page_weight': { en: 'HTML document weight', zh: 'HTML 文档体积' },
  'seo.dom_size': { en: 'DOM size', zh: 'DOM 规模' },
  'seo.form_labels': { en: 'Form input labels', zh: '表单输入标签' },
  'seo.aria_landmarks': { en: 'ARIA landmarks', zh: 'ARIA 地标' },
  'seo.descriptive_links': { en: 'Descriptive link text', zh: '描述性链接文本' },
  'seo.skip_navigation': { en: 'Skip navigation', zh: '跳过导航链接' },
  'seo.security_headers': { en: 'Security header coverage', zh: '安全响应头覆盖' },
  'seo.cwv_lcp': { en: 'Core Web Vitals: LCP', zh: 'Core Web Vitals：LCP' },
  'seo.cwv_cls': { en: 'Core Web Vitals: CLS', zh: 'Core Web Vitals：CLS' },
  'seo.cwv_inp': { en: 'Core Web Vitals: INP', zh: 'Core Web Vitals：INP' },
  'seo.cwv_fcp': { en: 'Field performance: FCP', zh: '现场性能：FCP' },
  'seo.cwv_ttfb': { en: 'Field performance: TTFB', zh: '现场性能：TTFB' },
  'seo.lab_performance': { en: 'PageSpeed lab performance', zh: 'PageSpeed 实验室性能' },
  'seo.lab_lcp': { en: 'Lab performance: LCP', zh: '实验室性能：LCP' },
  'seo.lab_cls': { en: 'Lab performance: CLS', zh: '实验室性能：CLS' },
  'seo.lab_tbt': { en: 'Lab performance: TBT', zh: '实验室性能：TBT' },
  'seo.rss_feed': { en: 'RSS or Atom feed', zh: 'RSS 或 Atom 订阅源' },
  'geo.ai_crawler_policy': { en: 'AI crawler policy', zh: 'AI 爬虫策略' },
  'geo.entity_identity': { en: 'Entity identity clarity', zh: '实体身份清晰度' },
  'geo.entity_consistency': { en: 'Cross-page entity consistency', zh: '跨页面实体一致性' },
  'geo.author_signal': { en: 'Author attribution', zh: '作者归属信号' },
  'geo.extractability': { en: 'Content extractability', zh: '内容可提取性' },
  'geo.direct_answer': { en: 'Direct answer structure', zh: '直接回答结构' },
  'geo.claim_source_support': { en: 'Claim-to-source support', zh: '声明与来源关联' },
  'geo.statistic_provenance': { en: 'Statistic provenance', zh: '统计数据来源' },
  'geo.freshness': { en: 'Content freshness signals', zh: '内容时效信号' },
  'geo.cross_page_consistency': { en: 'Cross-page site identity consistency', zh: '跨页面站点身份一致性' },
  'geo.source_links': { en: 'Sources and outbound citations', zh: '来源与外部引用' },
  'geo.llms_txt': { en: 'llms.txt', zh: 'llms.txt' },
  'geo.knowledge_graph': { en: 'Verified knowledge-graph entity', zh: '已验证知识图谱实体' },
  'geo.common_crawl_presence': { en: 'Common Crawl presence', zh: 'Common Crawl 收录证据' },
  'geo.predicted_citation': { en: 'Predicted AI citation simulation', zh: 'Predicted AI 引用模拟' },
};

/** Severity is a stable scoring contract, not a provider confidence signal. */
export const CHECK_SEVERITIES: Record<string, CheckSeverity> = {
  'seo.page_fetch': 'critical',
  'seo.sample_coverage': 'info',
  'seo.indexability': 'critical',
  'seo.robots': 'critical',
  'seo.sitemap': 'major',
  'seo.canonical': 'major',
  'seo.title': 'major',
  'seo.meta_description': 'major',
  'seo.h1': 'major',
  'seo.language': 'minor',
  'seo.schema_presence': 'major',
  'seo.schema_fit': 'major',
  'seo.html_conformance': 'minor',
  'seo.cross_page_titles': 'minor',
  'seo.https_transport': 'critical',
  'seo.response_time': 'major',
  'seo.title_length': 'minor',
  'seo.meta_description_length': 'minor',
  'seo.hreflang': 'minor',
  'seo.open_graph': 'minor',
  'seo.mobile_viewport': 'major',
  'seo.mobile_usability': 'major',
  'seo.heading_hierarchy': 'minor',
  'seo.internal_links': 'minor',
  'seo.image_alt': 'minor',
  'seo.image_dimensions': 'minor',
  'seo.responsive_images': 'minor',
  'seo.render_blocking': 'minor',
  'seo.html_compression': 'minor',
  'seo.page_weight': 'minor',
  'seo.dom_size': 'minor',
  'seo.form_labels': 'minor',
  'seo.aria_landmarks': 'minor',
  'seo.descriptive_links': 'minor',
  'seo.skip_navigation': 'minor',
  'seo.security_headers': 'info',
  'seo.cwv_lcp': 'major',
  'seo.cwv_cls': 'major',
  'seo.cwv_inp': 'major',
  'seo.cwv_fcp': 'minor',
  'seo.cwv_ttfb': 'minor',
  'seo.lab_performance': 'major',
  'seo.lab_lcp': 'major',
  'seo.lab_cls': 'major',
  'seo.lab_tbt': 'minor',
  'seo.rss_feed': 'minor',
  'geo.ai_crawler_policy': 'info',
  'geo.entity_identity': 'major',
  'geo.entity_consistency': 'major',
  'geo.author_signal': 'major',
  'geo.extractability': 'critical',
  'geo.direct_answer': 'minor',
  'geo.claim_source_support': 'major',
  'geo.statistic_provenance': 'major',
  'geo.freshness': 'minor',
  'geo.cross_page_consistency': 'major',
  'geo.source_links': 'info',
  'geo.llms_txt': 'info',
  'geo.knowledge_graph': 'minor',
  'geo.common_crawl_presence': 'info',
  'geo.predicted_citation': 'info',
};

export const SITE_ARCHETYPES = [
  'personal_blog', 'editorial', 'news_media', 'documentation', 'saas', 'ecommerce',
  'local_business', 'professional_services', 'portfolio', 'community', 'nonprofit',
  'other', 'unknown',
] as const;

export type SiteArchetype = typeof SITE_ARCHETYPES[number];
export type CheckStatus = 'pass' | 'fail' | 'not_applicable' | 'unknown' | 'error';
export type CheckCategory = 'seo' | 'geo';
export type CheckSeverity = 'critical' | 'major' | 'minor' | 'info';

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
  localized_title: LocalizedAuditText;
  status: CheckStatus;
  severity: CheckSeverity;
  weight: number;
  confidence: number;
  source: string;
  page_url?: string;
  evidence: string[];
  predicted?: boolean;
}

export interface CategoryScore {
  score: number | null;
  raw_score: number | null;
  coverage: number;
  confidence: number;
  cap: number;
  cap_reasons: ScoreCapReason[];
}

export interface ScoreCapReason {
  code: 'CRITICAL_FAILURE' | 'MAJOR_FAILURE' | 'MINOR_FAILURE' | 'LOW_COVERAGE' | 'LOW_CONFIDENCE';
  cap: number;
  check_ids: string[];
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
  severity: CheckSeverity;
  priority: number;
  title: string;
  page_url?: string;
  evidence: string;
  source: string;
  confidence: number;
  why: string;
  fix: string;
  verify: string;
  what_to_do: string;
  validation: string;
  impact: 'high' | 'medium' | 'low';
  effort: 'low' | 'medium' | 'high';
  localized: {
    en: Pick<AuditRecommendation, 'title' | 'why' | 'fix' | 'verify'>;
    zh: Pick<AuditRecommendation, 'title' | 'why' | 'fix' | 'verify'>;
  };
}

export interface BuildAuditContextInput {
  domain: string;
  pages: Array<Pick<FetchedAuditPage, 'url' | 'page_type' | 'status' | 'html' | 'locale'>>;
  industryVertical?: string | null;
  locality?: string | null;
  archetypeHint?: string | null;
}

type JsonObject = Record<string, unknown>;

interface JsonLdNode {
  node: JsonObject;
  pageUrl: string;
  pageType: string;
}

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

function extractJsonLdNodes(pages: BuildAuditContextInput['pages']): JsonLdNode[] {
  const nodes: JsonLdNode[] = [];
  for (const page of pages) {
    if (page.status !== 'complete' || !page.html) continue;
    for (const match of page.html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const extracted: JsonObject[] = [];
        flattenJsonLd(JSON.parse(match[1]), extracted);
        nodes.push(...extracted.map(node => ({ node, pageUrl: page.url, pageType: page.page_type })));
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
  nodes: JsonLdNode[],
  pages: BuildAuditContextInput['pages'],
  hint?: string | null,
): { archetype: SiteArchetype; confidence: number; evidence: AuditEvidence[] } {
  const firstPage = pages.find(page => page.status === 'complete');
  const pageUrl = firstPage?.url;
  const types = schemaTypes(nodes);
  const homePages = pages.filter(page => page.status === 'complete' && page.page_type === 'home');
  const homeHtml = homePages.map(page => page.html).join('\n') || firstPage?.html || '';
  const homeUrls = new Set(homePages.map(page => page.url));
  const homeNodes = nodes.filter(node => homeUrls.has(node.pageUrl) || (!homeUrls.size && node.pageUrl === pageUrl));
  const homeTypes = schemaTypes(homeNodes);
  const nonArticleNodes = nodes.filter(node => !['article', 'documentation', 'product'].includes(node.pageType));
  const nonArticleTypes = schemaTypes(nonArticleNodes);
  const html = pages.map(page => page.html).join('\n');
  const lower = html.toLowerCase();
  const homeLower = homeHtml.toLowerCase();
  const pageTypes = new Set(pages.map(page => page.page_type));
  const hasType = (...values: string[]) => values.some(value => types.has(value));
  const hasHomeType = (...values: string[]) => values.some(value => homeTypes.has(value));
  const hasNonArticleType = (...values: string[]) => values.some(value => nonArticleTypes.has(value));
  const hasLocal = [...nonArticleTypes].some(type => LOCAL_TYPES.has(type) || type.endsWith('Store'));

  if (isSiteArchetype(hint)) {
    return {
      archetype: hint,
      confidence: 0.98,
      evidence: [{ source: 'request_hint', page_url: pageUrl, value: `archetype_hint=${hint}`, confidence: 0.98 }],
    };
  }
  if (hasLocal) return strong('local_business', 'LocalBusiness-compatible JSON-LD', pageUrl);
  if (hasType('SoftwareApplication', 'WebApplication')) return strong('saas', 'Software application JSON-LD', pageUrl);
  if (hasNonArticleType('NewsMediaOrganization', 'Newspaper') || hasHomeType('NewsArticle')) return strong('news_media', 'News-specific site JSON-LD', pageUrl);
  if (hasType('Product') && !hasType('SoftwareApplication', 'WebApplication')) return strong('ecommerce', 'Product JSON-LD', pageUrl);
  if (hasType('DiscussionForumPosting')) return strong('community', 'Discussion forum JSON-LD', pageUrl);
  if (hasType('NGO', 'Nonprofit501c3')) return strong('nonprofit', 'Nonprofit JSON-LD', pageUrl);
  if (hasHomeType('Blog') && hasHomeType('Person')) return strong('personal_blog', 'Blog and Person JSON-LD', pageUrl);
  if (hasHomeType('ProfilePage') && hasHomeType('Person')) return strong('portfolio', 'Person profile JSON-LD', pageUrl, 0.9);

  const pricingNavigation = /href=["'][^"']*\/(pricing|plans)(?:[\/?#"'])/i.test(homeHtml);
  const productAccountNavigation = /href=["'][^"']*\/(signup|sign-up|register|login|dashboard|app)(?:[\/?#"'])/i.test(homeHtml);
  const developerNavigation = /href=["'][^"']*\/(docs?|developers?|api|guides?)(?:[\/?#"'])/i.test(homeHtml)
    || pageTypes.has('documentation');
  const productLanguage = /\b(platform|software|api|developers?|infrastructure|payments?|billing|product)\b/i.test(homeLower);
  const organizationBacked = hasHomeType('Organization', 'Corporation', 'WebSite', 'OnlineBusiness');
  const productPlatformSignals = [pricingNavigation, productAccountNavigation, developerNavigation, productLanguage]
    .filter(Boolean).length;
  if (organizationBacked && productPlatformSignals >= 2) {
    return strong('saas', 'Product platform navigation and site-level organization schema', pageUrl, 0.88);
  }

  if (hasHomeType('Blog', 'BlogPosting', 'Article', 'TechArticle')) return strong('editorial', 'Homepage editorial JSON-LD', pageUrl, 0.9);
  if (hasType('Blog', 'BlogPosting', 'Article', 'TechArticle') && !organizationBacked) {
    return strong('editorial', 'Editorial content without stronger site-level product identity', pageUrl, 0.76);
  }
  // Text collected from representative articles and archive pages is only a
  // weak site-level signal. It must not override schema-backed homepage identity.
  if (hasType('OnlineBusiness') && /\b(forum|community)\b/i.test(lower)) {
    return strong('community', 'Online business schema with community structure', pageUrl, 0.78);
  }
  if (/\b(forum|community)\b/i.test(lower)) return strong('community', 'Community/forum page copy', pageUrl, 0.66);
  if (/\b(nonprofit|non-profit|charity|foundation)\b/i.test(lower)) {
    return strong('nonprofit', 'Nonprofit page copy', pageUrl, 0.66);
  }
  if (pageTypes.has('documentation') || /\b(documentation|developer docs|api reference)\b/i.test(homeLower)) {
    return strong('documentation', 'Documentation paths and navigation', pageUrl, 0.78);
  }
  if (hasType('Service') && hasType('Organization')) return strong('professional_services', 'Service and Organization JSON-LD', pageUrl, 0.82);
  if (hasType('Person') && /\b(portfolio|projects|作品集)\b/i.test(lower)) return strong('portfolio', 'Person and portfolio structure', pageUrl, 0.8);

  const sameSitePricing = /href=["'][^"']*\/(pricing|plans)(?:[\/?#"'])/i.test(homeHtml);
  const productActions = /href=["'][^"']*\/(signup|sign-up|register|login|dashboard|app)(?:[\/?#"'])/i.test(homeHtml);
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
  nodes: JsonLdNode[],
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
  const homepageNodes = nodes.filter(item => item.pageType === 'home');
  const siteLevelNodes = nodes.filter(item => !['article', 'documentation', 'product'].includes(item.pageType));
  const pools = [homepageNodes, siteLevelNodes, nodes];
  for (const pool of pools) {
    for (const type of priorities) {
      const match = pool.find(({ node, pageType }) =>
        nodeTypes(node).includes(type)
        && typeof node.name === 'string'
        && node.name.trim()
        && !(type === 'Person' && ['article', 'documentation', 'product'].includes(pageType))
      );
      if (!match) continue;
      return {
        name: String(match.node.name).trim().slice(0, 200),
        type,
        source: 'json_ld',
        page_url: match.pageUrl,
      };
    }
  }
  return null;
}

function inferLocale(pages: BuildAuditContextInput['pages']): string {
  const explicit = pages.find(page => page.locale)?.locale;
  if (explicit) return explicit;
  const text = pages.map(page => page.html.replace(/<[^>]+>/g, ' ')).join(' ').slice(0, 5000);
  return /[\u3400-\u9fff]/.test(text) ? 'zh-CN' : 'en';
}

function normalizedEntityName(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[\u2018\u2019']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Return explicit same-type entity names per page. Missing schema on a sampled
 * page is absence of evidence, not a contradiction; only an explicit competing
 * name can fail consistency.
 */
function sampledEntitySignals(
  pages: FetchedAuditPage[],
  entityType: string,
): Array<{ pageUrl: string; names: string[] }> {
  return pages
    .filter(page => page.status === 'complete' && !!page.html)
    .map(page => ({
      pageUrl: page.url,
      names: [...new Set(
        extractJsonLdNodes([page])
          .filter(({ node }) => nodeTypes(node).includes(entityType) && typeof node.name === 'string')
          .map(({ node }) => String(node.name).trim())
          .filter(Boolean),
      )],
    }))
    .filter(item => item.names.length > 0);
}

interface GeoPageSignals {
  pageUrl: string;
  pageType: string;
  title: string;
  text: string;
  paragraphs: string[];
  entityNames: string[];
  authorNames: string[];
  siteLabels: string[];
  dates: string[];
  claims: Array<{ text: string; supported: boolean }>;
  statistics: Array<{ text: string; supported: boolean }>;
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function metadataValues(html: string, names: string[]): string[] {
  const wanted = new Set(names.map(name => name.toLowerCase()));
  const values: string[] = [];
  for (const match of html.matchAll(/<meta\s+([^>]+)>/gi)) {
    const attrs = match[1];
    const name = attrs.match(/(?:name|property)=["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const content = attrs.match(/content=["']([^"']*)["']/i)?.[1]?.trim();
    if (name && content && wanted.has(name)) values.push(content);
  }
  return values;
}

function dateValuesFromNode(node: JsonObject): string[] {
  return ['datePublished', 'dateModified', 'dateCreated']
    .map(key => node[key])
    .filter((value): value is string => typeof value === 'string' && !!value.trim())
    .map(value => value.trim());
}

function geoPageSignals(page: FetchedAuditPage): GeoPageSignals {
  const html = page.html || '';
  const nodes = extractJsonLdNodes([page]).map(item => item.node);
  const textHtml = html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const text = decodeHtmlText(textHtml);
  const title = page.title?.trim() || decodeHtmlText((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) ?? [])[1] ?? '');
  const paragraphs = [...html.matchAll(/<(?:p|blockquote|li)\b[^>]*>([\s\S]*?)<\/(?:p|blockquote|li)>/gi)]
    .map(match => decodeHtmlText(match[1]))
    .filter(value => value.length >= 20);
  const entityNames = nodes
    .filter(node => nodeTypes(node).some(type => ['Person', 'Organization', 'Corporation', 'WebSite', 'Blog'].includes(type)))
    .map(node => typeof node.name === 'string' ? node.name.trim() : '')
    .filter(Boolean);
  const authorNames = [
    ...nodes
      .filter(node => nodeTypes(node).includes('Person'))
      .map(node => typeof node.name === 'string' ? node.name.trim() : ''),
    ...metadataValues(html, ['author', 'article:author']),
    ...[...html.matchAll(/rel=["']author["'][^>]*>([\s\S]*?)<\//gi)].map(match => decodeHtmlText(match[1])),
  ].filter(Boolean);
  const siteLabels = [
    ...metadataValues(html, ['og:site_name', 'application-name']),
    ...nodes
      .filter(node => nodeTypes(node).includes('WebSite'))
      .map(node => typeof node.name === 'string' ? node.name.trim() : ''),
  ].filter(Boolean);
  const dates = [
    ...nodes.flatMap(dateValuesFromNode),
    ...metadataValues(html, ['article:published_time', 'article:modified_time', 'datepublished', 'datemodified']),
    ...[...html.matchAll(/<time\b[^>]*datetime=["']([^"']+)["'][^>]*>/gi)].map(match => match[1].trim()),
  ].filter(value => !Number.isNaN(Date.parse(value)));
  const claims = paragraphs
    .filter(value => /\baccording to\b|\b(research|study|report|survey|data|documentation)\b|根据|研究|报告|调查|数据显示/i.test(value))
    .map(value => ({
      text: value,
      // The paragraph text is HTML-decoded, so its exact byte offset is not
      // stable after tags/entities are removed. An external citation anywhere
      // in the same content document is still auditable evidence; citation
      // markers cover pages that use footnotes instead of anchors.
      supported: /<a\b[^>]+href=["']https?:\/\//i.test(html) || /\[\d+\]|<cite\b|data-source/i.test(html),
    }));
  const statistics = paragraphs
    .filter(value => /\b\d+(?:\.\d+)?\s*%|\b\d+(?:\.\d+)?\s*(?:million|billion|thousand|users?|people|items?|ms|seconds?)\b|\d+(?:\.\d+)?\s*%/i.test(value) || /\d+(?:\.\d+)?\s*%/.test(value))
    .map(value => ({
      text: value,
      supported: claims.find(claim => claim.text === value)?.supported ?? /\[\d+\]|<cite\b|data-source/i.test(value),
    }));
  return { pageUrl: page.url, pageType: page.page_type, title, text, paragraphs, entityNames, authorNames, siteLabels, dates, claims, statistics };
}

function contentPagesFor(context: AuditContext, signals: GeoPageSignals[]): GeoPageSignals[] {
  return signals.filter(page => {
    if (['article', 'documentation', 'product'].includes(page.pageType)) return true;
    if (['news_media', 'editorial'].includes(context.site_archetype) && page.pageType === 'other') return true;
    return false;
  });
}

function directAnswerApplicable(context: AuditContext, page: GeoPageSignals): boolean {
  if (['documentation', 'product'].includes(page.pageType)) return true;
  if (['saas', 'ecommerce', 'local_business', 'professional_services', 'news_media'].includes(context.site_archetype)) return true;
  return /\?|^(how|what|why|when|which)\b|教程|指南|如何|什么是/i.test(`${page.title} ${page.paragraphs[0] ?? ''}`);
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
  const classification = classifyArchetype(nodes, input.pages, input.archetypeHint);
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
  addFailureCap('critical', 'CRITICAL_FAILURE', SCORE_POLICY.severity_caps.critical);
  addFailureCap('major', 'MAJOR_FAILURE', SCORE_POLICY.severity_caps.major);
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

function moduleData<T extends Record<string, unknown>>(modules: Record<string, ModuleResult>, name: string): T | null {
  const result = modules[name];
  return result?.status === 'ok' || result?.status === 'partial' ? result.data as T : null;
}

function statusFromModule(modules: Record<string, ModuleResult>, name: string): CheckStatus | null {
  const status = modules[name]?.status;
  return status === 'failed' ? 'error' : status === 'skipped' ? 'unknown' : null;
}

export function buildLighthouseChecks(
  lighthouse: Record<string, any> | null,
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
  lighthouse: Record<string, any>,
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
  const technical = moduleData<Record<string, any>>(modules, 'technical_seo');
  const content = moduleData<Record<string, any>>(modules, 'content_quality');
  const schema = moduleData<Record<string, any>>(modules, 'schema_audit');
  const robots = moduleData<Record<string, any>>(modules, 'robots_sitemap');
  const onPage = moduleData<Record<string, any>>(modules, 'on_page_seo');
  const accessibility = moduleData<Record<string, any>>(modules, 'accessibility');
  const mobile = moduleData<Record<string, any>>(modules, 'mobile_audit');
  const crux = moduleData<Record<string, any>>(modules, 'crux');
  const lighthouse = moduleData<Record<string, any>>(modules, 'lighthouse');
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

  output.push(check({
    id: 'seo.https_transport', category: 'seo', weight: 3,
    status: !primaryAvailable ? 'unknown' : techError ?? (httpsEnabled ? (httpsEnabled.passed ? 'pass' : 'fail') : 'unknown'),
    source: 'technical_seo', pageUrl,
    evidence: httpsEnabled ? [httpsEnabled.detail ?? (httpsEnabled.passed ? 'HTTPS is enabled' : 'HTTPS is not enabled')] : [],
  }));
  output.push(check({
    id: 'seo.response_time', category: 'seo', weight: 2,
    status: !primaryAvailable ? 'unknown' : techError ?? (responseTime
      ? (responseTime.passed ? 'pass' : 'fail')
      : Number.isFinite(Number(technical?.response_time_ms)) ? (Number(technical?.response_time_ms) < 2000 ? 'pass' : 'fail') : 'unknown'),
    source: 'technical_seo', pageUrl,
    evidence: responseTime ? [responseTime.detail ?? `${Number(technical?.response_time_ms ?? 0)}ms`] : [],
  }));
  output.push(check({
    id: 'seo.title_length', category: 'seo', weight: 1,
    status: !primaryAvailable ? 'unknown' : !pageMeta?.title ? 'not_applicable' : techError ?? (titleLength
      ? (titleLength.passed ? 'pass' : 'fail')
      : String(pageMeta.title).length >= 30 && String(pageMeta.title).length <= 70 ? 'pass' : 'fail'),
    source: 'technical_seo', pageUrl,
    evidence: titleLength ? [titleLength.detail ?? `${String(pageMeta?.title ?? '').length} characters`] : [],
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
    status: !primaryAvailable ? 'unknown' : imageTotal === 0 ? 'not_applicable' : mobileError ?? onPageError ?? (mobile || onPage?.images ? (mobile?.has_responsive_images || responsiveImages > 0 ? 'pass' : 'fail') : 'unknown'),
    source: 'mobile_audit', pageUrl,
    evidence: imageTotal === 0 ? ['No images found'] : [`${responsiveImages}/${imageTotal} images expose srcset/sizes`, `mobile responsive image signal=${mobile?.has_responsive_images === true ? 'present' : 'not detected'}`],
  }));
  output.push(check({
    id: 'seo.render_blocking', category: 'seo', weight: 1,
    status: !primaryAvailable ? 'unknown' : techError ?? (technical ? (Number(technical.render_blocking_scripts ?? 0) === 0 ? 'pass' : 'fail') : 'unknown'),
    source: 'technical_seo', pageUrl, evidence: technical ? [`${Number(technical.render_blocking_scripts ?? 0)} render-blocking scripts`] : [],
  }));
  output.push(check({
    id: 'seo.html_compression', category: 'seo', weight: 1,
    status: !primaryAvailable ? 'unknown' : techError ?? (compression ? (compression.passed ? 'pass' : 'fail') : technical?.compression ? (technical.compression.enabled ? 'pass' : 'fail') : 'unknown'),
    source: 'technical_seo', pageUrl,
    evidence: compression ? [compression.detail ?? 'Compression checked'] : technical?.compression ? [`encoding=${technical.compression.encoding ?? 'none'}`] : [],
  }));
  output.push(check({
    id: 'seo.page_weight', category: 'seo', weight: 1,
    status: !primaryAvailable ? 'unknown' : techError ?? (technical && Number.isFinite(Number(technical.page_weight_kb)) ? (Number(technical.page_weight_kb) <= 500 ? 'pass' : 'fail') : 'unknown'),
    source: 'technical_seo', pageUrl, evidence: technical ? [`HTML document ${Number(technical.page_weight_kb ?? 0)} KB`] : [],
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
    status: !primaryAvailable ? 'unknown' : techError ?? (technical?.security_headers ? (Number(technical.security_headers.score ?? 0) >= 80 ? 'pass' : 'fail') : 'unknown'),
    source: 'technical_seo', pageUrl, evidence: technical?.security_headers ? [`Header coverage score ${Number(technical.security_headers.score ?? 0)}/100`] : [],
  }));

  const pushCruxMetric = (id: string, metric: string, threshold: number, weight: number) => {
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
  const crawlerPolicy = technical?.crawler_policy_v2 && typeof technical.crawler_policy_v2 === 'object'
    ? technical.crawler_policy_v2 as Record<string, any>
    : null;
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
  const authorApplicable = ['personal_blog', 'editorial', 'news_media', 'portfolio'].includes(context.site_archetype);
  const authorPages = contentSignals.filter(page => page.authorNames.length > 0 || page.pageType === 'article');
  const missingAuthorPages = authorPages.filter(page => page.authorNames.length === 0);
  output.push(check({ id: 'geo.author_signal', category: 'geo', title: zh ? '作者归属信号' : 'Author attribution', weight: 2,
    status: !primaryAvailable ? 'unknown' : !authorApplicable ? 'not_applicable' : missingAuthorPages.length > 0 ? 'fail' : (schemas.has('Person') || pageMeta?.article_author || geoSignals.some(page => page.authorNames.length > 0) ? 'pass' : 'fail'),
    source: 'json_ld', pageUrl, evidence: !primaryAvailable
      ? ['Primary page content was not available']
      : missingAuthorPages.length > 0
        ? missingAuthorPages.map(page => `${page.pageUrl}: no author metadata`).slice(0, 8)
        : geoSignals.flatMap(page => page.authorNames.map(name => `${page.pageUrl}: ${name}`)).slice(0, 8) }));
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
  const labels = [...new Set(labelPages.flatMap(page => page.siteLabels.map(normalizedEntityName)).filter(Boolean))];
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

const PRIORITIES: Record<string, number> = {
  'seo.page_fetch': 100, 'seo.indexability': 98, 'seo.robots': 96, 'seo.https_transport': 95,
  'geo.extractability': 94, 'seo.sitemap': 88, 'seo.mobile_viewport': 87,
  'seo.canonical': 86, 'seo.title': 85, 'seo.meta_description': 83, 'seo.h1': 82,
  'geo.entity_identity': 90, 'geo.entity_consistency': 84, 'geo.author_signal': 82,
  'geo.claim_source_support': 81, 'geo.statistic_provenance': 80,
  'seo.schema_fit': 84, 'seo.schema_presence': 82, 'seo.response_time': 80,
  'seo.cwv_lcp': 83, 'seo.cwv_cls': 83, 'seo.cwv_inp': 82,
  'seo.lab_performance': 81, 'seo.lab_lcp': 81, 'seo.lab_cls': 81,
  'seo.mobile_usability': 80, 'geo.cross_page_consistency': 78,
  'seo.html_conformance': 62, 'seo.open_graph': 60, 'seo.heading_hierarchy': 60,
  'seo.image_alt': 60, 'seo.title_length': 58, 'seo.meta_description_length': 57,
  'seo.html_compression': 56, 'seo.render_blocking': 55, 'seo.page_weight': 54,
  'seo.dom_size': 54, 'seo.form_labels': 54, 'seo.aria_landmarks': 53,
  'seo.descriptive_links': 52, 'seo.skip_navigation': 50, 'seo.internal_links': 50,
  'seo.image_dimensions': 49, 'seo.responsive_images': 49, 'seo.hreflang': 48,
  'seo.rss_feed': 45, 'geo.direct_answer': 58, 'geo.freshness': 52,
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
  const language = zh ? 'zh' : 'en';
  const fallbackTitle = checkItem.localized_title?.[language]
    ?? CHECK_TITLES[checkItem.id]?.[language]
    ?? checkItem.title;
  if (copies[checkItem.id]) return copies[checkItem.id];

  const metadataQuality = new Set([
    'seo.title_length', 'seo.meta_description_length', 'seo.open_graph', 'seo.hreflang',
  ]);
  const mobileQuality = new Set(['seo.mobile_viewport', 'seo.mobile_usability']);
  const structureQuality = new Set(['seo.heading_hierarchy', 'seo.internal_links']);
  const imageQuality = new Set(['seo.image_alt', 'seo.image_dimensions', 'seo.responsive_images']);
  const accessibilityQuality = new Set(['seo.form_labels', 'seo.aria_landmarks', 'seo.descriptive_links', 'seo.skip_navigation']);
  const deliveryQuality = new Set(['seo.response_time', 'seo.render_blocking', 'seo.html_compression', 'seo.page_weight', 'seo.dom_size']);
  const performanceQuality = new Set([
    'seo.cwv_lcp', 'seo.cwv_cls', 'seo.cwv_inp', 'seo.cwv_fcp', 'seo.cwv_ttfb',
    'seo.lab_performance', 'seo.lab_lcp', 'seo.lab_cls', 'seo.lab_tbt',
  ]);
  const sourceQuality = new Set(['geo.claim_source_support', 'geo.statistic_provenance']);

  if (checkItem.id === 'seo.https_transport') {
    return zh
      ? { title: '为公开页面启用完整 HTTPS', why: '目标页没有通过 HTTPS 提供，属于抓取、信任与浏览器安全的基础故障。', fix: '配置有效证书，并将 HTTP 永久重定向到同一 HTTPS canonical URL；同时修复混合内容。', verify: '分别请求 HTTP 与 HTTPS URL，确认最终为 HTTPS 200 且无混合内容后重新审计。' }
      : { title: 'Serve the public page entirely over HTTPS', why: 'The target page is not available over HTTPS, which is a foundational crawl, trust, and browser-security failure.', fix: 'Install a valid certificate, permanently redirect HTTP to the matching HTTPS canonical URL, and remove mixed content.', verify: 'Request both HTTP and HTTPS, confirm the final response is HTTPS 200 with no mixed content, then re-audit.' };
  }
  if (metadataQuality.has(checkItem.id)) {
    return zh
      ? { title: `修复${fallbackTitle}`, why: '当前 metadata 的长度、完整性或语言映射没有满足已验证条件，可能导致搜索摘要截断或页面关系不清晰。', fix: '只修改证据指向的字段：标题保持唯一且简洁，description 与可见内容一致，Open Graph 补齐核心字段，多语言页添加互相对应的 hreflang。', verify: '检查最终 HTML head 中的对应标签和值，并重新审计目标页。' }
      : { title: `Fix ${fallbackTitle}`, why: 'The verified metadata length, completeness, or language mapping does not meet the check, which can produce truncated snippets or ambiguous page relationships.', fix: 'Change only the evidenced field: keep titles unique and concise, align descriptions with visible copy, complete core Open Graph fields, and add reciprocal hreflang only for verified language variants.', verify: 'Inspect the final HTML head for the exact tags and values, then re-audit the target page.' };
  }
  if (mobileQuality.has(checkItem.id)) {
    return zh
      ? { title: `修复${fallbackTitle}`, why: '页面的 viewport、字体或点击目标证据表明基础移动端体验不可靠。', fix: '添加正确的 width=device-width viewport，移除过小的正文文字，并让交互控件具备足够可点击尺寸和间距。', verify: '在窄屏真实浏览器中检查布局和交互，再运行移动端审查。' }
      : { title: `Fix ${fallbackTitle}`, why: 'Viewport, font-size, or tap-target evidence shows that the basic mobile experience is unreliable.', fix: 'Add a correct width=device-width viewport, remove undersized body text, and give interactive controls adequate target size and spacing.', verify: 'Inspect the page in a narrow real browser viewport and re-run the mobile audit.' };
  }
  if (structureQuality.has(checkItem.id)) {
    return zh
      ? { title: `改进${fallbackTitle}`, why: '当前页面结构让主题层级或站内关系难以被稳定解析。', fix: '按 H1→H2→H3 顺序组织标题，并从正文中加入指向真实相关页面的描述性内部链接。', verify: '检查渲染后的 heading outline 和内部链接目标，再重新审计。' }
      : { title: `Improve ${fallbackTitle}`, why: 'The current document structure makes topic hierarchy or internal page relationships harder to parse reliably.', fix: 'Use an H1→H2→H3 heading order and add descriptive internal links to genuinely related pages from the visible content.', verify: 'Inspect the rendered heading outline and internal destinations, then re-audit.' };
  }
  if (imageQuality.has(checkItem.id)) {
    return zh
      ? { title: `修复${fallbackTitle}`, why: '已发现图片缺少替代文本、稳定尺寸或响应式候选，影响可访问性与加载稳定性。', fix: '为信息型图片写与内容一致的 alt，为装饰图使用空 alt；声明 width/height，并为大图提供 srcset/sizes。', verify: '检查证据列出的 img 元素，确认属性已输出到最终 HTML 后重新审计。' }
      : { title: `Fix ${fallbackTitle}`, why: 'Verified images lack alternative text, stable dimensions, or responsive candidates, affecting accessibility and loading stability.', fix: 'Write factual alt text for informative images and empty alt for decorative ones; declare width/height and provide srcset/sizes for large images.', verify: 'Inspect the evidenced img elements in final HTML and re-run the audit.' };
  }
  if (accessibilityQuality.has(checkItem.id)) {
    return zh
      ? { title: `修复${fallbackTitle}`, why: 'WCAG 结构证据显示表单、地标、链接文本或键盘跳转信息不完整。', fix: '为输入控件关联 label/ARIA 标签，使用 main/nav 地标，替换“点击这里”等泛化链接文字，并添加可聚焦的跳过导航链接。', verify: '用键盘遍历页面并检查可访问性树，确认对应规则通过后重新审计。' }
      : { title: `Fix ${fallbackTitle}`, why: 'WCAG structure evidence shows incomplete form labels, landmarks, link text, or keyboard navigation.', fix: 'Associate inputs with labels or ARIA names, use main/nav landmarks, replace generic link text, and add a focusable skip-navigation link.', verify: 'Keyboard-test the page and inspect the accessibility tree, then re-audit until the rule passes.' };
  }
  if (deliveryQuality.has(checkItem.id)) {
    return zh
      ? { title: `优化${fallbackTitle}`, why: '服务器响应或 HTML 交付证据超过了本检查的明确阈值。', fix: '根据证据处理对应瓶颈：缓存或优化后端、为脚本添加 defer/async、启用 Brotli/Gzip、缩减初始 HTML 与不必要 DOM。', verify: '重新抓取最终响应并比较响应时间、编码、文档体积、DOM 数或阻塞脚本数量。' }
      : { title: `Improve ${fallbackTitle}`, why: 'Server-response or HTML-delivery evidence exceeds the explicit threshold for this check.', fix: 'Address the evidenced bottleneck: cache or optimize backend work, defer non-critical scripts, enable Brotli/Gzip, and reduce initial HTML or unnecessary DOM.', verify: 'Fetch the final response again and compare latency, encoding, document size, DOM count, or blocking scripts.' };
  }
  if (performanceQuality.has(checkItem.id)) {
    return zh
      ? { title: `改善${fallbackTitle}`, why: 'CrUX 现场数据或 PageSpeed 实验室数据超过了良好体验阈值。', fix: '以证据中的具体指标为目标：优化首屏关键资源与 LCP 元素，预留媒体尺寸减少 CLS，拆分长任务并降低主线程阻塞。', verify: '重新运行 PageSpeed，并在有足够真实流量后复查 CrUX p75；确认该指标进入良好阈值。' }
      : { title: `Improve ${fallbackTitle}`, why: 'CrUX field data or PageSpeed lab evidence is outside the good-experience threshold.', fix: 'Target the evidenced metric: optimize critical resources and the LCP element, reserve media space to reduce CLS, and split long tasks to reduce main-thread blocking.', verify: 'Re-run PageSpeed and later review CrUX p75 after sufficient traffic; confirm the metric reaches the good threshold.' };
  }
  if (checkItem.id === 'seo.rss_feed') {
    return zh
      ? { title: '发布可发现的 RSS 或 Atom feed', why: '这是内容发布型站点，但首页没有声明可验证的订阅源。', fix: '生成包含真实 canonical 文章 URL 的 RSS/Atom feed，并在 head 中添加 alternate feed link。', verify: '访问 feed URL，验证 XML 并确认首页 head 能发现它后重新审计。' }
      : { title: 'Publish a discoverable RSS or Atom feed', why: 'This is a publishing-oriented site, but the homepage does not declare a verifiable feed.', fix: 'Generate an RSS/Atom feed containing real canonical article URLs and link it from the homepage head.', verify: 'Open and validate the feed XML, confirm discovery from the homepage head, and re-audit.' };
  }
  if (checkItem.id === 'seo.schema_presence') {
    return zh
      ? { title: '添加与页面事实一致的基础结构化数据', why: '目标页没有发现可验证的 JSON-LD 实体或页面类型。', fix: '按已识别的站点类型添加最小的 Person、Organization、WebSite、Article 或其他适用 schema，只填写页面公开支持的字段。', verify: '用 Schema.org Validator 验证 JSON-LD，并重新审计确认 schema presence 通过。' }
      : { title: 'Add baseline structured data grounded in page facts', why: 'No verifiable JSON-LD entity or page type was found on the target page.', fix: 'Add the minimum Person, Organization, WebSite, Article, or other schema appropriate to the detected archetype, using only publicly supported fields.', verify: 'Validate the JSON-LD with Schema.org Validator and re-audit until schema presence passes.' };
  }
  if (checkItem.id === 'geo.entity_consistency' || checkItem.id === 'geo.cross_page_consistency') {
    return zh
      ? { title: `统一${fallbackTitle}`, why: '抽样页面对站点或实体名称给出了互相冲突的可验证信号。', fix: '确定一个公开主名称，并在 title、站点名称、JSON-LD name/url 和作者/发布者关系中保持一致；不要把文章作者当作站点品牌。', verify: '检查所有证据页面的 metadata 与 JSON-LD，再进行整站重新审计。' }
      : { title: `Align ${fallbackTitle}`, why: 'Sampled pages expose conflicting verifiable names for the site or entity.', fix: 'Choose one public primary name and keep title, site name, JSON-LD name/url, and author/publisher relationships consistent; do not treat an article author as the site brand.', verify: 'Inspect metadata and JSON-LD on every evidenced page, then re-run the site audit.' };
  }
  if (checkItem.id === 'geo.direct_answer') {
    return zh
      ? { title: '在适用页面增加直接回答段落', why: '该页面类型需要回答明确问题，但开头没有可独立提取的简洁答案。', fix: '在主标题后先用一段话直接回答核心问题，再展开背景、步骤和限制；不得为了分数制造 FAQ。', verify: '读取禁用 JavaScript 后的正文开头，确认答案完整可理解，再重新审计。' }
      : { title: 'Add a direct answer paragraph where applicable', why: 'This page type addresses a clear question, but its opening lacks a concise answer that stands on its own.', fix: 'Answer the core question in one paragraph immediately after the main heading, then expand with context, steps, and limitations; do not manufacture an FAQ.', verify: 'Read the opening with JavaScript disabled, confirm it is independently understandable, and re-audit.' };
  }
  if (sourceQuality.has(checkItem.id)) {
    return zh
      ? { title: `补齐${fallbackTitle}`, why: '检测到的主张或统计数字没有与可验证来源建立足够关联。', fix: '在相应句子附近链接原始资料、数据集或可信一手来源，并写明日期、口径和适用范围。', verify: '逐条检查证据中的主张或数字，确认相邻来源可访问且支持原文后重新审计。' }
      : { title: `Complete ${fallbackTitle}`, why: 'Detected claims or statistics are not sufficiently connected to verifiable sources.', fix: 'Link the relevant sentence to primary material, datasets, or reliable first-party sources and state the date, methodology, and scope.', verify: 'Review each evidenced claim or number, confirm the adjacent source is accessible and supports it, then re-audit.' };
  }
  if (checkItem.id === 'geo.freshness') {
    return zh
      ? { title: '为文章或文档补充发布日期与更新时间', why: '适用的内容页没有公开可验证的 published/modified 时间信号。', fix: '在可见页面和 Article/TechArticle metadata 中提供真实发布日期；只有内容实质更新时才修改 updated 时间。', verify: '检查最终 HTML 与 JSON-LD 的日期一致且可解析，再重新审计代表页。' }
      : { title: 'Add publication and update dates to the content page', why: 'An applicable article or documentation page lacks a public, verifiable published/modified signal.', fix: 'Expose the real publication date in visible copy and Article/TechArticle metadata; change the updated date only after a substantive edit.', verify: 'Confirm final HTML and JSON-LD dates agree and parse correctly, then re-audit the representative page.' };
  }
  return { title: fallbackTitle, ...generic };
}

export function buildRecommendations(context: AuditContext, checks: NormalizedCheck[]): AuditRecommendation[] {
  const zh = context.locale.toLowerCase().startsWith('zh');
  return checks
    // Zero-weight checks are informational/provider probes. They remain in the
    // report as evidence, but must not create a repair task with no score impact.
    .filter(item => item.status === 'fail' && !item.predicted && item.weight > 0)
    .map(item => {
      const localized = {
        en: recommendationCopy(item, false),
        zh: recommendationCopy(item, true),
      };
      const copy = localized[zh ? 'zh' : 'en'];
      const severityBase = { critical: 90, major: 72, minor: 45, info: 0 }[item.severity];
      const priority = PRIORITIES[item.id] ?? severityBase + Math.round(item.weight * item.confidence * 3);
      const evidence = item.evidence.join('; ') || (zh ? '该页面未满足检查条件' : 'The page did not satisfy this check');
      const impact: AuditRecommendation['impact'] = priority >= 80 ? 'high' : priority >= 55 ? 'medium' : 'low';
      const effort: AuditRecommendation['effort'] = priority >= 90 ? 'medium' : 'low';
      return {
        id: item.id,
        template_id: item.id,
        category: item.category,
        severity: item.severity,
        priority,
        title: copy.title,
        page_url: item.page_url,
        evidence,
        source: item.source,
        confidence: item.confidence,
        why: copy.why,
        fix: copy.fix,
        verify: copy.verify,
        what_to_do: copy.fix,
        validation: copy.verify,
        impact,
        effort,
        localized,
      };
    })
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}
