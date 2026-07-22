import { parseHTML } from 'linkedom';
import { challengeReason, detectJavaScriptShell, pageLocale, titleFromHtml } from './audit-html';
import {
  attemptBrowserRun,
  BROWSER_RUN_PROVIDER,
  type BrowserRunFallbackEvidence,
  type BrowserRunFallbackOptions,
} from './browser-run';
import { fetchWithTimeout, isRetryableHttpStatus, type HttpFetcher } from './http';
import { cancelResponseBody, readBoundedText, ResponseTooLargeError } from './response-body';
import { isValidPublicHostname } from './security';
import { registrableRoot } from './domain';
import { SubrequestBudgetExceeded } from './subrequest-budget';

export { buildBrowserAllowRequestPattern } from './browser-run';
export { detectJavaScriptShell } from './audit-html';
export type {
  BrowserRunAttemptState,
  BrowserRunFallbackError,
  BrowserRunFallbackEvidence,
  BrowserRunFallbackOptions,
} from './browser-run';
export { registrableRoot } from './domain';

export type AuditMode = 'site' | 'url';
export type AuditPageType = 'home' | 'about' | 'article' | 'documentation' | 'product' | 'category' | 'contact' | 'other';
export type AuditPageSource = 'requested' | 'homepage' | 'internal_link' | 'sitemap';

const MAX_AUDIT_HTML_BYTES = 2 * 1024 * 1024;
const MAX_SITEMAP_BYTES = 1 * 1024 * 1024;
const MAX_DISCOVERED_INTERNAL_LINKS = 2_000;
const DIRECT_HTTP_PROVIDER = 'Direct HTTP' as const;
const NON_HTML_PATH_EXTENSION = /\.(?:avif|bmp|css|csv|docx?|eot|gif|ico|jpe?g|js|json|map|markdown|md|mjs|mov|mp3|mp4|ogg|otf|pdf|png|pptx?|rar|rss|svg|tar|tgz|ttf|txt|wasm|webm|webmanifest|webp|woff2?|xlsx?|xml|zip)$/i;
const INFRASTRUCTURE_PATH = /(?:^|\/)(?:cdn-cgi|_next|_nuxt|_astro|wp-content|wp-includes)(?:\/|$)/i;

function sampleHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^www\./, '');
}

function isSameSampleHost(left: string, right: string): boolean {
  return sampleHostname(left) === sampleHostname(right);
}

function htmlAttributeValue(markup: string, attribute: string): string | null {
  const match = markup.match(new RegExp(`(?:^|\\s)${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))`, 'i'));
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').replace(/&amp;|&#0*38;|&#x0*26;/gi, '&') || null;
}

export interface AuditPageCandidate {
  url: string;
  page_type: AuditPageType;
  source: AuditPageSource;
}

export interface FetchedAuditPage extends AuditPageCandidate {
  status: 'complete' | 'error';
  title?: string;
  locale?: string;
  error?: string;
  error_code?: string;
  html: string;
  headers: Headers;
  response_ms: number;
  status_code: number;
  final_url: string;
  fetch_source?: 'http' | 'browser_run';
  provider?: typeof DIRECT_HTTP_PROVIDER | typeof BROWSER_RUN_PROVIDER;
  fallback_reason?: string;
  browser_ms_used?: number;
  browser_fallback?: BrowserRunFallbackEvidence;
}

export interface AuditPageSummary extends Omit<FetchedAuditPage, 'html' | 'headers' | 'response_ms' | 'status_code' | 'final_url'> {
  response_ms?: number;
  status_code?: number;
  final_url?: string;
}

export interface FetchAuditPageOptions {
  httpFallbackUrl?: string;
  browserFallback?: BrowserRunFallbackOptions;
}

interface HttpAuditPageOutcome {
  page: FetchedAuditPage;
  browserEligible: boolean;
  fallbackReason?: string;
}

class AuditPageFetchError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly browserEligible: boolean,
    readonly statusCode = 0,
    readonly finalUrl?: string,
    readonly responseHeaders = new Headers(),
  ) {
    super(message);
    this.name = 'AuditPageFetchError';
  }
}

