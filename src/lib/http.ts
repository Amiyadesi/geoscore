// Use a real browser UA to avoid bot-challenge pages (Cloudflare, Canva, etc.)
// Explicit bot UAs (e.g. "GeoAuditBot/1.0") cause sites to serve challenge pages
// instead of their actual content, breaking all downstream AI analysis.
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DEFAULT_TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 5;

export type HttpFetchOptions = RequestInit & {
  timeoutMs?: number;
  /** Called immediately before every native fetch, including redirect hops. */
  onSubrequest?: (url: string) => void;
};

export type HttpFetcher = (url: string, options?: HttpFetchOptions) => Promise<Response>;

export function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && isPublicHostname(parsed.hostname);
  } catch {
    return false;
  }
}

function isPublicHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (host.length < 3 || host.length > 253) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host.includes('..') || host.startsWith('.') || host.endsWith('.')) return false;
  if (host.includes(':')) return false;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((octet) => octet < 0 || octet > 255)) return false;
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 0 && host !== '192.0.0.9' && host !== '192.0.0.10') return false;
    if (a === 192 && b === 168) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }

  const labels = host.split('.');
  if (labels.length < 2) return false;
  if (!/^(xn--)?[a-z0-9-]{2,63}$/.test(labels[labels.length - 1])) return false;
  return labels.every((label) =>
    label.length >= 1 &&
    label.length <= 63 &&
    /^[a-z0-9-]+$/.test(label) &&
    !label.startsWith('-') &&
    !label.endsWith('-')
  );
}

function resolveRedirect(location: string, currentUrl: string): string | null {
  try {
    return new URL(location, currentUrl).toString();
  } catch {
    return null;
  }
}

export async function fetchWithTimeout(
  url: string,
  options: HttpFetchOptions = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, onSubrequest, ...fetchOptions } = options;
  const requestedUrl = String(url);
  if (!isValidHttpUrl(requestedUrl)) throw new Error(`Blocked non-public URL: ${requestedUrl}`);

  const shouldFollowRedirects = fetchOptions.redirect !== 'manual';
  const redirectMode = shouldFollowRedirects ? 'manual' : fetchOptions.redirect;
  let currentUrl = requestedUrl;
  let response: Response;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (!isValidHttpUrl(currentUrl)) throw new Error(`Blocked non-public URL: ${currentUrl}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      onSubrequest?.(currentUrl);
      response = await fetch(currentUrl, {
        ...fetchOptions,
        redirect: redirectMode,
        signal: controller.signal,
        headers: {
          'User-Agent': DEFAULT_UA,
          // Request English content so geo-redirecting sites (e.g. Stripe, Mailchimp) don't
          // return localised pages when the Cloudflare Worker edge IP is non-US.
          'Accept-Language': 'en-US,en;q=0.9',
          ...fetchOptions.headers,
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!shouldFollowRedirects || response.status < 300 || response.status >= 400) {
      return response;
    }

    const location = response.headers.get('location');
    if (!location) return response;
    const nextUrl = resolveRedirect(location, currentUrl);
    if (!nextUrl) return response;
    currentUrl = nextUrl;
  }

  throw new Error(`Too many redirects for ${requestedUrl}`);
}

// Retry once on 5xx or network error with 800ms backoff
export async function fetchWithRetry(
  url: string,
  options: HttpFetchOptions = {},
  maxAttempts = 2
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetchWithTimeout(url, options);
      if (res.status < 500 || i === maxAttempts - 1) return res;
    } catch (err) {
      lastErr = err;
    }
    if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, 800 * (i + 1)));
  }
  throw lastErr ?? new Error(`fetch failed after ${maxAttempts} attempts`);
}

export async function fetchText(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  const res = await fetchWithTimeout(url, { timeoutMs });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}
