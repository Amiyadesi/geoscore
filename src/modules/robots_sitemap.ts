import { fetchWithTimeout, type HttpFetcher } from '../lib/http';

export interface RobotsSitemapResult {
  robots_txt: RobotsTxtInfo;
  sitemap: SitemapInfo;
  issues: string[];
}

export interface RobotsTxtInfo {
  exists: boolean;
  fetch_status: 'complete' | 'missing' | 'blocked';
  blocks_all: boolean;
  blocks_googlebot: boolean;
  sitemap_refs: string[];
  disallowed_paths: string[];
  crawl_delay: number | null;
}

export interface SitemapInfo {
  exists: boolean;
  fetch_status: 'complete' | 'missing' | 'blocked';
  url: string | null;
  page_count: number;
  has_images: boolean;
  has_lastmod: boolean;
  is_index: boolean;
}

export interface RobotsSitemapOptions {
  fetcher?: HttpFetcher;
  maxRobotsCandidates?: number;
  maxSitemapCandidates?: number;
}

/** Extract sitemap URLs referenced in HTML <head> (e.g. <link rel="sitemap" href="...">) */
function extractSitemapFromHtml(html: string): string[] {
  const urls: string[] = [];
  // <link rel="sitemap" ...> tags
  const linkRe = /<link[^>]+rel\s*=\s*["']sitemap["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) { if (m[1].startsWith('http')) urls.push(m[1]); }
  return urls;
}

