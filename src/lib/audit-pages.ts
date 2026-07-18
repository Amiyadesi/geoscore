import { parseHTML } from 'linkedom';
import { getDomain } from 'tldts';
import { detectBotChallenge } from './bot-detection';
import { fetchWithTimeout, type HttpFetcher } from './http';
import { isValidPublicHostname } from './security';
import { SubrequestBudgetExceeded, type SubrequestBudgetLike } from './subrequest-budget';
import type { BrowserRunBinding, BrowserRunContentRequest, BrowserRunResourceType } from './types';

export type AuditMode = 'site' | 'url';
export type AuditPageType = 'home' | 'about' | 'article' | 'documentation' | 'product' | 'category' | 'contact' | 'other';
export type AuditPageSource = 'requested' | 'homepage' | 'internal_link' | 'sitemap';

const MAX_AUDIT_HTML_BYTES = 2 * 1024 * 1024;
const MAX_SITEMAP_BYTES = 1 * 1024 * 1024;
const MAX_BROWSER_ENVELOPE_BYTES = MAX_AUDIT_HTML_BYTES + 256 * 1024;
const BROWSER_RUN_RESERVED_SECONDS = 20;
const BROWSER_RUN_FREE_SECONDS = 600;
const BROWSER_RUN_HEADROOM_SECONDS = 60;
const DEFAULT_BROWSER_DAILY_BUDGET_SECONDS = BROWSER_RUN_FREE_SECONDS - BROWSER_RUN_HEADROOM_SECONDS;
const BROWSER_RUN_PROVIDER = 'Cloudflare Browser Run' as const;
const BROWSER_RUN_SOURCE = 'browser_binding_quick_action' as const;
const DIRECT_HTTP_PROVIDER = 'Direct HTTP' as const;
const NON_HTML_PATH_EXTENSION = /\.(?:avif|bmp|css|csv|docx?|eot|gif|ico|jpe?g|js|json|map|markdown|md|mjs|mov|mp3|mp4|ogg|otf|pdf|png|pptx?|rar|rss|svg|tar|tgz|ttf|txt|wasm|webm|webmanifest|webp|woff2?|xlsx?|xml|zip)$/i;
const INFRASTRUCTURE_PATH = /(?:^|\/)(?:cdn-cgi|_next|_nuxt|_astro|wp-content|wp-includes)(?:\/|$)/i;
const BROWSER_REJECTED_RESOURCE_TYPES: BrowserRunResourceType[] = [
  'image',
  'media',
  'font',
  'websocket',
  'eventsource',
  'ping',
  'prefetch',
];

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

export interface BrowserRunFallbackError {
  code: string;
  message: string;
  retryable: boolean;
  upstream_code?: string;
  target_status?: number;
}

export interface BrowserRunFallbackEvidence {
  status: 'complete' | 'error' | 'skipped';
  provider: typeof BROWSER_RUN_PROVIDER;
  source: typeof BROWSER_RUN_SOURCE;
  reason: string;
  reserved_seconds: number;
  browser_ms_used?: number;
  error?: BrowserRunFallbackError;
}

export interface BrowserRunAttemptState {
  attempted: boolean;
}

export interface BrowserRunFallbackOptions {
  binding?: BrowserRunBinding;
  budgetKv?: KVNamespace;
  dailyBudgetSeconds?: string | number;
  subrequestBudget?: SubrequestBudgetLike;
  attemptState?: BrowserRunAttemptState;
  /** Test hook. Production calls are always capped at 20 seconds. */
  attemptTimeoutMs?: number;
  /** Test hook for the UTC budget key. */
  now?: number;
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

interface BrowserRunEnvelope {
  success?: boolean;
  result?: string;
  meta?: {
    status?: number;
    title?: string;
  };
  errors?: Array<{
    code?: number | string;
    message?: string;
  }>;
}

class ResponseTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResponseTooLargeError';
  }
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

