import { fetchWithTimeout } from '../lib/http';

export interface SiteIntelResult {
  ip: string | null;
  hosting: HostingInfo | null;
  dns: DnsRecords;
  fonts: FontInfo;
  carbon: CarbonInfo | null;
  third_party: ThirdPartyInfo;
  issues: string[];
}

export interface HostingInfo {
  city: string | null;
  region: string | null;
  country: string | null;
  org: string | null;
  org_label: string | null;   // human-readable provider name derived from org ASN string
  timezone: string | null;
  hostname: string | null;
}

export interface DnsRecords {
  target_host: string;
  root_domain: string;
  a: string[];
  aaaa: string[];
  mx: MxRecord[];
  ns: string[];
  has_ipv6: boolean;
}

interface MxRecord {
  priority: number;
  exchange: string;
}

export interface FontInfo {
  google_fonts: string[];
  adobe_fonts: boolean;
  bunny_fonts: string[];
  custom_fonts: string[];
  system_only: boolean;
  total_font_requests: number;
}

export interface CarbonInfo {
  grams_per_view: number;
  cleaner_than_pct: number;
  is_green_host: boolean;
  rating: string;
}

export interface ThirdPartyInfo {
  total_third_party_domains: number;
  categories: Record<string, string[]>;
  script_domains: string[];
}

// Map of known third-party domains → category
const THIRD_PARTY_MAP: Record<string, string> = {
  'googletagmanager.com': 'Analytics',
  'google-analytics.com': 'Analytics',
  'analytics.google.com': 'Analytics',
  'hotjar.com': 'Analytics',
  'mouseflow.com': 'Analytics',
  'fullstory.com': 'Analytics',
  'clarity.ms': 'Analytics',
  'mixpanel.com': 'Analytics',
  'segment.com': 'Analytics',
  'plausible.io': 'Analytics',
  'posthog.com': 'Analytics',
  'heap.io': 'Analytics',
  'heapanalytics.com': 'Analytics',
  'connect.facebook.net': 'Advertising',
  'facebook.net': 'Advertising',
  'doubleclick.net': 'Advertising',
  'googlesyndication.com': 'Advertising',
  'googleadservices.com': 'Advertising',
  'ads.linkedin.com': 'Advertising',
  'static.ads-twitter.com': 'Advertising',
  'snap.licdn.com': 'Advertising',
  'sc-static.net': 'Advertising',
  'intercomcdn.com': 'Live Chat',
  'intercom.io': 'Live Chat',
  'widget.intercom.io': 'Live Chat',
  'js.driftt.com': 'Live Chat',
  'drift.com': 'Live Chat',
  'zdassets.com': 'Live Chat',
  'zendesk.com': 'Live Chat',
  'hs-scripts.com': 'Live Chat',
  'crisp.chat': 'Live Chat',
  'tawk.to': 'Live Chat',
  'tidio.com': 'Live Chat',
  'freshchat.com': 'Live Chat',
  'stripe.com': 'Payments',
  'js.stripe.com': 'Payments',
  'paypal.com': 'Payments',
  'braintreegateway.com': 'Payments',
  'checkout.com': 'Payments',
  'adyen.com': 'Payments',
  'sentry.io': 'Monitoring',
  'bugsnag.com': 'Monitoring',
  'newrelic.com': 'Monitoring',
  'datadoghq.com': 'Monitoring',
  'rollbar.com': 'Monitoring',
  'logrocket.com': 'Monitoring',
  'cdn.jsdelivr.net': 'CDN / Libraries',
  'cdnjs.cloudflare.com': 'CDN / Libraries',
  'unpkg.com': 'CDN / Libraries',
  'ajax.googleapis.com': 'CDN / Libraries',
  'fonts.googleapis.com': 'Fonts',
  'fonts.gstatic.com': 'Fonts',
  'use.typekit.net': 'Fonts',
  'fonts.bunny.net': 'Fonts',
  'platform.twitter.com': 'Social',
  'connect.facebook.com': 'Social',
  'apis.google.com': 'Social',
  'platform.linkedin.com': 'Social',
  'assets.pinterest.com': 'Social',
};

