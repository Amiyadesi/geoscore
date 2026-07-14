import { fetchWithTimeout } from '../lib/http';

export interface RedirectChainResult {
  hops: RedirectHop[];
  start_url: string;
  final_url: string;
  chain_length: number;
  has_https_redirect: boolean;
  has_www_change: boolean;
  is_clean: boolean;
  issues: string[];
}

export interface RedirectHop {
  url: string;
  status: number;
  duration_ms: number;
}

export async function runRedirectChain(domain: string): Promise<RedirectChainResult> {
  const issues: string[] = [];
  const hops: RedirectHop[] = [];
  const startUrl = `http://${domain}`;
  let currentUrl = startUrl;
  let finalUrl = startUrl;
  let hasHttps = false;
  let hasWwwChange = false;

  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    try {
      const res = await fetchWithTimeout(currentUrl, {
        redirect: 'manual',
        timeoutMs: 5000,
      } as RequestInit & { timeoutMs?: number });

      hops.push({ url: currentUrl, status: res.status, duration_ms: Date.now() - t0 });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location') ?? '';
        if (!loc) break;
        const next = loc.startsWith('http') ? loc : loc.startsWith('/') ? `${new URL(currentUrl).origin}${loc}` : loc;
        if (next.startsWith('https://')) hasHttps = true;
        const hadWww = currentUrl.includes('www.');
        const nowWww = next.includes('www.');
        if (hadWww !== nowWww) hasWwwChange = true;
        finalUrl = next;
        currentUrl = next;
      } else {
        finalUrl = currentUrl;
        break;
      }
    } catch {
      break;
    }
  }

  const redirectHops = hops.filter(h => h.status >= 300 && h.status < 400);
  const chainLength = redirectHops.length;
  const has302 = hops.some(h => h.status === 302 || h.status === 307);
  const has301 = hops.some(h => h.status === 301 || h.status === 308);

  // Final destination status — the last hop in hops[] is the terminal response
  const lastHop = hops.length > 0 ? hops[hops.length - 1] : null;
  const finalStatus = lastHop?.status ?? 0;
  const finalHopError = lastHop !== null && finalStatus >= 400;

  if (chainLength > 2) issues.push(`Redirect chain has ${chainLength} hops — each hop adds ~50–100ms latency and dilutes link equity`);
  if (has302 && has301) issues.push('Mixed 301/302 redirects — temporary redirects do not fully pass PageRank');
  if (has302) issues.push('302 temporary redirect detected — use 301 for SEO-safe permanent redirects');
  if (!hasHttps && chainLength > 0) issues.push('No HTTPS upgrade in redirect chain — site may be accessible over HTTP');
  if (chainLength === 0 && hops.length > 0 && finalStatus >= 400) {
    issues.push(`HTTP site returns ${finalStatus} — verify HTTP→HTTPS redirect is working`);
  }

  // Flag when the final destination itself returns an error (not just a redirect hop)
  if (finalHopError && !(chainLength === 0 && finalStatus >= 400)) {
    if (finalStatus === 526) {
      issues.push('Destination returns HTTP 526 — invalid SSL certificate; Cloudflare cannot establish a secure connection to the origin server');
    } else if (finalStatus >= 520 && finalStatus <= 530) {
      issues.push(`Destination returns Cloudflare error HTTP ${finalStatus} — origin server is unreachable or misconfigured`);
    } else if (finalStatus >= 500) {
      issues.push(`Destination returns HTTP ${finalStatus} — server error; site may be down`);
    } else if (finalStatus >= 400) {
      issues.push(`Destination returns HTTP ${finalStatus} — site may be misconfigured or require authentication`);
    }
  }

  return {
    hops,
    start_url: startUrl,
    final_url: finalUrl,
    chain_length: chainLength,
    has_https_redirect: hasHttps,
    has_www_change: hasWwwChange,
    is_clean: chainLength <= 1 && !has302 && !finalHopError,
    issues,
  };
}