export async function runRobotsSitemap(
  domain: string,
  isBotBlocked = false,
  html = '',
  options: RobotsSitemapOptions = {},
): Promise<RobotsSitemapResult> {
  const issues: string[] = [];
  const fetcher = options.fetcher ?? fetchWithTimeout;
  const maxRobotsCandidates = Math.max(1, Math.min(2, options.maxRobotsCandidates ?? 2));
  const maxSitemapCandidates = Math.max(1, Math.min(8, options.maxSitemapCandidates ?? 8));

  // Sitemap URLs referenced in the page HTML (detected without a separate network request)
  const htmlSitemapRefs = html ? extractSitemapFromHtml(html) : [];

  // ── Robots.txt ──────────────────────────────────────────────────────────────

  const robotsTxt: RobotsTxtInfo = {
    exists: false,
    fetch_status: 'missing',
    blocks_all: false,
    blocks_googlebot: false,
    sitemap_refs: [],
    disallowed_paths: [],
    crawl_delay: null,
  };

  // Track whether we actually got a definitive "not found" vs a fetch failure
  let robotsFetchBlocked = false;

  try {
    // Try bare domain first, then www prefix — Googlebot UA is whitelisted by almost every WAF.
    const robotsCandidates = [`https://${domain}/robots.txt`];
    if (!domain.startsWith('www.')) robotsCandidates.push(`https://www.${domain}/robots.txt`);

    let robotsRes: Response | null = null;
    let gotDefinitive404 = false;
    for (const robotsUrl of robotsCandidates.slice(0, maxRobotsCandidates)) {
      try {
        const r = await fetcher(robotsUrl, { timeoutMs: 7000 });
        if (r.ok) { robotsRes = r; break; }
        // 404 = definitively doesn't exist; 403/5xx = blocked/server error
        if (r.status === 404) { gotDefinitive404 = true; break; }
        // Otherwise treat as blocked (403, 5xx, etc.)
        robotsFetchBlocked = true;
      } catch {
        robotsFetchBlocked = true;
      }
    }
    // If we got a clear 404 on all candidates, it's definitely missing
    if (gotDefinitive404) robotsFetchBlocked = false;

    if (robotsRes) {
      const body = await robotsRes.text();

      // Reject HTML error pages (WAF challenge pages that return 200 with HTML body)
      if (body.trimStart().startsWith('<!')) {
        robotsFetchBlocked = true; // got a challenge/HTML page, not real robots.txt
      } else {
        robotsTxt.exists = true;
        robotsTxt.fetch_status = 'complete';

        const disallowedSet = new Set<string>();
        let currentAgents: string[] = [];

        for (const rawLine of body.split('\n')) {
          const line = rawLine.trim();

          // Blank line → reset active user-agent group
          if (line === '') {
            currentAgents = [];
            continue;
          }

          // Skip comment lines
          if (line.startsWith('#')) continue;

          const colonIdx = line.indexOf(':');
          if (colonIdx === -1) continue;

          const key = line.slice(0, colonIdx).trim().toLowerCase();
          const value = line.slice(colonIdx + 1).trim();

          if (key === 'user-agent') {
            currentAgents.push(value.toLowerCase());
            continue;
          }

          if (key === 'disallow') {
            const isWildcard = currentAgents.includes('*');
            const isGooglebot = currentAgents.some(a => a.includes('googlebot'));

            if (isWildcard || isGooglebot) {
              if (value === '/') {
                if (isWildcard) robotsTxt.blocks_all = true;
                if (isGooglebot) robotsTxt.blocks_googlebot = true;
              }

              // Collect disallowed paths (dedup, max 20)
              if (value && disallowedSet.size < 20 && !disallowedSet.has(value)) {
                disallowedSet.add(value);
              }
            }
            continue;
          }

          if (key === 'crawl-delay') {
            const parsed = parseFloat(value);
            if (!isNaN(parsed)) {
              // Take the most restrictive (largest) crawl-delay seen
              if (robotsTxt.crawl_delay === null || parsed > robotsTxt.crawl_delay) {
                robotsTxt.crawl_delay = parsed;
              }
            }
            continue;
          }

          if (key === 'sitemap') {
            if (value.startsWith('http')) {
              robotsTxt.sitemap_refs.push(value);
            }
            continue;
          }
        }

        robotsTxt.disallowed_paths = Array.from(disallowedSet);
      }
    }
  } catch {
    robotsFetchBlocked = true;
  }

  if (!robotsTxt.exists && robotsFetchBlocked) robotsTxt.fetch_status = 'blocked';

  // Robots.txt issues — only report "not found" when we have a definitive answer.
  // If the fetch was blocked (non-404 failure) or the site uses bot protection, skip.
  if (!robotsTxt.exists) {
    if (!robotsFetchBlocked && !isBotBlocked) {
      issues.push('robots.txt not found — search engines rely on it for crawl guidance');
    }
    // else: couldn't verify — don't falsely report as missing
  }
  if (robotsTxt.blocks_all) {
    issues.push('robots.txt blocks all crawlers (Disallow: / for User-agent: *) — site will not be indexed');
  }
  if (robotsTxt.blocks_googlebot) {
    issues.push('robots.txt blocks Googlebot — pages will not appear in Google search results');
  }
  if (robotsTxt.crawl_delay !== null && robotsTxt.crawl_delay >= 10) {
    issues.push(
      `robots.txt sets a crawl-delay of ${robotsTxt.crawl_delay}s — high delays slow down indexing`,
    );
  }

  // ── Sitemap ──────────────────────────────────────────────────────────────────

  const sitemap: SitemapInfo = {
    exists: false,
    fetch_status: 'missing',
    url: null,
    page_count: 0,
    has_images: false,
    has_lastmod: false,
    is_index: false,
  };

  // Build ordered candidate list: HTML-referenced first, then robots refs, then fallbacks.
  // Also try www prefix in case the bare domain redirects or is blocked.
  const wwwDomain = domain.startsWith('www.') ? domain : `www.${domain}`;
  const sitemapCandidates: string[] = [
    ...htmlSitemapRefs,                         // from <link rel="sitemap"> in page HTML
    ...robotsTxt.sitemap_refs,                  // from Sitemap: directive in robots.txt
    `https://${domain}/sitemap.xml`,
    `https://${wwwDomain}/sitemap.xml`,
    `https://${domain}/sitemap_index.xml`,
    `https://${wwwDomain}/sitemap_index.xml`,
    `https://${domain}/sitemap-index.xml`,
    `https://${domain}/wp-sitemap.xml`,
  ];

  // Deduplicate while preserving order
  const seenSitemapUrls = new Set<string>();
  const uniqueSitemapCandidates: string[] = [];
  for (const u of sitemapCandidates) {
    if (!seenSitemapUrls.has(u)) {
      seenSitemapUrls.add(u);
      uniqueSitemapCandidates.push(u);
    }
  }

  let sitemapFetchBlocked = false;
  for (const candidate of uniqueSitemapCandidates.slice(0, maxSitemapCandidates)) {
    try {
      const res = await fetcher(candidate, { timeoutMs: 8000 });
      if (!res.ok) {
        if (res.status !== 404) sitemapFetchBlocked = true;
        continue;
      }

      const body = await res.text();
      // Reject HTML challenge pages (WAF/CDN returning 200 with HTML instead of XML)
      if (body.trimStart().startsWith('<!')) {
        sitemapFetchBlocked = true;
        continue;
      }
      if (!body.includes('<url') && !body.includes('<sitemap')) continue;

      // Valid sitemap found
      sitemap.exists = true;
      sitemap.fetch_status = 'complete';
      sitemap.url = candidate;
      sitemap.is_index = body.includes('<sitemapindex');
      sitemap.has_images = body.includes('<image:');
      sitemap.has_lastmod = body.includes('<lastmod>');

      // Count <url> and <sitemap> opening tags
      const urlTagMatches = body.match(/<url>/gi);
      const sitemapTagMatches = body.match(/<sitemap>/gi);
      sitemap.page_count =
        (urlTagMatches ? urlTagMatches.length : 0) +
        (sitemapTagMatches ? sitemapTagMatches.length : 0);

      break;
    } catch {
      sitemapFetchBlocked = true;
    }
  }

  // Track whether all sitemap fetches were blocked (non-404 failures)
  // We infer this from: no sitemap found AND html had no refs AND robots had no refs
  const sitemapFetchCouldBeBlocked = !sitemap.exists && (sitemapFetchBlocked || robotsFetchBlocked || isBotBlocked);
  if (sitemapFetchCouldBeBlocked) sitemap.fetch_status = 'blocked';

  // Sitemap issues — suppress if we can't tell (fetch was blocked or bot protected)
  if (!sitemap.exists) {
    if (!sitemapFetchCouldBeBlocked) {
      issues.push('No sitemap found — submit a sitemap to help search engines discover all pages');
    }
  } else {
    if (sitemap.page_count === 0) {
      issues.push('Sitemap was found but contains no <url> or <sitemap> entries');
    }
    if (!sitemap.has_lastmod) {
      issues.push('Sitemap is missing <lastmod> dates — adding them helps Google prioritise recrawls');
    }
  }

  if (robotsTxt.exists && robotsTxt.sitemap_refs.length === 0) {
    issues.push('robots.txt exists but does not reference the sitemap URL — add a Sitemap: directive');
  }

  return { robots_txt: robotsTxt, sitemap, issues };
}