class BrowserRunAttemptTimeout extends Error {
  constructor() {
    super('Cloudflare Browser Run exceeded the 20-second attempt limit');
    this.name = 'BrowserRunAttemptTimeout';
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  try { await response.body?.cancel(); } catch { /* best-effort connection cleanup */ }
}

async function readBoundedText(response: Response, maxBytes: number, label: string): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await cancelResponseBody(response);
    throw new ResponseTooLargeError(`${label} exceeds the ${Math.round(maxBytes / 1024)} KB response limit`);
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ResponseTooLargeError(`${label} exceeds the ${Math.round(maxBytes / 1024)} KB response limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
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

export function registrableRoot(hostname: string): string | null {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!isValidPublicHostname(normalized)) return null;
  return getDomain(normalized, { allowPrivateDomains: false }) ?? null;
}

export function validateAuditTargetUrl(raw: string, submittedDomain: string): string | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password || parsed.port) return null;
    const host = parsed.hostname.toLowerCase();
    if (!isValidPublicHostname(host)) return null;
    const submittedRoot = registrableRoot(submittedDomain);
    if (!submittedRoot || registrableRoot(host) !== submittedRoot) return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
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
  const root = registrableRoot(base.hostname);
  if (!root) return [];

  try {
    const { document } = parseHTML(html);
    const links = new Set<string>();
    for (const anchor of document.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href')?.trim();
      if (!href || /^(#|mailto:|tel:|javascript:|data:)/i.test(href)) continue;
      try {
        const resolved = new URL(href, base);
        if (!['http:', 'https:'].includes(resolved.protocol)) continue;
        if (registrableRoot(resolved.hostname) !== root) continue;
        resolved.hash = '';
        if (!isAuditableHtmlCandidate(resolved.toString())) continue;
        links.add(resolved.toString());
      } catch { /* ignore malformed links */ }
    }
    return [...links].sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function normalizedCandidates(urls: string[], homeUrl: string): string[] {
  const home = new URL(homeUrl);
  const homeRoot = registrableRoot(home.hostname);
  const homePath = home.pathname.replace(/\/+$/, '') || '/';
  const unique = new Set<string>();
  for (const raw of urls) {
    try {
      const url = new URL(raw, home);
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      if (registrableRoot(url.hostname) !== homeRoot) continue;
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
  try {
    const { document } = parseHTML(html);
    for (const link of document.querySelectorAll('link[rel~="sitemap"][href]')) {
      const href = link.getAttribute('href');
      if (href) refs.add(new URL(href, homeUrl).toString());
    }
  } catch { /* fall through to conventional paths */ }
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
  const homeRoot = registrableRoot(new URL(homeUrl).hostname);
  if (!homeRoot) return [];
  for (const sitemapUrl of sitemapReferences(homeUrl, html).slice(0, 3)) {
    try {
      if (registrableRoot(new URL(sitemapUrl).hostname) !== homeRoot) continue;
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
          try { return registrableRoot(new URL(url).hostname) === homeRoot; } catch { return false; }
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

function visiblePageText(html: string): string {
  if (!html) return '';
  try {
    const { document } = parseHTML(html);
    for (const element of document.querySelectorAll('script,style,noscript,template,svg')) {
      element.remove();
    }
    return (document.body?.textContent ?? document.documentElement?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return html
      .replace(/<(?:script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|template|svg)>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

/** Conservative heuristic for an app shell that has scripts but no useful rendered text. */
export function detectJavaScriptShell(html: string): boolean {
  if (!html || !/<script\b/i.test(html)) return false;
  const visibleText = visiblePageText(html);
  if (visibleText.length >= 120) return false;

  const scriptCount = (html.match(/<script\b/gi) ?? []).length;
  const shellMarker = /<(?:div|main|section)\b[^>]*(?:id|data-reactroot)=["'](?:root|app|__next|__nuxt|svelte|gatsby-focus-wrapper)["'][^>]*>\s*<\/(?:div|main|section)>/i.test(html)
    || /<(?:div|main)\b[^>]*id=["'](?:root|app|__next|__nuxt)["'][^>]*>/i.test(html)
    || /\b(?:__NEXT_DATA__|__NUXT__|hydrateRoot|createRoot\s*\(|webpackChunk)\b/.test(html);
  return shellMarker || (visibleText.length < 40 && scriptCount >= 2);
}

function titleFromHtml(html: string): string | undefined {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return title || undefined;
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function challengeReason(html: string, finalUrl: string, statusCode: number): string | undefined {
  const challenge = detectBotChallenge(html, finalUrl, statusCode);
  if (!challenge.isChallenge) return undefined;
  // A rendered SPA can retain a harmless <noscript>Please enable JavaScript</noscript>
  // alongside real content. Do not reject rich rendered pages on that weak body-only signal.
  if (challenge.reason === 'Bot-challenge keywords detected in page content' && visiblePageText(html).length >= 300) {
    return undefined;
  }
  return challenge.reason ?? 'Bot challenge detected';
}

function normalizeDirectFetchError(error: unknown): AuditPageFetchError {
  if (error instanceof AuditPageFetchError) return error;
  if (error instanceof ResponseTooLargeError) {
    return new AuditPageFetchError('AUDIT_RESPONSE_TOO_LARGE', error.message, false);
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
          false,
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

function clampBrowserDailyBudget(value: string | number | undefined): number {
  if (value === undefined || value === '') return DEFAULT_BROWSER_DAILY_BUDGET_SECONDS;
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_BROWSER_DAILY_BUDGET_SECONDS;
  return Math.max(0, Math.min(DEFAULT_BROWSER_DAILY_BUDGET_SECONDS, parsed));
}

function browserBudgetKey(now = Date.now()): string {
  return `browser:${new Date(now).toISOString().slice(0, 10)}`;
}

type BrowserBudgetReservation =
  | { status: 'reserved'; key: string }
  | { status: 'exhausted'; key: string }
  | { status: 'unavailable'; key: string; message: string };

async function reserveBrowserBudget(options: BrowserRunFallbackOptions): Promise<BrowserBudgetReservation> {
  const key = browserBudgetKey(options.now);
  if (!options.budgetKv) {
    return { status: 'unavailable', key, message: 'Browser Run daily budget storage is unavailable' };
  }

  const limit = clampBrowserDailyBudget(options.dailyBudgetSeconds);
  try {
    const raw = await options.budgetKv.get(key);
    const used = raw === null ? 0 : Number(raw);
    if (!Number.isFinite(used) || used < 0) {
      return { status: 'unavailable', key, message: 'Browser Run daily budget counter is invalid' };
    }
    if (used + BROWSER_RUN_RESERVED_SECONDS > limit) return { status: 'exhausted', key };

    // KV is eventually consistent, so each attempt conservatively reserves the full
    // 20-second maximum. The 60-second free-tier headroom covers three concurrent races.
    await options.budgetKv.put(key, String(Math.floor(used) + BROWSER_RUN_RESERVED_SECONDS), {
      expirationTtl: 60 * 60 * 48,
    });
    return { status: 'reserved', key };
  } catch (error) {
    return {
      status: 'unavailable',
      key,
      message: error instanceof Error ? error.message : 'Browser Run daily budget could not be reserved',
    };
  }
}

export function buildBrowserAllowRequestPattern(root: string): string[] {
  const normalizedRoot = registrableRoot(root);
  if (!normalizedRoot) return [];
  const escaped = normalizedRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [`^https?:\\/\\/(?:[a-z0-9-]+\\.)*${escaped}(?::(?:80|443))?(?:[\\/?#]|$)`];
}

function sanitizeBrowserMessage(value: unknown): string {
  return String(value ?? 'Cloudflare Browser Run failed')
    .replace(/((?:api[-_ ]?key|token|authorization))\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function browserError(
  code: string,
  message: string,
  retryable: boolean,
  upstreamCode?: string,
  targetStatus?: number,
): BrowserRunFallbackError {
  return {
    code,
    message: sanitizeBrowserMessage(message),
    retryable,
    ...(upstreamCode ? { upstream_code: upstreamCode } : {}),
    ...(targetStatus === undefined ? {} : { target_status: targetStatus }),
  };
}

function skippedBrowserFallback(
  reason: string,
  error: BrowserRunFallbackError,
): BrowserRunFallbackEvidence {
  return {
    status: 'skipped',
    provider: BROWSER_RUN_PROVIDER,
    source: BROWSER_RUN_SOURCE,
    reason,
    reserved_seconds: 0,
    error,
  };
}

function browserMsUsed(response: Response): number | undefined {
  const raw = response.headers.get('X-Browser-Ms-Used');
  if (raw === null || raw.trim() === '') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : undefined;
}

function upstreamEnvelopeError(envelope: BrowserRunEnvelope): BrowserRunFallbackError {
  const upstream = envelope.errors?.[0];
  const upstreamCode = upstream?.code === undefined ? undefined : String(upstream.code);
  const message = upstream?.message || 'Cloudflare Browser Run returned an unsuccessful response';
  if (upstreamCode === '6002') {
    return browserError('BROWSER_RUN_TIMEOUT', message, true, upstreamCode);
  }
  if (upstreamCode === '429') {
    return browserError('BROWSER_RUN_RATE_LIMITED', message, true, upstreamCode);
  }
  return browserError('BROWSER_RUN_UPSTREAM_ERROR', message, true, upstreamCode);
}

function providerHttpError(response: Response, envelope?: BrowserRunEnvelope): BrowserRunFallbackError {
  const upstream = envelope?.errors?.[0];
  const upstreamCode = upstream?.code === undefined ? undefined : String(upstream.code);
  const message = upstream?.message || `Cloudflare Browser Run returned HTTP ${response.status}`;
  if (response.status === 408 || response.status === 504 || upstreamCode === '6002') {
    return browserError('BROWSER_RUN_TIMEOUT', message, true, upstreamCode);
  }
  if (response.status === 429) {
    return browserError('BROWSER_RUN_RATE_LIMITED', message, true, upstreamCode);
  }
  return browserError('BROWSER_RUN_UPSTREAM_ERROR', message, response.status >= 500, upstreamCode);
}

async function quickActionWithTimeout(
  binding: BrowserRunBinding,
  request: BrowserRunContentRequest,
  timeoutMs: number,
): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      binding.quickAction('content', request),
      new Promise<Response>((_resolve, reject) => {
        timer = setTimeout(() => reject(new BrowserRunAttemptTimeout()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

interface BrowserRunAttemptResult {
  page?: FetchedAuditPage;
  evidence: BrowserRunFallbackEvidence;
}

async function attemptBrowserRun(
  candidate: AuditPageCandidate,
  reason: string,
  options: BrowserRunFallbackOptions,
  overallStarted: number,
): Promise<BrowserRunAttemptResult> {
  if (!options.binding) {
    return {
      evidence: skippedBrowserFallback(
        reason,
        browserError('BROWSER_RUN_UNAVAILABLE', 'Cloudflare Browser Run binding is not configured', false),
      ),
    };
  }
  if (options.attemptState?.attempted) {
    return {
      evidence: skippedBrowserFallback(
        reason,
        browserError('BROWSER_RUN_UNAVAILABLE', 'Browser Run was already attempted for this audit', false),
      ),
    };
  }

  const target = new URL(candidate.url);
  const root = registrableRoot(target.hostname);
  const allowRequestPattern = root ? buildBrowserAllowRequestPattern(root) : [];
  if (target.username || target.password || target.port || !root || allowRequestPattern.length === 0) {
    return {
      evidence: skippedBrowserFallback(
        reason,
        browserError('BROWSER_RUN_UNAVAILABLE', 'Browser Run target is not a valid public registrable domain', false),
      ),
    };
  }

  try {
    options.subrequestBudget?.consume('browser-run:content');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Browser Run subrequest budget is exhausted';
    return {
      evidence: skippedBrowserFallback(
        reason,
        browserError('BROWSER_RUN_SUBREQUEST_BUDGET_EXCEEDED', message, true),
      ),
    };
  }

  const reservation = await reserveBrowserBudget(options);
  if (reservation.status === 'exhausted') {
    return {
      evidence: skippedBrowserFallback(
        reason,
        browserError('BROWSER_RUN_BUDGET_EXHAUSTED', 'Cloudflare Browser Run daily budget is exhausted', true),
      ),
    };
  }
  if (reservation.status === 'unavailable') {
    return {
      evidence: skippedBrowserFallback(
        reason,
        browserError('BROWSER_RUN_BUDGET_UNAVAILABLE', reservation.message, true),
      ),
    };
  }

  if (options.attemptState) options.attemptState.attempted = true;
  const timeoutMs = Math.max(1, Math.min(20_000, Math.floor(options.attemptTimeoutMs ?? 20_000)));
  const request: BrowserRunContentRequest = {
    url: candidate.url,
    actionTimeout: timeoutMs,
    allowRequestPattern,
    rejectResourceTypes: BROWSER_REJECTED_RESOURCE_TYPES,
    gotoOptions: {
      timeout: timeoutMs,
      waitUntil: 'networkidle2',
    },
  };

  let response: Response;
  try {
    response = await quickActionWithTimeout(options.binding, request, timeoutMs);
  } catch (error) {
    const timedOut = error instanceof BrowserRunAttemptTimeout
      || (error instanceof Error && /timed?\s*out|timeout/i.test(error.message));
    return {
      evidence: {
        status: 'error',
        provider: BROWSER_RUN_PROVIDER,
        source: BROWSER_RUN_SOURCE,
        reason,
        reserved_seconds: BROWSER_RUN_RESERVED_SECONDS,
        error: browserError(
          timedOut ? 'BROWSER_RUN_TIMEOUT' : 'BROWSER_RUN_UPSTREAM_ERROR',
          error instanceof Error ? error.message : 'Cloudflare Browser Run request failed',
          true,
        ),
      },
    };
  }

  const measuredBrowserMs = browserMsUsed(response);
  let rawEnvelope: string;
  try {
    rawEnvelope = await readBoundedText(response, MAX_BROWSER_ENVELOPE_BYTES, 'Browser Run response');
  } catch (error) {
    return {
      evidence: {
        status: 'error',
        provider: BROWSER_RUN_PROVIDER,
        source: BROWSER_RUN_SOURCE,
        reason,
        reserved_seconds: BROWSER_RUN_RESERVED_SECONDS,
        ...(measuredBrowserMs === undefined ? {} : { browser_ms_used: measuredBrowserMs }),
        error: browserError(
          error instanceof ResponseTooLargeError ? 'BROWSER_RUN_RESPONSE_TOO_LARGE' : 'BROWSER_RUN_UPSTREAM_ERROR',
          error instanceof Error ? error.message : 'Cloudflare Browser Run response could not be read',
          true,
        ),
      },
    };
  }

  let envelope: BrowserRunEnvelope;
  try {
    const parsed = JSON.parse(rawEnvelope) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid envelope');
    envelope = parsed as BrowserRunEnvelope;
  } catch {
    if (!response.ok) {
      return {
        evidence: {
          status: 'error',
          provider: BROWSER_RUN_PROVIDER,
          source: BROWSER_RUN_SOURCE,
          reason,
          reserved_seconds: BROWSER_RUN_RESERVED_SECONDS,
          ...(measuredBrowserMs === undefined ? {} : { browser_ms_used: measuredBrowserMs }),
          error: providerHttpError(response),
        },
      };
    }
    return {
      evidence: {
        status: 'error',
        provider: BROWSER_RUN_PROVIDER,
        source: BROWSER_RUN_SOURCE,
        reason,
        reserved_seconds: BROWSER_RUN_RESERVED_SECONDS,
        ...(measuredBrowserMs === undefined ? {} : { browser_ms_used: measuredBrowserMs }),
        error: browserError('BROWSER_RUN_INVALID_RESPONSE', 'Cloudflare Browser Run returned malformed JSON', true),
      },
    };
  }

  if (!response.ok) {
    return {
      evidence: {
        status: 'error',
        provider: BROWSER_RUN_PROVIDER,
        source: BROWSER_RUN_SOURCE,
        reason,
        reserved_seconds: BROWSER_RUN_RESERVED_SECONDS,
        ...(measuredBrowserMs === undefined ? {} : { browser_ms_used: measuredBrowserMs }),
        error: providerHttpError(response, envelope),
      },
    };
  }
  if (envelope.success !== true) {
    return {
      evidence: {
        status: 'error',
        provider: BROWSER_RUN_PROVIDER,
        source: BROWSER_RUN_SOURCE,
        reason,
        reserved_seconds: BROWSER_RUN_RESERVED_SECONDS,
        ...(measuredBrowserMs === undefined ? {} : { browser_ms_used: measuredBrowserMs }),
        error: upstreamEnvelopeError(envelope),
      },
    };
  }
  if (typeof envelope.result !== 'string') {
    return {
      evidence: {
        status: 'error',
        provider: BROWSER_RUN_PROVIDER,
        source: BROWSER_RUN_SOURCE,
        reason,
        reserved_seconds: BROWSER_RUN_RESERVED_SECONDS,
        ...(measuredBrowserMs === undefined ? {} : { browser_ms_used: measuredBrowserMs }),
        error: browserError('BROWSER_RUN_INVALID_RESPONSE', 'Cloudflare Browser Run response did not contain HTML content', true),
      },
    };
  }

  const html = envelope.result;
  if (!html.trim()) {
    return {
      evidence: {
        status: 'error',
        provider: BROWSER_RUN_PROVIDER,
        source: BROWSER_RUN_SOURCE,
        reason,
        reserved_seconds: BROWSER_RUN_RESERVED_SECONDS,
        ...(measuredBrowserMs === undefined ? {} : { browser_ms_used: measuredBrowserMs }),
        error: browserError('BROWSER_RUN_EMPTY_CONTENT', 'Cloudflare Browser Run returned empty HTML content', true),
      },
    };
  }
  if (new TextEncoder().encode(html).byteLength > MAX_AUDIT_HTML_BYTES) {
    return {
      evidence: {
        status: 'error',
        provider: BROWSER_RUN_PROVIDER,
        source: BROWSER_RUN_SOURCE,
        reason,
        reserved_seconds: BROWSER_RUN_RESERVED_SECONDS,
        ...(measuredBrowserMs === undefined ? {} : { browser_ms_used: measuredBrowserMs }),
        error: browserError('BROWSER_RUN_RESPONSE_TOO_LARGE', 'Rendered HTML exceeds the 2048 KB response limit', false),
      },
    };
  }

  const renderedStatus = Number(envelope.meta?.status);
  const statusCode = Number.isFinite(renderedStatus) && renderedStatus > 0 ? renderedStatus : 200;
  const renderedChallenge = challengeReason(html, candidate.url, statusCode);
  if (renderedChallenge) {
    return {
      evidence: {
        status: 'error',
        provider: BROWSER_RUN_PROVIDER,
        source: BROWSER_RUN_SOURCE,
        reason,
        reserved_seconds: BROWSER_RUN_RESERVED_SECONDS,
        ...(measuredBrowserMs === undefined ? {} : { browser_ms_used: measuredBrowserMs }),
        error: browserError('BROWSER_RUN_BOT_CHALLENGE', renderedChallenge, true),
      },
    };
  }
  if (statusCode >= 400) {
    return {
      evidence: {
        status: 'error',
        provider: BROWSER_RUN_PROVIDER,
        source: BROWSER_RUN_SOURCE,
        reason,
        reserved_seconds: BROWSER_RUN_RESERVED_SECONDS,
        ...(measuredBrowserMs === undefined ? {} : { browser_ms_used: measuredBrowserMs }),
        error: browserError(
          'BROWSER_RUN_TARGET_HTTP_ERROR',
          `Rendered target returned HTTP ${statusCode}`,
          isRetryableHttpStatus(statusCode),
          undefined,
          statusCode,
        ),
      },
    };
  }
  if (detectJavaScriptShell(html)) {
    return {
      evidence: {
        status: 'error',
        provider: BROWSER_RUN_PROVIDER,
        source: BROWSER_RUN_SOURCE,
        reason,
        reserved_seconds: BROWSER_RUN_RESERVED_SECONDS,
        ...(measuredBrowserMs === undefined ? {} : { browser_ms_used: measuredBrowserMs }),
        error: browserError('BROWSER_RUN_JS_SHELL', 'Browser Run still returned a JavaScript shell without extractable content', true),
      },
    };
  }

  const evidence: BrowserRunFallbackEvidence = {
    status: 'complete',
    provider: BROWSER_RUN_PROVIDER,
    source: BROWSER_RUN_SOURCE,
    reason,
    reserved_seconds: BROWSER_RUN_RESERVED_SECONDS,
    ...(measuredBrowserMs === undefined ? {} : { browser_ms_used: measuredBrowserMs }),
  };
  return {
    evidence,
    page: {
      ...candidate,
      status: 'complete',
      title: titleFromHtml(html) ?? envelope.meta?.title,
      locale: pageLocale(html),
      html,
      // Quick Action response headers describe the Browser Run API response, not
      // the target page. Keep target header evidence unknown instead of fabricating it.
      headers: new Headers(),
      response_ms: Date.now() - overallStarted,
      status_code: statusCode,
      final_url: candidate.url,
      fetch_source: 'browser_run',
      provider: BROWSER_RUN_PROVIDER,
      fallback_reason: reason,
      ...(measuredBrowserMs === undefined ? {} : { browser_ms_used: measuredBrowserMs }),
      browser_fallback: evidence,
    },
  };
}

function pageLocale(html: string): string | undefined {
  const explicit = html.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1]?.trim();
  if (explicit) return explicit;
  const text = html.replace(/<[^>]+>/g, ' ').slice(0, 3000);
  return /[\u3400-\u9fff]/.test(text) ? 'zh-CN' : undefined;
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
