import { fetchWithTimeout } from '../lib/http';

export interface BrokenLinksResult {
  total_links_checked: number;
  broken: BrokenLink[];
  redirects: number;
  unverifiable: number;   // links that timed out / were blocked — NOT reported as broken
  issues: string[];
}

export interface BrokenLink {
  url: string;
  status: number | null; // null = timeout/error
  text: string;          // anchor text, truncated to 40 chars
  type: 'internal' | 'external';
}

// Matches <a href="...">...</a> — captures href value and inner content
const ANCHOR_RE = /<a[^>]+href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]*))[^>]*>([\s\S]*?)<\/a>/gi;

// Strips all HTML tags from a string
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

// Normalises whitespace (newlines, tabs, multiple spaces) to a single space
function normaliseText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// Skippable href schemes
const SKIP_PREFIXES = ['#', 'javascript:', 'mailto:', 'tel:', 'data:'];

function normaliseHref(href: string, domain: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  for (const prefix of SKIP_PREFIXES) {
    if (trimmed.toLowerCase().startsWith(prefix)) return null;
  }
  // Relative path — prepend scheme + domain
  if (trimmed.startsWith('/')) {
    return `https://${domain}${trimmed}`;
  }
  // Protocol-relative
  if (trimmed.startsWith('//')) {
    return `https:${trimmed}`;
  }
  // Already absolute
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  // Relative without leading slash (e.g. page.html) — treat as root-relative
  return `https://${domain}/${trimmed}`;
}

export async function runBrokenLinks(domain: string, html: string): Promise<BrokenLinksResult> {
  // ── 1. Extract all <a href> tags ──────────────────────────────────────────
  const seen = new Map<string, { text: string; type: 'internal' | 'external' }>();

  for (const match of html.matchAll(ANCHOR_RE)) {
    const rawHref = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    const innerHtml = match[4] ?? '';

    const url = normaliseHref(rawHref, domain);
    if (!url) continue;

    // Deduplicate — keep first occurrence text
    if (seen.has(url)) continue;

    const rawText = normaliseText(stripTags(innerHtml));
    const text = rawText.length > 40 ? rawText.slice(0, 40) : rawText;
    const type: 'internal' | 'external' = url.includes(domain) ? 'internal' : 'external';

    seen.set(url, { text, type });

    // ── 3. Cap at 10 unique URLs ────────────────────────────────────────────
    // Reduced from 25 to stay within Cloudflare Workers 50 subrequest/invocation limit.
    if (seen.size >= 10) break;
  }

  // ── 5 & 6. Check each URL in small concurrent batches ────────────────────
  // Batching (5 at a time) avoids triggering server-side rate-limits that
  // an all-at-once burst of 25 concurrent HEAD requests would cause.
  const entries = Array.from(seen.entries());

  type CheckResult = {
    url: string;
    text: string;
    type: 'internal' | 'external';
    status: number | null;
  };

  async function checkUrl(url: string, meta: { text: string; type: 'internal' | 'external' }): Promise<CheckResult> {
    let status: number | null = null;
    try {
      const headRes = await fetchWithTimeout(url, { method: 'HEAD', timeoutMs: 5000 });
      status = headRes.status;
      // If server doesn't support HEAD, fall back to GET
      if (status === 405) {
        try {
          const getRes = await fetchWithTimeout(url, { method: 'GET', timeoutMs: 5000 });
          status = getRes.status;
        } catch { status = null; }
      }
    } catch {
      // HEAD timed out or errored — try GET once
      try {
        const getRes = await fetchWithTimeout(url, { method: 'GET', timeoutMs: 5000 });
        status = getRes.status;
      } catch { status = null; }
    }
    return { url, text: meta.text, type: meta.type, status };
  }

  // Process in batches of 3 (was 5) to stay under subrequest budget
  const BATCH_SIZE = 3;
  const allResults: PromiseSettledResult<CheckResult>[] = [];
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(batch.map(([url, meta]) => checkUrl(url, meta)));
    allResults.push(...batchResults);
  }
  const settled = allResults;

  // ── 7 & 8. Collate results ────────────────────────────────────────────────
  const broken: BrokenLink[] = [];
  let redirects = 0;
  let unverifiable = 0;

  for (const result of settled) {
    if (result.status === 'rejected') {
      // Shouldn't happen (we catch internally), but guard anyway
      continue;
    }
    const { url, text, type, status } = result.value;

    if (status !== null && status >= 300 && status < 400) {
      redirects++;
    }

    // null = timeout / bot-protection block — NOT a confirmed broken link.
    // Only 4xx/5xx responses are definitively broken.
    if (status === null) {
      unverifiable++;
    } else if (status >= 400) {
      broken.push({ url, status, text, type });
    }
  }

  // ── 9. Issues ─────────────────────────────────────────────────────────────
  const issues: string[] = [];

  if (broken.length > 0) {
    const hasInternalBroken = broken.some(b => b.type === 'internal');
    if (hasInternalBroken) {
      issues.push(
        `Internal broken link detected — worst for SEO: ${broken.length} broken link(s) found on homepage — fix or remove them`,
      );
    } else {
      issues.push(`${broken.length} broken link(s) found on homepage — fix or remove them`);
    }
  }

  if (redirects > 3) {
    issues.push(
      `${redirects} links redirect — update to final URLs to avoid redirect chains`,
    );
  }

  // Only mention unverifiable links if there are no confirmed broken ones
  // (avoids noise on sites that aggressively block bots)
  if (unverifiable > 0 && broken.length === 0 && unverifiable === seen.size) {
    issues.push(`All ${unverifiable} links could not be verified — the site may block automated checks (bot protection)`);
  }

  return {
    total_links_checked: seen.size,
    broken,
    redirects,
    unverifiable,
    issues,
  };
}