async function fetchWithinRegistrableRoot(
  requestedUrl: string,
  timeoutMs: number,
  fetcher: HttpFetcher = fetchWithTimeout,
): Promise<{ response: Response; finalUrl: string }> {
  const requestedRoot = registrableRoot(new URL(requestedUrl).hostname);
  if (!requestedRoot) {
    throw new AuditPageFetchError('AUDIT_TARGET_INVALID', 'Invalid public target', false);
  }
  let currentUrl = requestedUrl;
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const current = new URL(currentUrl);
    if (registrableRoot(current.hostname) !== requestedRoot) {
      throw new AuditPageFetchError(
        'AUDIT_REDIRECT_OUTSIDE_ROOT',
        'Redirected outside the submitted registrable domain',
        false,
        0,
        currentUrl,
      );
    }
    const response = await fetcher(currentUrl, { timeoutMs, redirect: 'manual' });
    if (response.status < 300 || response.status >= 400) return { response, finalUrl: currentUrl };
    const location = response.headers.get('location');
    if (!location) return { response, finalUrl: currentUrl };
    const nextUrl = new URL(location, currentUrl);
    if (registrableRoot(nextUrl.hostname) !== requestedRoot) {
      await cancelResponseBody(response);
      throw new AuditPageFetchError(
        'AUDIT_REDIRECT_OUTSIDE_ROOT',
        'Redirected outside the submitted registrable domain',
        false,
        response.status,
        currentUrl,
        response.headers,
      );
    }
    await cancelResponseBody(response);
    currentUrl = nextUrl.toString();
  }
  throw new AuditPageFetchError(
    'AUDIT_TOO_MANY_REDIRECTS',
    `Too many redirects for ${requestedUrl}`,
    false,
    0,
    currentUrl,
  );
}

export function validatePublicAuditUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password || parsed.port) return null;
    const host = parsed.hostname.toLowerCase();
    if (!isValidPublicHostname(host)) return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

export function validateAuditTargetUrl(raw: string, submittedDomain: string): string | null {
  const validated = validatePublicAuditUrl(raw);
  if (!validated) return null;
  const submittedRoot = registrableRoot(submittedDomain);
  if (!submittedRoot || registrableRoot(new URL(validated).hostname) !== submittedRoot) return null;
  return validated;
}

export function classifyAuditPageType(url: string): AuditPageType {
  let path = '/';
  try { path = new URL(url).pathname.toLowerCase(); } catch { return 'other'; }
  const clean = path.replace(/\/+$/, '') || '/';
  if (clean === '/') return 'home';
  if (/(^|\/)(about|about-us|about-me|author|profile)(\/|$)/.test(clean)) return 'about';
  if (/(^|\/)(contact|contact-us)(\/|$)/.test(clean)) return 'contact';
  if (/(^|\/)(docs?|documentation|guide|guides|reference|manual|wiki)(\/|$)/.test(clean)) return 'documentation';
  if (/(^|\/)(products?|shop|store|collections?|item)(\/|$)/.test(clean)) return 'product';
  if (/(^|\/)(blog|posts?|articles?|news|stories|diary|journal)(\/|$)/.test(clean)) {
    const segments = clean.split('/').filter(Boolean);
    return segments.length >= 2 ? 'article' : 'category';
  }
  if (/(^|\/)(category|categories|tags?|topics?|archive)(\/|$)/.test(clean)) return 'category';
  return 'other';
}

export function isAuditableHtmlCandidate(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return !INFRASTRUCTURE_PATH.test(path) && !NON_HTML_PATH_EXTENSION.test(path);
  } catch {
    return false;
  }
}