async function dnsJson(domain: string, type: string): Promise<{ Answer?: Array<{ data: string; priority?: number }> }> {
  try {
    const res = await fetchWithTimeout(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`,
      { timeoutMs: 5000, headers: { Accept: 'application/dns-json' } }
    );
    return res.ok ? res.json() : {};
  } catch { return {}; }
}

function extractGoogleFonts(href: string): string[] {
  try {
    const url = new URL(href);
    const families: string[] = [];
    for (const f of url.searchParams.getAll('family')) {
      const name = f.split(':')[0].replace(/\+/g, ' ');
      if (name) families.push(name);
    }
    if (!families.length) {
      // Legacy API: ?family=Roboto|Open+Sans
      const raw = url.searchParams.get('family') ?? '';
      raw.split('|').forEach(f => { const n = f.split(':')[0].replace(/\+/g, ' ').trim(); if (n) families.push(n); });
    }
    return families;
  } catch { return []; }
}

export async function runSiteIntel(domain: string, html: string, rootDomain = domain): Promise<SiteIntelResult> {
  const issues: string[] = [];

  // ── DNS records in parallel (A + AAAA + MX + NS) ─────────────────────────
  const [aData, aaaaData, mxData, nsData] = await Promise.all([
    dnsJson(domain, 'A'),
    dnsJson(domain, 'AAAA'),
    dnsJson(rootDomain, 'MX'),
    dnsJson(rootDomain, 'NS'),
  ]);

  const aRecords    = (aData.Answer    ?? []).map(r => r.data.trim()).filter(Boolean);
  const aaaaRecords = (aaaaData.Answer ?? []).map(r => r.data.trim()).filter(Boolean);
  const mxRecords   = (mxData.Answer   ?? [])
    .map(r => { const parts = r.data.split(' '); return { priority: Number(parts[0]) || 0, exchange: (parts[1] ?? '').replace(/\.$/, '') }; })
    .filter(r => r.exchange);
  const nsRecords   = (nsData.Answer   ?? []).map(r => r.data.replace(/\.$/, '').trim()).filter(Boolean);

  if (aRecords.length === 0) issues.push('No A records found — domain may not be pointing to a server');
  if (mxRecords.length === 0) issues.push('No MX records — domain cannot receive email');

  // ── IP geolocation via ipinfo.io (free, 50k/month, no auth needed) ────────
  const primaryIp = aRecords[0] ?? null;
  let hosting: HostingInfo | null = null;

  if (primaryIp) {
    try {
      const infoRes = await fetchWithTimeout(`https://ipinfo.io/${primaryIp}/json`, { timeoutMs: 5000 });
      if (infoRes.ok) {
        const info = await infoRes.json() as {
          ip?: string; hostname?: string; city?: string; region?: string;
          country?: string; org?: string; timezone?: string;
        };
        const orgRaw = info.org ?? '';
        // Use uppercase for all matching — ipinfo mixes case ("Cloudflare" not "CLOUDFLARE")
        const orgUp = orgRaw.toUpperCase();
        const orgLabel = orgUp.includes('AMAZON') || orgUp.includes('AWS') ? 'Amazon Web Services'
          : orgUp.includes('GOOGLE') ? 'Google Cloud'
          : orgUp.includes('MICROSOFT') || orgUp.includes('AZURE') ? 'Microsoft Azure'
          : orgUp.includes('DIGITALOCEAN') ? 'DigitalOcean'
          : orgUp.includes('HETZNER') ? 'Hetzner'
          : orgUp.includes('OVH') ? 'OVH'
          : orgUp.includes('LINODE') ? 'Linode / Akamai'
          : orgUp.includes('VULTR') ? 'Vultr'
          : orgUp.includes('FASTLY') ? 'Fastly'
          : orgUp.includes('CLOUDFLARE') ? 'Cloudflare'
          : orgRaw.replace(/^AS\d+\s*/i, '').trim() || null;
        hosting = {
          city: info.city ?? null,
          region: info.region ?? null,
          country: info.country ?? null,
          org: orgRaw || null,
          org_label: orgLabel || null,
          timezone: info.timezone ?? null,
          hostname: info.hostname ?? null,
        };
      }
    } catch { /* non-fatal */ }
  }

  // ── Font detection ────────────────────────────────────────────────────────
  const googleFonts: string[] = [];
  const bunnyFonts: string[] = [];
  let adobeFonts = false;
  const customFonts: string[] = [];

  for (const m of html.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]*>/gi)) {
    const href = m[1];
    if (/fonts\.googleapis\.com/i.test(href)) googleFonts.push(...extractGoogleFonts(href));
    if (/use\.typekit\.net/i.test(href)) adobeFonts = true;
    if (/fonts\.bunny\.net/i.test(href)) bunnyFonts.push(...extractGoogleFonts(href));
  }
  // Also check <script src> for Adobe Typekit
  if (/<script[^>]+use\.typekit\.net/i.test(html)) adobeFonts = true;

  // Extract @font-face src: url(...) from inline <style> blocks
  const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]);
  for (const block of styleBlocks) {
    for (const fontM of block.matchAll(/@font-face[\s\S]*?src:\s*url\(['"]?([^'")\s]+\.(?:woff2?|ttf|otf))/gi)) {
      const fontSrc = fontM[1];
      if (/^https?:\/\//.test(fontSrc) && !fontSrc.includes(domain)) continue; // external handled above
      // Self-hosted: try to extract a family name from the CSS block context
      const familyMatch = fontM[0].match(/font-family:\s*['"]?([^'";,]+)/i);
      if (familyMatch) {
        const name = familyMatch[1].trim();
        if (!customFonts.includes(name)) customFonts.push(name);
      }
    }
  }

  const totalFontRequests = googleFonts.length + bunnyFonts.length + (adobeFonts ? 1 : 0) + customFonts.length;
  const systemOnly = totalFontRequests === 0;
  // "No web fonts" is surfaced by the dedicated Font Performance card — no duplicate issue here.
  const uniqueGoogleFonts = [...new Set(googleFonts)];
  const uniqueBunnyFonts  = [...new Set(bunnyFonts)];
  if (uniqueGoogleFonts.length > 4) issues.push(`${uniqueGoogleFonts.length} Google Fonts loaded — more than 4 font families harms page speed`);

  // ── Third-party script inventory ──────────────────────────────────────────
  const scriptDomains = new Set<string>();
  for (const m of html.matchAll(/<script[^>]+src=["']https?:\/\/([^/"']+)/gi)) {
    const scriptDomain = m[1].toLowerCase().replace(/^www\./, '');
    if (!scriptDomain.includes(domain.toLowerCase())) scriptDomains.add(scriptDomain);
  }
  // Also check <link rel="preconnect|dns-prefetch"> as hints of third-party resources.
  // These are tracked separately so they don't inflate the third-party script count.
  const preconnectHints = new Set<string>();
  for (const m of html.matchAll(/<link[^>]+(?:preconnect|dns-prefetch)[^>]*href=["']https?:\/\/([^/"']+)/gi)) {
    const d2 = m[1].toLowerCase().replace(/^www\./, '');
    if (!d2.includes(domain.toLowerCase()) && !scriptDomains.has(d2)) preconnectHints.add(d2);
  }
  // Preconnect hints that are also confirmed script hosts are already in scriptDomains;
  // hints-only domains are intentionally NOT added so they don't inflate the third-party count.

  const categories: Record<string, string[]> = {};
  for (const sd of scriptDomains) {
    const cat = THIRD_PARTY_MAP[sd] ?? (sd.includes('google') ? 'Google' : 'Other');
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(sd);
  }

  if (scriptDomains.size > 15) issues.push(`${scriptDomains.size} third-party domains loaded — excessive third-party scripts slow page load and risk privacy compliance`);

  const third_party: ThirdPartyInfo = {
    total_third_party_domains: scriptDomains.size,
    categories,
    script_domains: [...scriptDomains].slice(0, 20),
  };

  const carbon: CarbonInfo | null = null;

  // ── Platform detection from scripts + HTML + NS ───────────────────────────
  // Runs last so it has access to third_party script_domains.
  // Detects website builders / PaaS platforms that proxy through generic CDNs
  // (Cloudflare, Fastly) so the IP org lookup doesn't reveal the real platform.
  {
    const allDomains = [...scriptDomains].join(' ').toLowerCase();
    const nsStr      = nsRecords.join(' ').toLowerCase();
    const htmlLower  = html.slice(0, 8000).toLowerCase();

    const platform =
      // Webflow: uses website-files.com CDN or webflow.io assets
      allDomains.includes('website-files.com') || allDomains.includes('webflow.io') ||
      htmlLower.includes('webflow') || nsStr.includes('webflow')
        ? 'Webflow'
      // Squarespace: uses sqsp.net or squarespace assets
      : allDomains.includes('squarespace.com') || allDomains.includes('sqsp.net') ||
        htmlLower.includes('squarespace') || nsStr.includes('squarespace')
        ? 'Squarespace'
      // Wix: uses wixstatic.com
      : allDomains.includes('wixstatic.com') || allDomains.includes('wix.com') ||
        nsStr.includes('wixdns')
        ? 'Wix'
      // Shopify: uses myshopify.com or cdn.shopify.com
      : allDomains.includes('shopify.com') || allDomains.includes('shopifycdn.com') ||
        nsStr.includes('shopify')
        ? 'Shopify'
      // Framer: uses framer.com assets
      : allDomains.includes('framer.com') || htmlLower.includes('framer.com')
        ? 'Framer'
      // Vercel: uses vercel.app domain or vercel NS — do NOT infer from /_next/ paths,
      // which are produced by any Next.js build regardless of where it is hosted.
      : allDomains.includes('vercel.com') || nsStr.includes('vercel')
        ? 'Vercel'
      // Netlify: uses netlify.com assets
      : allDomains.includes('netlify.com') || nsStr.includes('netlify')
        ? 'Netlify'
      // Ghost: uses ghost.io CDN
      : allDomains.includes('ghost.io') || htmlLower.includes('ghost.org')
        ? 'Ghost'
      // GitHub Pages: NS hint, github.io asset domain, or IP reverse-DNS → cdn-*.github.com
      : nsStr.includes('github') || allDomains.includes('github.io') ||
        hosting?.hostname?.includes('.github.com')
        ? 'GitHub Pages'
      : null;

    if (platform) {
      hosting = hosting
        ? { ...hosting, org_label: platform }
        : { city: null, region: null, country: null, org: null, org_label: platform, timezone: null, hostname: null };
    }
  }

  return {
    ip: primaryIp,
    hosting,
    dns: {
      target_host: domain,
      root_domain: rootDomain,
      a: aRecords,
      aaaa: aaaaRecords,
      mx: mxRecords,
      ns: nsRecords,
      has_ipv6: aaaaRecords.length > 0,
    },
    fonts: { google_fonts: uniqueGoogleFonts, adobe_fonts: adobeFonts, bunny_fonts: uniqueBunnyFonts, custom_fonts: customFonts, system_only: systemOnly, total_font_requests: totalFontRequests },
    carbon,
    third_party,
    issues,
  };
}
