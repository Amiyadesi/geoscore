import type { FetchedAuditPage } from './audit-pages';
import { registrableRoot } from './audit-pages';
import { SITE_ARCHETYPES, type AuditContext, type AuditEntity, type AuditEvidence, type BuildAuditContextInput, type SiteArchetype } from './audit-contract';
import { extractJsonLdBlocks } from './json-ld';

type JsonObject = Record<string, unknown>;

interface JsonLdNode {
  node: JsonObject;
  pageUrl: string;
  pageType: string;
}

export function isSiteArchetype(value: string | null | undefined): value is SiteArchetype {
  return !!value && (SITE_ARCHETYPES as readonly string[]).includes(value);
}

export function clamp01(value: number): number {
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
    for (const block of extractJsonLdBlocks(page.html)) {
      try {
        const extracted: JsonObject[] = [];
        flattenJsonLd(JSON.parse(block), extracted);
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

function visibleMarkup(html: string): string {
  return html
    .replace(/<!--[^]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
}

function visibleText(html: string): string {
  return visibleMarkup(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function siteIdentityText(html: string): string {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
  const firstHeading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '';
  return [title, firstHeading].map(visibleText).filter(Boolean).join(' ');
}

function navigationMarkup(html: string): string {
  return [...html.matchAll(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi)]
    .map(match => match[0])
    .join('\n');
}

interface InternalLinkSignal {
  target: URL;
  text: string;
}

function internalLinkSignals(html: string, pageUrl: string | undefined): InternalLinkSignal[] {
  if (!pageUrl) return [];
  try {
    const base = new URL(pageUrl);
    const root = registrableRoot(base.hostname);
    if (!root) return [];
    return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].flatMap(match => {
      try {
        const hrefMatch = (match[1] ?? '').match(/(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
        const href = hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3];
        if (!href) return [];
        const target = new URL(href, base);
        if (registrableRoot(target.hostname) !== root) return [];
        return [{ target, text: visibleText(match[0]) }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function hasLinkPath(links: InternalLinkSignal[], pathPattern: RegExp): boolean {
  return links.some(link => pathPattern.test(link.target.pathname));
}

function hasLinkPathAndText(links: InternalLinkSignal[], pathPattern: RegExp, textPattern: RegExp): boolean {
  return links.some(link => pathPattern.test(link.target.pathname) && textPattern.test(link.text));
}

function hasLinkText(html: string, textPattern: RegExp): boolean {
  return [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)]
    .some(match => textPattern.test(visibleText(match[0])));
}

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
  const html = visibleMarkup(pages.map(page => page.html).join('\n'));
  const visibleHomeHtml = visibleMarkup(homeHtml);
  const lower = visibleText(html).toLowerCase();
  const homeLower = visibleText(visibleHomeHtml).toLowerCase();
  const homeIdentity = siteIdentityText(visibleHomeHtml);
  const homeNavigation = navigationMarkup(visibleHomeHtml);
  const homeLinks = internalLinkSignals(visibleHomeHtml, pageUrl);
  const navigationLinks = internalLinkSignals(homeNavigation, pageUrl);
  const pageTypes = new Set(pages.map(page => page.page_type));
  const hasType = (...values: string[]) => values.some(value => types.has(value));
  const hasHomeType = (...values: string[]) => values.some(value => homeTypes.has(value));
  const hasNonArticleType = (...values: string[]) => values.some(value => nonArticleTypes.has(value));
  const hasHomeLocal = [...homeTypes].some(type => LOCAL_TYPES.has(type) || type.endsWith('Store'));

  if (isSiteArchetype(hint)) {
    return {
      archetype: hint,
      confidence: 0.98,
      evidence: [{ source: 'request_hint', page_url: pageUrl, value: `archetype_hint=${hint}`, confidence: 0.98 }],
    };
  }
  if (hasType('SoftwareApplication', 'WebApplication')) return strong('saas', 'Software application JSON-LD', pageUrl);
  if (hasNonArticleType('NewsMediaOrganization', 'Newspaper') || hasHomeType('NewsArticle')) return strong('news_media', 'News-specific site JSON-LD', pageUrl);
  if (hasHomeLocal) return strong('local_business', 'Homepage LocalBusiness-compatible JSON-LD', pageUrl);
  if (hasType('DiscussionForumPosting')) return strong('community', 'Discussion forum JSON-LD', pageUrl);
  if (hasType('NGO', 'Nonprofit501c3')) return strong('nonprofit', 'Nonprofit JSON-LD', pageUrl);
  if (hasHomeType('Product') && !hasType('SoftwareApplication', 'WebApplication')) return strong('ecommerce', 'Homepage Product JSON-LD', pageUrl);
  if (hasHomeType('Blog') && hasHomeType('Person')) return strong('personal_blog', 'Blog and Person JSON-LD', pageUrl);
  if (hasHomeType('ProfilePage') && hasHomeType('Person')) return strong('portfolio', 'Person profile JSON-LD', pageUrl, 0.9);

  const pricingNavigation = hasLinkPath(homeLinks, /(?:^|\/)(?:pricing|plans)(?:\/|$)/i);
  const productAccountNavigation = hasLinkPath(homeLinks, /(?:^|\/)(?:signup|sign-up|register|login|dashboard|app)(?:\/|$)/i);
  const documentationPath = /(?:^|\/)(?:docs?|guide|api|reference|manual)(?:\/|$)/i;
  const directDocumentationNavigation = hasLinkPath(navigationLinks, documentationPath)
    || hasLinkPathAndText(
      homeLinks,
      documentationPath,
      /\b(?:docs?|documentation|guide|reference|manual)\b|文档|指南|手册/i,
    );
  const developerNavigation = directDocumentationNavigation
    || hasLinkPath(homeLinks, /(?:^|\/)(?:docs?|developers?|api|guides?)(?:\/|$)/i)
    || pageTypes.has('documentation');
  const commerceNavigation = hasLinkPath(homeLinks, /(?:^|\/)(?:cart|checkout|collections?|shop|store)(?:\/|$)/i)
    || homeLinks.some(link => /^(?:cart|shop|store)\./i.test(link.target.hostname));
  const productLanguage = /\b(platform|software|api|developers?|infrastructure|payments?|billing|product)\b/i.test(homeLower);
  const organizationBacked = hasHomeType('Organization', 'Corporation', 'WebSite', 'OnlineBusiness');
  const homeHostname = (() => {
    try { return new URL(pageUrl ?? '').hostname.toLowerCase(); } catch { return ''; }
  })();
  const documentationHost = /^(?:docs?|developer|developers|reference|manual)\./i.test(homeHostname);
  const documentationIdentity = /\b(?:documentation|developer docs?|api reference|language reference|user manual)\b|开发文档|接口文档|参考手册/i.test(homeIdentity);
  const communityIdentity = /\b(?:community|forum|discussion forum)\b|(?:交流|理想型|技术|开放|友好)?社区|论坛|讨论区/i.test(homeIdentity);
  const discussionNavigation = hasLinkPath(navigationLinks, /(?:^|\/)(?:categories|latest|topics?|questions?|discussions?|forum)(?:\/|$)/i);
  const restaurantLanguage = /\b(?:restaurant|cafe|café|bistro|brasserie|dining)\b|餐厅|餐馆|咖啡馆/i.test(homeLower);
  const reservationAction = hasLinkPath(homeLinks, /(?:^|\/)(?:reservations?|book(?:ing)?)(?:\/|$)/i)
    || hasLinkText(visibleHomeHtml, /\b(?:reservations?|reserve|book(?:ing)?)\b|预订|预约/i);
  const localIdentity = /\b(?:hotel|clinic|dental|dentist|physician|pharmacy|salon|attorney|law firm|accountant|real estate|veterinary)\b|酒店|诊所|牙科|律师事务所|美容院/i.test(homeIdentity);
  const localContactAction = hasLinkPath(homeLinks, /(?:^|\/)(?:contact|locations?|hours|book(?:ing)?)(?:\/|$)/i);
  const nonprofitIdentity = /\b(?:nonprofit|non-profit|not[- ]for[- ]profit|not profit|charity|foundation)\b/i.test(homeIdentity);
  const nonprofitAction = hasLinkPath(homeLinks, /(?:^|\/)(?:donate|donation|support-us|membership)(?:\/|$)/i);
  const professionalServicesNavigation = hasLinkPath(homeLinks, /(?:^|\/)services(?:\/|$)/i);
  const industriesNavigation = hasLinkPath(homeLinks, /(?:^|\/)industries(?:\/|$)/i);
  const professionalServicesLanguage = /\b(?:consulting|advisory|audit and assurance|professional services|tax services)\b/i.test(homeLower);
  if (communityIdentity && discussionNavigation) {
    return strong('community', 'Visible community/forum identity in the homepage title, heading, or navigation', pageUrl, 0.88);
  }
  if (/\b(?:personal blog|my blog|weblog)\b|个人博客|个人网站|网络日志|个人空间|随笔/i.test(homeIdentity)) {
    return strong('personal_blog', 'Personal blog or weblog identity in the homepage title or primary heading', pageUrl, 0.82);
  }
  if (communityIdentity || (/\b(?:community|forum)\b|社区|论坛/i.test(homeLower) && discussionNavigation)) {
    return strong('community', 'Visible community/forum identity in the homepage title, heading, or navigation', pageUrl, 0.78);
  }
  const portfolioSections = new Set(
    [...homeNavigation.matchAll(/href=["']#(?:about|experience|projects?|work|portfolio)["']/gi)]
      .map(match => match[0].toLowerCase()),
  );
  const personalProfileLanguage = /\b(?:i am|i'm|i build|i design|i develop|my work|my projects)\b|我是|我是一名|我的作品/i.test(homeLower);
  if (portfolioSections.size >= 2 && personalProfileLanguage) {
    return strong('portfolio', 'Single-page personal profile with portfolio navigation', pageUrl, 0.82);
  }
  if (documentationHost || documentationIdentity
    || (directDocumentationNavigation && !pricingNavigation && !productAccountNavigation)) {
    return strong('documentation', 'Documentation hostname or primary site identity', pageUrl, 0.86);
  }
  const productPlatformSignals = [pricingNavigation, productAccountNavigation, developerNavigation, productLanguage]
    .filter(Boolean).length;
  if (organizationBacked && productPlatformSignals >= 2) {
    return strong('saas', 'Product platform navigation and site-level organization schema', pageUrl, 0.88);
  }
  if (professionalServicesNavigation && (industriesNavigation || professionalServicesLanguage)) {
    return strong('professional_services', 'Professional services and industries navigation', pageUrl, 0.8);
  }
  if ((restaurantLanguage && reservationAction) || (localIdentity && localContactAction)) {
    return strong('local_business', 'Local venue identity with menu, booking, or contact actions', pageUrl, 0.82);
  }
  if (nonprofitIdentity || (/\b(?:nonprofit|non-profit|charity)\b/i.test(homeLower) && nonprofitAction)) {
    return strong('nonprofit', 'Nonprofit page copy', pageUrl, 0.66);
  }
  if (commerceNavigation) {
    return strong('ecommerce', 'Commerce navigation', pageUrl, 0.78);
  }

  const editorialIdentity = /\b(?:blog|news|magazine|journal|publication)\b|博客|新闻|杂志|期刊/i.test(homeIdentity);
  if (hasHomeType('Blog') || (hasHomeType('BlogPosting', 'Article', 'TechArticle') && editorialIdentity)) {
    return strong('editorial', 'Homepage editorial JSON-LD and site identity', pageUrl, 0.9);
  }
  if (hasType('Blog', 'BlogPosting', 'Article', 'TechArticle') && !organizationBacked) {
    return strong('editorial', 'Editorial content without stronger site-level product identity', pageUrl, 0.76);
  }
  // Text collected from representative articles and archive pages is only a
  // weak site-level signal. It must not override schema-backed homepage identity.
  if (hasType('OnlineBusiness') && discussionNavigation && /\b(forum|community)\b/i.test(lower)) {
    return strong('community', 'Online business schema with community structure', pageUrl, 0.78);
  }
  if (discussionNavigation && /\b(forum|community)\b|社区|论坛/i.test(lower)) {
    return strong('community', 'Community/forum copy with discussion navigation', pageUrl, 0.7);
  }
  if (pageTypes.has('documentation') && developerNavigation) {
    return strong('documentation', 'Documentation paths and navigation', pageUrl, 0.78);
  }
  if (hasType('Service') && hasType('Organization')) return strong('professional_services', 'Service and Organization JSON-LD', pageUrl, 0.82);
  if (hasType('Person') && /\b(portfolio|projects|作品集)\b/i.test(lower)) return strong('portfolio', 'Person and portfolio structure', pageUrl, 0.8);

  if (pricingNavigation && productAccountNavigation) return strong('saas', 'Pricing and product application navigation', pageUrl, 0.68);
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
      ? ['NewsMediaOrganization', 'Organization', 'Corporation', 'WebSite']
      : archetype === 'saas'
        ? ['Organization', 'Corporation', 'SoftwareApplication', 'WebApplication', 'WebSite']
        : archetype === 'ecommerce'
          ? ['Organization', 'Corporation', 'Brand', 'Product', 'WebSite']
          : ['personal_blog', 'portfolio', 'editorial'].includes(archetype)
            ? ['Person', 'ProfilePage', 'Organization', 'Corporation', 'Blog', 'WebSite']
            : ['Organization', 'Corporation', 'LocalBusiness', 'WebSite', 'Blog'];
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

export function normalizedEntityName(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[\u2018\u2019']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function normalizedSiteLabel(value: string): string {
  const normalized = normalizedEntityName(value);
  const withoutChineseSuffix = normalized.replace(/(?:\u7684)?(?:\u4e66\u684c|\u535a\u5ba2|\u7f51\u7ad9|\u5c0f\u7ad9)$/u, '').trim();
  const withoutEnglishSuffix = withoutChineseSuffix
    .replace(/(?:s\s+)?(?:desk|blog|notes|website|site)$/u, '')
    .trim();
  return withoutEnglishSuffix || normalized;
}

/**
 * Return explicit same-type entity names per page. Missing schema on a sampled
 * page is absence of evidence, not a contradiction; only an explicit competing
 * name can fail consistency.
 */
export function sampledEntitySignals(
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

export interface GeoPageSignals {
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

export function geoPageSignals(page: FetchedAuditPage): GeoPageSignals {
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

export function contentPagesFor(context: AuditContext, signals: GeoPageSignals[]): GeoPageSignals[] {
  return signals.filter(page => {
    if (['article', 'documentation', 'product'].includes(page.pageType)) return true;
    if (['news_media', 'editorial'].includes(context.site_archetype) && page.pageType === 'other') return true;
    return false;
  });
}

export function directAnswerApplicable(context: AuditContext, page: GeoPageSignals): boolean {
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