export function extractInternalLinks(baseUrl: string, html: string): string[] {
  if (!html) return [];
  let base: URL;
  try { base = new URL(baseUrl); } catch { return []; }

  try {
    const links = new Set<string>();
    for (const anchor of html.matchAll(/<a\b([^>]*)>/gi)) {
      const href = htmlAttributeValue(anchor[1] ?? '', 'href')?.trim();
      if (!href || /^(#|mailto:|tel:|javascript:|data:)/i.test(href)) continue;
      try {
        const resolved = new URL(href, base);
        if (!['http:', 'https:'].includes(resolved.protocol)) continue;
        if (!isSameSampleHost(resolved.hostname, base.hostname)) continue;
        resolved.hash = '';
        if (!isAuditableHtmlCandidate(resolved.toString())) continue;
        links.add(resolved.toString());
        if (links.size >= MAX_DISCOVERED_INTERNAL_LINKS) break;
      } catch { /* ignore malformed links */ }
    }
    return [...links].sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function normalizedCandidates(urls: string[], homeUrl: string): string[] {
  const home = new URL(homeUrl);
  const homePath = home.pathname.replace(/\/+$/, '') || '/';
  const unique = new Set<string>();
  for (const raw of urls) {
    try {
      const url = new URL(raw, home);
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      if (!isSameSampleHost(url.hostname, home.hostname)) continue;
      url.hash = '';
      if (!isAuditableHtmlCandidate(url.toString())) continue;
      const cleanPath = url.pathname.replace(/\/+$/, '') || '/';
      if (cleanPath === homePath && url.search === home.search) continue;
      unique.add(url.toString());
    } catch { /* ignore malformed URLs */ }
  }
  return [...unique].sort((a, b) => a.localeCompare(b));
}

export function selectAuditPageCandidates(
  homeUrl: string,
  internalLinks: string[],
  sitemapUrls: string[],
): AuditPageCandidate[] {
  const internal = normalizedCandidates(internalLinks, homeUrl);
  const sitemap = normalizedCandidates(sitemapUrls, homeUrl);
  const selected: AuditPageCandidate[] = [];
  const used = new Set<string>();
  let representativeCount = 0;

  const aboutUrl = [...internal, ...sitemap].find(url => classifyAuditPageType(url) === 'about');
  if (aboutUrl) {
    selected.push({
      url: aboutUrl,
      page_type: 'about',
      source: internal.includes(aboutUrl) ? 'internal_link' : 'sitemap',
    });
    used.add(aboutUrl);
  }

  const preferred = sitemap.length > 0 ? sitemap : internal;
  const fallback = sitemap.length > 0 ? internal : [];
  const pool = [...preferred, ...fallback].filter(url => !used.has(url));
  const typeOrder: AuditPageType[] = ['article', 'documentation', 'product', 'category', 'contact', 'other'];

  for (const pageType of typeOrder) {
    if (representativeCount >= 3) break;
    const url = pool.find(candidate => !used.has(candidate) && classifyAuditPageType(candidate) === pageType);
    if (!url) continue;
    selected.push({
      url,
      page_type: pageType,
      source: sitemap.includes(url) ? 'sitemap' : 'internal_link',
    });
    used.add(url);
    representativeCount += 1;
  }

  for (const url of pool) {
    if (representativeCount >= 3) break;
    if (used.has(url)) continue;
    selected.push({
      url,
      page_type: classifyAuditPageType(url),
      source: sitemap.includes(url) ? 'sitemap' : 'internal_link',
    });
    used.add(url);
    representativeCount += 1;
  }

  return selected;
}

function extractSitemapLocations(xml: string): string[] {
  return [...xml.matchAll(/<loc(?:\s[^>]*)?>([\s\S]*?)<\/loc>/gi)]
    .map(match => match[1].replace(/&amp;/g, '&').trim())
    .filter(Boolean);
}

function sitemapReferences(homeUrl: string, html: string): string[] {
  const refs = new Set<string>();
  const head = html.match(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i)?.[0] ?? html.slice(0, 128 * 1024);
  for (const link of head.matchAll(/<link\b([^>]*)>/gi)) {
    const attributes = link[1] ?? '';
    const rel = htmlAttributeValue(attributes, 'rel')?.toLowerCase().split(/\s+/) ?? [];
    const href = htmlAttributeValue(attributes, 'href');
    if (!rel.includes('sitemap') || !href) continue;
    try { refs.add(new URL(href, homeUrl).toString()); } catch { /* use conventional paths */ }
  }
  const home = new URL(homeUrl);
  refs.add(new URL('/sitemap.xml', home).toString());
  refs.add(new URL('/sitemap_index.xml', home).toString());
  return [...refs];
}

export async function discoverSitemapPageUrls(
  homeUrl: string,
  html: string,
  fetcher: HttpFetcher = fetchWithTimeout,
): Promise<string[]> {
  const home = new URL(homeUrl);
  for (const sitemapUrl of sitemapReferences(homeUrl, html).slice(0, 3)) {
    try {
      if (!isSameSampleHost(new URL(sitemapUrl).hostname, home.hostname)) continue;
      const { response } = await fetchWithinRegistrableRoot(sitemapUrl, 7000, fetcher);
      if (!response.ok) {
        await cancelResponseBody(response);
        continue;
      }
      const xml = await readBoundedText(response, MAX_SITEMAP_BYTES, 'Sitemap');
      if (!/<(?:urlset|sitemapindex)\b/i.test(xml)) continue;
      let locations = extractSitemapLocations(xml);
      if (/<sitemapindex\b/i.test(xml)) {
        const child = locations.find(url => {
          try { return isSameSampleHost(new URL(url).hostname, home.hostname); } catch { return false; }
        });
        if (!child) return [];
        const { response: childResponse } = await fetchWithinRegistrableRoot(child, 7000, fetcher);
        if (!childResponse.ok) {
          await cancelResponseBody(childResponse);
          return [];
        }
        locations = extractSitemapLocations(await readBoundedText(childResponse, MAX_SITEMAP_BYTES, 'Child sitemap'));
      }
      return normalizedCandidates(locations, homeUrl).slice(0, 500);
    } catch { /* try next conventional sitemap URL */ }
  }
  return [];
}

function normalizeDirectFetchError(error: unknown): AuditPageFetchError {
  if (error instanceof AuditPageFetchError) return error;
  if (error instanceof ResponseTooLargeError) {
    return new AuditPageFetchError('AUDIT_RESPONSE_TOO_LARGE', error.message, true);
  }
  if (error instanceof SubrequestBudgetExceeded) {
    return new AuditPageFetchError(error.code, error.message, false);
  }

  const message = error instanceof Error ? error.message : 'Page fetch failed';
  const name = error instanceof Error ? error.name : '';
  if (name === 'AbortError' || /timed?\s*out|timeout|aborted/i.test(message)) {
    return new AuditPageFetchError('AUDIT_FETCH_TIMEOUT', message, true);
  }
  if (error instanceof TypeError || /network|fetch failed|socket|dns|connection|econn|enotfound/i.test(message)) {
    return new AuditPageFetchError('AUDIT_FETCH_NETWORK_ERROR', message, true);
  }
  return new AuditPageFetchError('AUDIT_FETCH_FAILED', message, false);
}

function immediateMetaRefreshTarget(html: string, currentUrl: string): string | null {
  // Most pages do not use a meta refresh. Avoid a full DOM parse unless the
  // markup contains an actual refresh directive.
  if (!/<meta\b[^>]*\bhttp-equiv\s*=\s*(?:"\s*refresh\s*"|'\s*refresh\s*'|refresh\b)/i.test(html)) {
    return null;
  }
  try {
    const { document } = parseHTML(html);
    const current = new URL(currentUrl);
    const currentRoot = registrableRoot(current.hostname);
    if (!currentRoot) return null;
    for (const meta of document.querySelectorAll('meta[http-equiv][content]')) {
      if (meta.getAttribute('http-equiv')?.trim().toLowerCase() !== 'refresh') continue;
      const content = meta.getAttribute('content')?.trim() ?? '';
      const match = content.match(/^([0-9]+(?:\.[0-9]+)?)\s*;\s*url\s*=\s*(.+)$/i);
      if (!match || Number(match[1]) > 1) continue;
      const rawTarget = match[2].trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2');
      const target = new URL(rawTarget, current);
      target.hash = '';
      if (!['http:', 'https:'].includes(target.protocol)) continue;
      if (registrableRoot(target.hostname) !== currentRoot) continue;
      if (!isAuditableHtmlCandidate(target.toString())) continue;
      if (target.toString() === current.toString()) continue;
      return target.toString();
    }
  } catch { /* malformed refresh markup remains ordinary page evidence */ }
  return null;
}

function isSoftNotFoundDocument(html: string): boolean {
  const marker = /^\s*(?:404\b|(?:page|resource|content)\s+(?:was\s+)?not\s+found\b|not\s+found\b|页面不存在|找不到页面|网页不存在)/i;
  const title = titleFromHtml(html) ?? '';
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() ?? '';
  return marker.test(title) || marker.test(heading);
}

function homepageAccessInterstitialReason(candidate: AuditPageCandidate, finalUrl: string): string | undefined {
  try {
    if (candidate.page_type !== 'home') return undefined;
    const requested = new URL(candidate.url);
    const final = new URL(finalUrl);
    if ((requested.pathname || '/') !== '/' || final.toString() === requested.toString()) return undefined;
    if (!/(?:^|\/)(?:pipl[_-]?consent[^/]*|cookie[_-]?consent|consent|signin|sign-in|login|log-in|auth|authentication)(?:\/|$)/i.test(final.pathname)) {
      return undefined;
    }
    return `Homepage redirected to an access interstitial: ${final.pathname}`;
  } catch {
    return undefined;
  }
}

async function fetchDirectAuditPage(
  candidate: AuditPageCandidate,
  requestedUrl: string,
  fetcher: HttpFetcher,
  allowMetaRefresh = true,
): Promise<HttpAuditPageOutcome> {
  const started = Date.now();
  try {
    const { response, finalUrl } = await fetchWithinRegistrableRoot(requestedUrl, 10000, fetcher);
    const contentType = response.headers.get('content-type') ?? '';
    const isHtml = !contentType || /text\/html|application\/xhtml\+xml/i.test(contentType);

    if (!response.ok && !isHtml && response.status !== 403 && !(response.status >= 520 && response.status <= 530)) {
      await cancelResponseBody(response);
      throw new AuditPageFetchError(
        `AUDIT_HTTP_${response.status}`,
        `HTTP ${response.status}`,
        isRetryableHttpStatus(response.status),
        response.status,
        finalUrl,
        response.headers,
      );
    }
    if (response.ok && !isHtml) {
      await cancelResponseBody(response);
      throw new AuditPageFetchError(
        'AUDIT_NON_HTML',
        'Target is not an HTML page',
        false,
        response.status,
        finalUrl,
        response.headers,
      );
    }

    let html: string;
    try {
      html = await readBoundedText(response, MAX_AUDIT_HTML_BYTES, 'HTML page');
    } catch (error) {
      if (error instanceof ResponseTooLargeError) {
        throw new AuditPageFetchError(
          'AUDIT_RESPONSE_TOO_LARGE',
          error.message,
          true,
          response.status,
          finalUrl,
          response.headers,
        );
      }
      throw error;
    }

    const challenge = challengeReason(html, finalUrl, response.status);
    if (challenge) {
      throw new AuditPageFetchError(
        'AUDIT_BOT_CHALLENGE',
        challenge,
        true,
        response.status,
        finalUrl,
        response.headers,
      );
    }
    const accessInterstitial = homepageAccessInterstitialReason(candidate, finalUrl);
    if (accessInterstitial) {
      throw new AuditPageFetchError(
        'AUDIT_ACCESS_INTERSTITIAL',
        accessInterstitial,
        false,
        response.status,
        finalUrl,
        response.headers,
      );
    }
    if (!response.ok) {
      throw new AuditPageFetchError(
        `AUDIT_HTTP_${response.status}`,
        `HTTP ${response.status}`,
        isRetryableHttpStatus(response.status),
        response.status,
        finalUrl,
        response.headers,
      );
    }
    if (!html.trim()) {
      throw new AuditPageFetchError(
        'AUDIT_EMPTY_HTML',
        'Target returned an empty HTML document',
        true,
        response.status,
        finalUrl,
        response.headers,
      );
    }
    if (allowMetaRefresh) {
      const refreshTarget = immediateMetaRefreshTarget(html, finalUrl);
      if (refreshTarget) {
        const refreshed = await fetchDirectAuditPage(candidate, refreshTarget, fetcher, false);
        if (refreshed.page.status === 'complete') {
          return {
            ...refreshed,
            page: {
              ...refreshed.page,
              response_ms: Date.now() - started,
              fallback_reason: `Followed same-site meta refresh from ${finalUrl}`,
            },
          };
        }
      }
    }
    if (isSoftNotFoundDocument(html)) {
      throw new AuditPageFetchError(
        'AUDIT_SOFT_404',
        'Target returned a soft not-found document with HTTP 200',
        false,
        response.status,
        finalUrl,
        response.headers,
      );
    }
    if (detectJavaScriptShell(html)) {
      throw new AuditPageFetchError(
        'AUDIT_JS_SHELL',
        'Direct HTTP returned a JavaScript application shell without extractable content',
        true,
        response.status,
        finalUrl,
        response.headers,
      );
    }

    return {
      page: {
        ...candidate,
        status: 'complete',
        title: titleFromHtml(html),
        locale: pageLocale(html),
        html,
        headers: response.headers,
        response_ms: Date.now() - started,
        status_code: response.status,
        final_url: finalUrl,
        fetch_source: 'http',
        provider: DIRECT_HTTP_PROVIDER,
      },
      browserEligible: false,
    };
  } catch (error) {
    const normalized = normalizeDirectFetchError(error);
    return {
      page: {
        ...candidate,
        status: 'error',
        error: normalized.message,
        error_code: normalized.code,
        html: '',
        headers: normalized.responseHeaders,
        response_ms: Date.now() - started,
        status_code: normalized.statusCode,
        final_url: normalized.finalUrl ?? requestedUrl,
        fetch_source: 'http',
        provider: DIRECT_HTTP_PROVIDER,
      },
      browserEligible: normalized.browserEligible,
      fallbackReason: normalized.message,
    };
  }
}

export async function fetchAuditPage(
  candidate: AuditPageCandidate,
  fetcher: HttpFetcher = fetchWithTimeout,
  options: FetchAuditPageOptions = {},
): Promise<FetchedAuditPage> {
  const overallStarted = Date.now();
  const primary = await fetchDirectAuditPage(candidate, candidate.url, fetcher);
  if (primary.page.status === 'complete') return primary.page;

  let directFailure = primary.page;
  let browserEligible = primary.browserEligible;
  let browserReason = primary.fallbackReason ?? primary.page.error ?? 'Direct HTTP fetch failed';

  if (options.httpFallbackUrl && options.httpFallbackUrl !== candidate.url) {
    const fallback = await fetchDirectAuditPage(candidate, options.httpFallbackUrl, fetcher);
    if (fallback.page.status === 'complete') {
      return {
        ...fallback.page,
        response_ms: Date.now() - overallStarted,
        fallback_reason: primary.page.error,
      };
    }

    directFailure = {
      ...fallback.page,
      error: [
        primary.page.error,
        fallback.page.error ? `HTTP fallback failed: ${fallback.page.error}` : undefined,
      ].filter(Boolean).join('; '),
      fallback_reason: primary.page.error,
      response_ms: Date.now() - overallStarted,
    };
    if (!browserEligible && fallback.browserEligible) {
      browserEligible = true;
      browserReason = fallback.fallbackReason ?? fallback.page.error ?? browserReason;
    }
  }

  if (!browserEligible || !options.browserFallback) return directFailure;

  const browser = await attemptBrowserRun(
    candidate,
    browserReason,
    options.browserFallback,
    overallStarted,
  );
  if (browser.page) return browser.page;

  return {
    ...directFailure,
    response_ms: Date.now() - overallStarted,
    fallback_reason: browserReason,
    browser_fallback: browser.evidence,
    error_code: directFailure.error_code,
  };
}

export function summarizeAuditPage(page: FetchedAuditPage): AuditPageSummary {
  const { html: _html, headers: _headers, ...summary } = page;
  return summary;
}
