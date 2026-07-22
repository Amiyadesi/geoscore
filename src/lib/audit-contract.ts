import type { FetchedAuditPage } from './audit-pages';

export const SCORE_VERSION = '2.4.6';

export const SCORE_POLICY = {
  minimum_category_coverage: 0.6,
  minimum_overall_coverage: 0.6,
  minimum_overall_confidence: 0.5,
  severity_caps: { critical: 49, major: 79, minor: 94 },
  repeated_failure_caps: {
    critical: { step: 10, floor: 19 },
    major: { step: 10, floor: 49 },
  },
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
  'geo.author_signal': { en: 'Content responsibility', zh: '内容责任归属' },
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
