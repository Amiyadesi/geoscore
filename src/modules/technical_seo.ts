import { fetchWithTimeout, type HttpFetcher } from '../lib/http';
import { descriptionLengthRange, isBrandOnlyHomepageTitle, isDescriptionLengthGood, isTextLengthGood, textLengthRange } from '../lib/metadata-quality';
import { parseHTML } from 'linkedom';

export interface RobotsSummary {
  user_agent_count: number;
  disallow_count: number;
  has_sitemap_ref: boolean;
  preview: string;
}

export interface TechnicalSeoResult {
  checks: Check[];
  score: number;
  issues: string[];
  blocked_ai_bots: string[];
  crawler_policy_v2: CrawlerPolicyV2;
  llms_txt_present: boolean;
  llms_txt_status: 'complete' | 'missing' | 'error';
  sitemap_url_count: number;
  response_time_ms: number;
  /** False when the page came from Browser Run and target response headers were unavailable. */
  transport_evidence_available: boolean;
  tech_stack: TechStack;
  security_headers: SecurityHeaders;
  page_meta: PageMeta;
  robots_summary: RobotsSummary;
  page_weight_kb: number;
  render_blocking_scripts: number;
  h1_tags: string[];
  h2_tags: string[];
  dom_element_count: number;
  compression: CompressionInfo;
  image_audit: ImageAudit;
  has_media_queries: boolean;
  ads_txt: boolean;
  unsafe_cross_origin_links: number;
  plaintext_emails: number;
  deprecated_tags: string[];
  top_keywords: Array<{ word: string; count: number }>;
  http3_supported: boolean;
  rss_feed_url: string | null;
  pwa: {
    has_manifest: boolean;
    display: string | null;
    has_icons: boolean;
    name: string | null;
  } | null;
  ai_training_optout: boolean;
}

export interface CrawlerPolicyGroup {
  bots: string[];
  blocked: string[];
  allowed: string[];
  status: 'known' | 'unknown';
}

export interface CrawlerPolicyV2 {
  version: '2';
  source: 'robots.txt';
  robots_status: 'complete' | 'missing' | 'error';
  search_index: CrawlerPolicyGroup;
  training: CrawlerPolicyGroup;
  user_fetch: CrawlerPolicyGroup;
  training_opt_out: boolean;
}

export interface PageMeta {
  title: string | null;
  description: string | null;
  og_title: string | null;
  og_description: string | null;
  og_image: string | null;
  og_type: string | null;
  og_site_name: string | null;
  canonical_url: string | null;
  twitter_card: string | null;
  twitter_title: string | null;
  twitter_description: string | null;
  twitter_image: string | null;
  favicon: string | null;
  lang: string | null;
  article_published_time: string | null;
  article_modified_time: string | null;
  article_author: string | null;
}

function cleanMetaValue(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

/** Parse metadata with an HTML parser so apostrophes and attribute ordering are preserved. */
export function extractPageMeta(html: string): PageMeta {
  const empty: PageMeta = {
    title: null,
    description: null,
    og_title: null,
    og_description: null,
    og_image: null,
    og_type: null,
    og_site_name: null,
    canonical_url: null,
    twitter_card: null,
    twitter_title: null,
    twitter_description: null,
    twitter_image: null,
    favicon: null,
    lang: null,
    article_published_time: null,
    article_modified_time: null,
    article_author: null,
  };

  try {
    const { document } = parseHTML(html);
    const metas = [...document.querySelectorAll('meta')];
    const metaValue = (attribute: 'name' | 'property', key: string): string | null => {
      const wanted = key.toLowerCase();
      const node = metas.find(item => (item.getAttribute(attribute) ?? '').trim().toLowerCase() === wanted);
      return cleanMetaValue(node?.getAttribute('content'));
    };
    const links = [...document.querySelectorAll('link')];
    const linkValue = (requiredRel: string, attribute: 'href' = 'href'): string | null => {
      const node = links.find(item => (item.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).includes(requiredRel));
      return cleanMetaValue(node?.getAttribute(attribute));
    };
    const lang = cleanMetaValue(document.documentElement?.getAttribute('lang'));

    return {
      title: cleanMetaValue(document.querySelector('title')?.textContent),
      description: metaValue('name', 'description'),
      og_title: metaValue('property', 'og:title'),
      og_description: metaValue('property', 'og:description'),
      og_image: metaValue('property', 'og:image'),
      og_type: metaValue('property', 'og:type'),
      og_site_name: metaValue('property', 'og:site_name'),
      canonical_url: linkValue('canonical'),
      twitter_card: metaValue('name', 'twitter:card'),
      twitter_title: metaValue('name', 'twitter:title'),
      twitter_description: metaValue('name', 'twitter:description'),
      twitter_image: metaValue('name', 'twitter:image'),
      favicon: linkValue('icon') ?? linkValue('shortcut'),
      lang,
      article_published_time: metaValue('property', 'article:published_time'),
      article_modified_time: metaValue('property', 'article:modified_time'),
      article_author: metaValue('property', 'article:author'),
    };
  } catch {
    return empty;
  }
}

interface Check {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface TechnicalSeoOptions {
  fetcher?: HttpFetcher;
  includeAdsTxt?: boolean;
  transportEvidenceAvailable?: boolean;
}

interface TextProbe {
  status: 'complete' | 'missing' | 'error';
  text: string;
}

async function probeText(fetcher: HttpFetcher, url: string, timeoutMs: number): Promise<TextProbe> {
  try {
    const response = await fetcher(url, { timeoutMs });
    if (response.status === 404) return { status: 'missing', text: '' };
    if (!response.ok) return { status: 'error', text: '' };
    return { status: 'complete', text: await response.text() };
  } catch {
    return { status: 'error', text: '' };
  }
}

export interface TechStack {
  // Infrastructure
  web_server: string | null;
  cdn: string | null;
  paas: string | null;
  backend_language: string | null;
  // Site platform
  cms: string | null;
  ecommerce: string | null;
  // Frontend
  frameworks: string[];
  js_libraries: string[];
  css_framework: string | null;
  // Data & tracking
  analytics: string[];
  tag_manager: string[];
  heatmaps: string[];
  ab_testing: string[];
  // User engagement
  chat: string | null;
  forms: string[];
  video: string[];
  maps: string[];
  // Business tools
  payments: string[];
  email_marketing: string[];
  monitoring: string[];
  // Compliance
  cookie_consent: string | null;
  // Detected version numbers (technology name → version string)
  versions: Record<string, string>;
}

export interface SecurityHeaders {
  hsts: boolean;
  xframe: boolean;
  xcontent: boolean;
  csp: boolean;
  referrer: boolean;
  permissions: boolean;
  score: number;
}

export interface CompressionInfo {
  enabled: boolean;
  encoding: string | null;
  raw_kb: number;
  compressed_kb: number | null;
  savings_pct: number | null;
}

export interface ImageAudit {
  total: number;
  missing_alt: number;
  missing_alt_srcs: string[];
  modern_count: number;
}

export const CRAWLER_POLICY_BOTS = {
  search_index: ['OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot', 'Googlebot'],
  training: ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot', 'anthropic-ai'],
  user_fetch: ['ChatGPT-User', 'Claude-User', 'Perplexity-User'],
} as const;

function blockedBots(content: string, bots: readonly string[]): string[] {
  const botLower = (bot: string) => bot.toLowerCase();
  const blocks = content.split(/\n[ \t]*\n/);
  const agentBlocks = new Map<string, string[]>();
  for (const block of blocks) {
    const lines = block.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
    const agents = lines
      .filter(line => /^user-agent:/i.test(line))
      .map(line => line.replace(/^user-agent:\s*/i, '').trim().toLowerCase());
    for (const agent of agents) {
      if (!agentBlocks.has(agent)) agentBlocks.set(agent, lines);
    }
  }
  const isBlockedByLines = (lines: string[]) => {
    const disallowsRoot = lines.some(line => /^disallow:\s*\/$/i.test(line));
    const allowsRoot = lines.some(line => /^allow:\s*\/\s*$/i.test(line));
    return disallowsRoot && !allowsRoot;
  };
  return bots.filter(bot => {
    const specific = agentBlocks.get(botLower(bot));
    if (specific) return isBlockedByLines(specific);
    const wildcard = agentBlocks.get('*');
    return wildcard ? isBlockedByLines(wildcard) : false;
  });
}

export function buildCrawlerPolicyV2(
  content: string,
  robotsStatus: CrawlerPolicyV2['robots_status'] = content ? 'complete' : 'missing',
): CrawlerPolicyV2 {
  const known = robotsStatus !== 'error';
  const group = (bots: readonly string[]): CrawlerPolicyGroup => {
    const blocked = known ? blockedBots(content, bots) : [];
    return {
      bots: [...bots],
      blocked,
      allowed: known ? bots.filter(bot => !blocked.includes(bot)) : [],
      status: known ? 'known' : 'unknown',
    };
  };
  const searchIndex = group(CRAWLER_POLICY_BOTS.search_index);
  const training = group(CRAWLER_POLICY_BOTS.training);
  const userFetch = group(CRAWLER_POLICY_BOTS.user_fetch);
  return {
    version: '2',
    source: 'robots.txt',
    robots_status: robotsStatus,
    search_index: searchIndex,
    training,
    user_fetch: userFetch,
    training_opt_out: training.blocked.length > 0,
  };
}


function parseRobotsSummary(content: string): RobotsSummary {
  if (!content) return { user_agent_count: 0, disallow_count: 0, has_sitemap_ref: false, preview: '' };
  const userAgents = content.match(/^User-agent:/gim) ?? [];
  const disallows = content.match(/^Disallow:\s*\S/gim) ?? [];
  return {
    user_agent_count: userAgents.length,
    disallow_count: disallows.length,
    has_sitemap_ref: /^Sitemap:/im.test(content),
    preview: content.slice(0, 500),
  };
}

function extractVersion(html: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

function detectTechStack(html: string, headers: Headers): TechStack {
  const lower = html.toLowerCase();
  const versions: Record<string, string> = {};

  // ── Version extraction helpers ────────────────────────────────────────────
  const wpVer = extractVersion(html, [
    /meta name=["']generator["'][^>]*content=["']WordPress\s+([\d.]+)/i,
    /\?ver=([\d.]+).*wp-includes/i,
  ]);
  const jqVer = extractVersion(html, [
    /jquery[.-]([\d]+\.[\d]+\.[\d]+)(?:\.min)?\.js/i,
    /jquery\/?([\d]+\.[\d]+\.[\d]+)/i,
  ]);
  const reactVer = extractVersion(html, [
    /react@([\d]+\.[\d]+\.[\d]+)/i,
    /"version":"([\d]+\.[\d]+\.[\d]+)"[^}]*"react"/i,
  ]);
  const bootstrapVer = extractVersion(html, [
    /bootstrap[.-]([\d]+\.[\d]+\.[\d]+)/i,
    /bootstrap@([\d]+\.[\d]+\.[\d]+)/i,
  ]);
  const nextVer = extractVersion(html, [
    /next[.-]([\d]+\.[\d]+\.[\d]+)/i,
    /"next":"([\d]+\.[\d]+\.[\d]+)"/i,
  ]);
  const gsapVer = extractVersion(html, [/gsap[.-]([\d]+\.[\d]+\.[\d]+)/i]);
  const threeVer = extractVersion(html, [/three[.-]([\d]+\.[\d]+\.[\d]+)/i]);

  // ── Infrastructure ────────────────────────────────────────────────────────
  const server = headers.get('server')?.toLowerCase() ?? '';
  const via    = (headers.get('via') ?? '').toLowerCase();

  let web_server: string | null = null;
  if (server.includes('nginx') || server.includes('openresty')) web_server = 'Nginx';
  else if (server.includes('apache')) web_server = 'Apache';
  else if (server.includes('litespeed')) web_server = 'LiteSpeed';
  else if (server.includes('microsoft-iis')) {
    web_server = 'IIS';
    const iisVer = extractVersion(headers.get('server') ?? '', [/iis\/([\d.]+)/i]);
    if (iisVer) versions['IIS'] = iisVer;
  }
  else if (server.includes('caddy')) web_server = 'Caddy';
  else if (server.includes('cloudflare')) web_server = 'Cloudflare';
  else if (server.includes('envoy')) web_server = 'Envoy';
  else if (server.includes('gunicorn')) web_server = 'Gunicorn';
  else if (server.includes('kestrel')) web_server = 'Kestrel (.NET)';
  else if (server && !server.includes('(') && server.length < 40) web_server = server.split('/')[0].trim() || null;

  let cdn: string | null = null;
  if (headers.get('cf-ray')) cdn = 'Cloudflare';
  else if (headers.get('x-amz-cf-id') || headers.get('x-amz-cf-pop')) cdn = 'Amazon CloudFront';
  else if (headers.get('x-served-by') || headers.get('x-fastly-request-id')) cdn = 'Fastly';
  else if (headers.get('x-vercel-id')) cdn = 'Vercel Edge Network';
  else if (headers.get('x-netlify-id') || headers.get('x-nf-request-id')) cdn = 'Netlify Edge';
  else if (via.includes('akamai') || headers.get('x-akamai-transformed')) cdn = 'Akamai';
  else if (headers.get('x-sucuri-id')) cdn = 'Sucuri';
  else if (headers.get('x-bunny-cache') || headers.get('cdn-pullzone')) cdn = 'BunnyCDN';
  else if (headers.get('x-cache') && !headers.get('cf-ray')) cdn = 'Varnish / Proxy Cache';

  let paas: string | null = null;
  if (headers.get('x-vercel-id')) paas = 'Vercel';
  else if (headers.get('x-netlify-id') || headers.get('x-nf-request-id')) paas = 'Netlify';
  else if (headers.get('x-render-origin-server')) paas = 'Render';
  else if (via.includes('heroku') || lower.includes('herokucdn')) paas = 'Heroku';
  else if (headers.get('x-amz-cf-id') || headers.get('x-amz-request-id')) paas = 'Amazon Web Services';
  else if (server.includes('gws') || headers.get('x-guploader-uploadid')) paas = 'Google Cloud';
  else if (headers.get('x-ms-request-id') || headers.get('x-azure-ref')) paas = 'Microsoft Azure';
  else if (headers.get('cf-ray')) paas = 'Cloudflare';
  else if (lower.includes('github.io') || headers.get('x-github-request-id')) paas = 'GitHub Pages';
  else if (lower.includes('fly.io') || headers.get('fly-request-id')) paas = 'Fly.io';
  else if (headers.get('x-railway-static-url') || lower.includes('railway.app')) paas = 'Railway';

  // Backend language — from X-Powered-By or server hints
  let backend_language: string | null = null;
  const poweredBy = (headers.get('x-powered-by') ?? '').toLowerCase();
  if (poweredBy.includes('php')) {
    backend_language = 'PHP';
    const phpVer = extractVersion(headers.get('x-powered-by') ?? '', [/PHP\/([\d.]+)/i]);
    if (phpVer) versions['PHP'] = phpVer;
  } else if (poweredBy.includes('asp.net') || server.includes('microsoft-iis')) {
    backend_language = 'ASP.NET';
    const aspVer = extractVersion(headers.get('x-powered-by') ?? '', [/ASP\.NET Version:([\d.]+)/i, /ASP\.NET\/([\d.]+)/i]);
    if (aspVer) versions['ASP.NET'] = aspVer;
  } else if (poweredBy.includes('express') || lower.includes('x-powered-by: express')) {
    backend_language = 'Node.js (Express)';
  } else if (server.includes('python') || lower.includes('django') || lower.includes('flask')) {
    backend_language = 'Python';
  } else if (server.includes('ruby') || /\bruby on rails\b|rails\/([\d.]+)|rack\/[\d.]+\s+\(ruby\)/i.test(lower)) {
    backend_language = 'Ruby';
  } else if (lower.includes('laravel') || lower.includes('symfony') || lower.includes('wp-content')) {
    backend_language = 'PHP';
  } else if (server.includes('gunicorn') || server.includes('uvicorn') || lower.includes('fastapi')) {
    backend_language = 'Python';
  }

  // ── Site platform ─────────────────────────────────────────────────────────
  let cms: string | null = null;
  // AI website builders — detect before generic CMS checks (their footprint is in asset URLs/meta)
  if (lower.includes('lovable.app') || /lovable\.dev/i.test(lower)) {
    cms = 'Lovable';
  } else if (/stackblitz\.io|bolt\.new/i.test(lower)) {
    cms = 'Bolt';
  } else if (/v0\.dev/i.test(lower)) {
    cms = 'v0 (Vercel)';
  } else if (lower.includes('wp-content') || lower.includes('wp-json') || lower.includes('/wp-includes')) {
    cms = 'WordPress';
    if (wpVer) versions['WordPress'] = wpVer;
    if (!backend_language) backend_language = 'PHP';
  } else if (lower.includes('.myshopify.com') || lower.includes('shopify.com/s/files')) {
    cms = 'Shopify';
  } else if (lower.includes('wix.com') || lower.includes('_wix_')) {
    cms = 'Wix';
  } else if (lower.includes('squarespace.com') || lower.includes('squarespace-cdn')) {
    cms = 'Squarespace';
  } else if (lower.includes('webflow.io') || lower.includes('webflow.com')) {
    cms = 'Webflow';
  } else if (lower.includes('ghost.io') || lower.includes('ghost/api')) {
    cms = 'Ghost';
  } else if (lower.includes('drupal.settings') || lower.includes('/sites/default/files')) {
    cms = 'Drupal';
    if (!backend_language) backend_language = 'PHP';
  } else if (lower.includes('/components/com_') || lower.includes('joomla')) {
    cms = 'Joomla';
    if (!backend_language) backend_language = 'PHP';
  } else if (lower.includes('prestashop')) {
    cms = 'PrestaShop';
    if (!backend_language) backend_language = 'PHP';
  } else if (lower.includes('magento') || lower.includes('mage/cookies')) {
    cms = 'Magento';
    if (!backend_language) backend_language = 'PHP';
  } else if (lower.includes('duda.co') || lower.includes('duda.com')) {
    cms = 'Duda';
  } else if (lower.includes('framer.com') || lower.includes('framerusercontent')) {
    cms = 'Framer';
  } else if (lower.includes('hubspot.com') && lower.includes('hs-sites')) {
    cms = 'HubSpot CMS';
  } else if (lower.includes('notion.site') || lower.includes('notion.so')) {
    cms = 'Notion';
  }

  let ecommerce: string | null = null;
  if (lower.includes('woocommerce') || lower.includes('wc-ajax')) ecommerce = 'WooCommerce';
  else if (lower.includes('.myshopify.com') || lower.includes('shopify.com/s/files')) ecommerce = 'Shopify';
  else if (lower.includes('magento') || lower.includes('mage/cookies')) ecommerce = 'Magento';
  else if (lower.includes('prestashop')) ecommerce = 'PrestaShop';
  // BigCommerce: require actual BC infrastructure URLs — the word "bigcommerce" appears on
  // competitor comparison pages (Shopify, WooCommerce, etc.) and triggers false positives.
  else if (/cdn\d+\.bigcommerce\.com|bc\.bigcommerce\.com|bigcommerce-assets\.com|\/bc-sf-filter\//i.test(lower)) ecommerce = 'BigCommerce';
  else if (lower.includes('wix.com') && lower.includes('wixstores')) ecommerce = 'Wix Stores';
  else if (lower.includes('ecwid')) ecommerce = 'Ecwid';
  else if (lower.includes('snipcart')) ecommerce = 'Snipcart';

  // ── Frontend frameworks ───────────────────────────────────────────────────
  const frameworks: string[] = [];
  if (lower.includes('__next_data__') || lower.includes('/_next/static')) {
    frameworks.push('Next.js');
    if (nextVer) versions['Next.js'] = nextVer;
  } else if (lower.includes('__nuxt') || lower.includes('/_nuxt/')) {
    frameworks.push('Nuxt.js');
  }
  if (lower.includes('__reactfiber') || (lower.includes('react') && lower.includes('react-dom'))) {
    frameworks.push('React');
    if (reactVer) versions['React'] = reactVer;
  }
  if (lower.includes('__vue') || (lower.includes('vue') && lower.includes('vue.min'))) frameworks.push('Vue.js');
  if (lower.includes('ng-version') || lower.includes('[ng-')) frameworks.push('Angular');
  if (lower.includes('svelte') && (lower.includes('.svelte') || lower.includes('svelte/'))) frameworks.push('Svelte');
  if (lower.includes('astro-') && lower.includes('astro')) frameworks.push('Astro');
  if (lower.includes('remix') && (lower.includes('__remixContext') || lower.includes('remix-run'))) frameworks.push('Remix');
  if (lower.includes('gatsby') && lower.includes('___gatsby')) frameworks.push('Gatsby');
  if (lower.includes('ember') && lower.includes('ember.js')) frameworks.push('Ember.js');

  // JS libraries
  const js_libraries: string[] = [];
  if (lower.includes('jquery') && (lower.includes('jquery.min') || lower.includes('jquery-'))) {
    js_libraries.push('jQuery');
    if (jqVer) versions['jQuery'] = jqVer;
  }
  if (lower.includes('gsap') && lower.includes('greensock')) {
    js_libraries.push('GSAP');
    if (gsapVer) versions['GSAP'] = gsapVer;
  }
  if (lower.includes('three.js') || lower.includes('three.min.js') || lower.includes('/three@')) {
    js_libraries.push('Three.js');
    if (threeVer) versions['Three.js'] = threeVer;
  }
  if (lower.includes('d3.js') || lower.includes('d3.min.js') || lower.includes('/d3@') || lower.includes('d3-selection')) js_libraries.push('D3.js');
  if (lower.includes('lodash') || lower.includes('lodash.min')) js_libraries.push('Lodash');
  if (lower.includes('chart.js') || lower.includes('chartjs')) js_libraries.push('Chart.js');
  if (lower.includes('anime.js') || lower.includes('animejs')) js_libraries.push('Anime.js');
  if (lower.includes('alpine.js') || lower.includes('alpinejs') || lower.includes('x-data=')) js_libraries.push('Alpine.js');
  if (lower.includes('htmx') && (lower.includes('hx-get') || lower.includes('htmx.min'))) js_libraries.push('htmx');
  if (lower.includes('swiper') && (lower.includes('swiper.min') || lower.includes('swiper-bundle'))) js_libraries.push('Swiper');
  if (lower.includes('lottie') && lower.includes('lottie')) js_libraries.push('Lottie');

  // CSS framework
  let css_framework: string | null = null;
  if (lower.includes('tailwind') && (lower.includes('tailwindcss') || lower.includes('tw-'))) css_framework = 'Tailwind CSS';
  else if (lower.includes('bootstrap') && (lower.includes('bootstrap.min') || lower.includes('bootstrap-'))) {
    css_framework = 'Bootstrap';
    if (bootstrapVer) versions['Bootstrap'] = bootstrapVer;
  }
  else if (lower.includes('bulma') && lower.includes('bulma.min')) css_framework = 'Bulma';
  else if (lower.includes('foundation') && lower.includes('foundation.min')) css_framework = 'Foundation';
  else if (lower.includes('material-components') || lower.includes('mdc-')) css_framework = 'Material Design';
  else if (lower.includes('chakra-ui') || lower.includes('chakra')) css_framework = 'Chakra UI';
  else if (lower.includes('shadcn') || lower.includes('radix-ui')) css_framework = 'shadcn/ui';
  else if (lower.includes('antd') || lower.includes('ant-design')) css_framework = 'Ant Design';

  // ── Analytics ────────────────────────────────────────────────────────────
  const analytics: string[] = [];
  if (lower.includes('gtag(') || lower.includes('google-analytics.com') || lower.includes('ga.js')) analytics.push('Google Analytics');
  if (lower.includes('facebook.net') && (lower.includes('fbevents') || lower.includes('fbq('))) analytics.push('Meta Pixel');
  if (lower.includes('plausible.io')) analytics.push('Plausible');
  if (lower.includes('clarity.ms')) analytics.push('Microsoft Clarity');
  if (lower.includes('mixpanel.com')) analytics.push('Mixpanel');
  if (lower.includes('posthog.com')) analytics.push('PostHog');
  if (lower.includes('segment.io') || lower.includes('cdn.segment.com')) analytics.push('Segment');
  if (lower.includes('heap.io') || lower.includes('heapanalytics')) analytics.push('Heap');
  if (lower.includes('amplitude.com') || lower.includes('amplitude.js')) analytics.push('Amplitude');
  if (lower.includes('kissmetrics')) analytics.push('Kissmetrics');
  if (lower.includes('piwik') || lower.includes('matomo')) analytics.push('Matomo');
  if (lower.includes('fathom') && lower.includes('fathom.js')) analytics.push('Fathom');
  if (lower.includes('linkedin.com/insight') || lower.includes('_linkedin_')) analytics.push('LinkedIn Insight');

  // Tag managers
  const tag_manager: string[] = [];
  if (lower.includes('googletagmanager.com')) tag_manager.push('Google Tag Manager');
  if (lower.includes('tealium') && lower.includes('utag')) tag_manager.push('Tealium');
  if (lower.includes('cdn.segment.com')) tag_manager.push('Segment');
  if (lower.includes('ensighten')) tag_manager.push('Ensighten');
  if (lower.includes('signal.co') || lower.includes('signal_tag')) tag_manager.push('Signal');

  // Heatmaps / session recording
  const heatmaps: string[] = [];
  if (lower.includes('static.hotjar.com') || lower.includes('hotjar.com/c/hotjar')) heatmaps.push('Hotjar');
  if (lower.includes('mouseflow.com')) heatmaps.push('Mouseflow');
  if (lower.includes('fullstory.com') || lower.includes('fullstory.js')) heatmaps.push('FullStory');
  if (lower.includes('logrocket.com')) heatmaps.push('LogRocket');
  if (lower.includes('luckyorange.com')) heatmaps.push('Lucky Orange');
  if (lower.includes('smartlook.com')) heatmaps.push('Smartlook');
  if (lower.includes('inspectlet.com')) heatmaps.push('Inspectlet');
  if (lower.includes('contentsquare.net') || lower.includes('clicktale')) heatmaps.push('Contentsquare');

  // A/B testing
  const ab_testing: string[] = [];
  if (lower.includes('optimizely.com') || lower.includes('optimizely.js')) ab_testing.push('Optimizely');
  if (lower.includes('vwo.com') || lower.includes('visualwebsiteoptimizer')) ab_testing.push('VWO');
  if (lower.includes('convert.com') && lower.includes('convert.js')) ab_testing.push('Convert');
  if (lower.includes('growthbook') || lower.includes('growthbook.io')) ab_testing.push('GrowthBook');
  if (lower.includes('launchdarkly.com')) ab_testing.push('LaunchDarkly');
  if (lower.includes('split.io')) ab_testing.push('Split.io');
  if (lower.includes('statsig.com') || lower.includes('statsig.io')) ab_testing.push('Statsig');
  if (lower.includes('kameleoon')) ab_testing.push('Kameleoon');

  // ── Engagement tools ──────────────────────────────────────────────────────
  let chat: string | null = null;
  if (lower.includes('intercom.io')) chat = 'Intercom';
  else if (lower.includes('js.driftt.com') || lower.includes('drift.com')) chat = 'Drift';
  else if (lower.includes('zdassets.com')) chat = 'Zendesk Chat';
  else if (lower.includes('hs-scripts') || lower.includes('hubspot.com/hs-script')) chat = 'HubSpot Chat';
  else if (lower.includes('crisp.chat')) chat = 'Crisp';
  else if (lower.includes('tawk.to')) chat = 'Tawk.to';
  else if (lower.includes('tidio')) chat = 'Tidio';
  else if (lower.includes('freshchat') || lower.includes('freshworks')) chat = 'Freshchat';
  else if (lower.includes('livechat.com') || lower.includes('livechatinc')) chat = 'LiveChat';
  else if (lower.includes('olark.com')) chat = 'Olark';
  else if (lower.includes('chatra.io')) chat = 'Chatra';
  else if (lower.includes('re.marketing') || lower.includes('trengo')) chat = 'Trengo';

  // Forms
  const forms: string[] = [];
  if (lower.includes('typeform.com') || lower.includes('typeform.io')) forms.push('Typeform');
  if (lower.includes('gravityforms') || lower.includes('gform_')) forms.push('Gravity Forms');
  if (lower.includes('hs-form') || lower.includes('hbspt.forms')) forms.push('HubSpot Forms');
  if (lower.includes('formspree.io')) forms.push('Formspree');
  if (lower.includes('tally.so')) forms.push('Tally');
  if (lower.includes('wpcf7') || lower.includes('contact-form-7')) forms.push('Contact Form 7');
  if (lower.includes('jotform.com')) forms.push('JotForm');
  if (lower.includes('netlifyforms') || lower.includes('netlify-form')) forms.push('Netlify Forms');
  if (lower.includes('cognito') && lower.includes('cognitoforms')) forms.push('Cognito Forms');
  if (lower.includes('paperform.co')) forms.push('Paperform');

  // Maps
  const maps: string[] = [];
  if (lower.includes('maps.googleapis.com') || lower.includes('google.com/maps')) maps.push('Google Maps');
  if (lower.includes('mapbox.com') || lower.includes('mapbox-gl')) maps.push('Mapbox');
  if (lower.includes('leafletjs.com') || lower.includes('leaflet.min')) maps.push('Leaflet');
  if (lower.includes('openstreetmap.org') || lower.includes('openlayers')) maps.push('OpenStreetMap');
  if (lower.includes('here.com') && lower.includes('here-maps')) maps.push('HERE Maps');

  // Video
  const video: string[] = [];
  if (lower.includes('youtube.com/embed') || lower.includes('youtu.be') || lower.includes('youtube-nocookie')) video.push('YouTube');
  if (lower.includes('player.vimeo.com') || lower.includes('vimeo.com')) video.push('Vimeo');
  if (lower.includes('wistia.com') || lower.includes('wistia.net')) video.push('Wistia');
  if (lower.includes('loom.com/embed') || lower.includes('loomuserid')) video.push('Loom');
  if (lower.includes('mux.com') || lower.includes('mux-player')) video.push('Mux');
  if (lower.includes('bunny.net') && lower.includes('video')) video.push('Bunny Stream');
  if (lower.includes('cloudflare.com/stream') || lower.includes('videodelivery.net')) video.push('Cloudflare Stream');

  // ── Business tools ────────────────────────────────────────────────────────
  const payments: string[] = [];
  // Only trigger on actual Stripe JS SDK load or Stripe-specific element attributes.
  // Avoid false positives from pages that merely mention "stripe.com" in text
  // (e.g. try-example chips like data-quick="stripe.com").
  if (lower.includes('js.stripe.com') ||
      (lower.includes('stripe.com') && /data-stripe|stripe-checkout|stripe-element|stripe-button/.test(lower)))
    payments.push('Stripe');
  if (lower.includes('paypal.com') || lower.includes('paypalobjects')) payments.push('PayPal');
  if (lower.includes('braintreegateway.com') || lower.includes('braintree')) payments.push('Braintree');
  if (lower.includes('square.com') || lower.includes('squareup.com')) payments.push('Square');
  if (lower.includes('checkout.com')) payments.push('Checkout.com');
  if (lower.includes('adyen.com')) payments.push('Adyen');
  if (lower.includes('paddle.com') || lower.includes('paddle.js')) payments.push('Paddle');
  if (lower.includes('chargebee.com')) payments.push('Chargebee');
  if (lower.includes('klarna.com')) payments.push('Klarna');
  if (lower.includes('afterpay.com') || lower.includes('clearpay.co.uk')) payments.push('Afterpay');

  // Email marketing
  const email_marketing: string[] = [];
  if (lower.includes('mailchimp.com') || lower.includes('list-manage.com') || lower.includes('mc.js')) email_marketing.push('Mailchimp');
  if (lower.includes('klaviyo.com') || lower.includes('klaviyo.js')) email_marketing.push('Klaviyo');
  if (lower.includes('sendgrid.com') || lower.includes('sendgrid.js')) email_marketing.push('SendGrid');
  if (lower.includes('brevo.com') || lower.includes('sendinblue')) email_marketing.push('Brevo');
  if (lower.includes('activecampaign.com')) email_marketing.push('ActiveCampaign');
  if (lower.includes('convertkit.com') || lower.includes('ck.page')) email_marketing.push('ConvertKit');
  if (lower.includes('drip.com') && lower.includes('drip-snippet')) email_marketing.push('Drip');
  if (lower.includes('mailerlite.com')) email_marketing.push('MailerLite');
  if (lower.includes('omnisend.com') || lower.includes('omnisend.js')) email_marketing.push('Omnisend');
  if (lower.includes('constantcontact.com')) email_marketing.push('Constant Contact');
  if (lower.includes('beehiiv.com')) email_marketing.push('Beehiiv');
  if (lower.includes('substack.com')) email_marketing.push('Substack');

  // Error monitoring / observability
  const monitoring: string[] = [];
  if (lower.includes('sentry.io') || lower.includes('browser.sentry-cdn.com')) monitoring.push('Sentry');
  if (lower.includes('bugsnag.com')) monitoring.push('Bugsnag');
  if (lower.includes('newrelic.com') || lower.includes('newrelic.js')) monitoring.push('New Relic');
  if (lower.includes('datadoghq.com') || lower.includes('datadoghq.eu')) monitoring.push('Datadog');
  if (lower.includes('rollbar.com') || lower.includes('rollbar.min')) monitoring.push('Rollbar');
  if (lower.includes('logrocket.com')) monitoring.push('LogRocket');
  if (lower.includes('raygun.io') || lower.includes('raygun.js')) monitoring.push('Raygun');
  if (lower.includes('trackjs.com')) monitoring.push('TrackJS');
  if (lower.includes('honeybadger.io')) monitoring.push('Honeybadger');

  // ── Compliance ────────────────────────────────────────────────────────────
  let cookie_consent: string | null = null;
  if (lower.includes('onetrust')) cookie_consent = 'OneTrust';
  else if (lower.includes('cookiebot') || (lower.includes('cookieconsent') && !lower.includes('crisp'))) cookie_consent = 'CookieBot';
  else if (lower.includes('termly.io')) cookie_consent = 'Termly';
  else if (lower.includes('osano.com')) cookie_consent = 'Osano';
  else if (lower.includes('usercentrics')) cookie_consent = 'Usercentrics';
  else if (lower.includes('cookiefirst')) cookie_consent = 'CookieFirst';
  else if (lower.includes('axeptio')) cookie_consent = 'Axeptio';
  else if (lower.includes('didomi')) cookie_consent = 'Didomi';
  else if (lower.includes('quantcast') && lower.includes('consent')) cookie_consent = 'Quantcast Choice';
  else if (lower.includes('iubenda.com')) cookie_consent = 'iubenda';
  else if (lower.includes('trustarc.com') || lower.includes('truste.com')) cookie_consent = 'TrustArc';
  else if (lower.includes('cookieinformation.com')) cookie_consent = 'Cookie Information';

  return {
    web_server, cdn, paas, backend_language,
    cms, ecommerce,
    frameworks, js_libraries, css_framework,
    analytics, tag_manager, heatmaps, ab_testing,
    chat, forms, video, maps,
    payments, email_marketing, monitoring,
    cookie_consent,
    versions,
  };
}

function detectSecurityHeaders(headers: Headers): SecurityHeaders {
  const hsts = headers.has('strict-transport-security');
  const xframe = headers.has('x-frame-options');
  const xcontent = (headers.get('x-content-type-options') ?? '').toLowerCase().includes('nosniff');
  const csp = headers.has('content-security-policy');
  const referrer = headers.has('referrer-policy');
  const permissions = headers.has('permissions-policy') || headers.has('feature-policy');
  const count = [hsts, xframe, xcontent, csp, referrer, permissions].filter(Boolean).length;
  return { hsts, xframe, xcontent, csp, referrer, permissions, score: Math.round((count / 6) * 100) };
}

function extractTagText(html: string, tag: string): string[] {
  const results: string[] = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    if (text) results.push(text.slice(0, 300));
    if (results.length >= 12) break;
  }
  return results;
}

function auditImages(html: string): ImageAudit {
  const imgRe = /<img(\s[^>]*)?\/?>/gi;
  let m, total = 0, missing_alt = 0, modern_count = 0;
  const missing_alt_srcs: string[] = [];
  while ((m = imgRe.exec(html)) !== null) {
    total++;
    const attrs = m[1] ?? '';
    const altMatch = /\balt\s*=\s*["']([^"']*)["']/i.exec(attrs);
    // Only flag images with NO alt attribute at all.
    // alt="" is valid WCAG for decorative images — do not count as missing.
    if (!altMatch) {
      missing_alt++;
      if (missing_alt_srcs.length < 20) {
        const src = (/\bsrc\s*=\s*["']([^"']{1,120})["']/i.exec(attrs) ?? [])[1] ?? '';
        if (src) missing_alt_srcs.push(src);
      }
    }
    const src = (/\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs) ?? [])[1] ?? '';
    if (/\.(webp|avif)(\?|$)/i.test(src)) modern_count++;
  }
  return { total, missing_alt, missing_alt_srcs, modern_count };
}

function countUnsafeCrossOriginLinks(html: string): number {
  const re = /<a\s([^>]*)>/gi;
  let count = 0, m;
  while ((m = re.exec(html)) !== null) {
    const a = m[1];
    if (/\btarget\s*=\s*["']_blank["']/i.test(a)) {
      const rel = (/\brel\s*=\s*["']([^"']*)["']/i.exec(a) ?? [])[1] ?? '';
      if (!rel.includes('noopener') && !rel.includes('noreferrer')) count++;
    }
  }
  return count;
}

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','is','are',
  'was','were','be','been','have','has','had','do','does','did','will','would','could','should',
  'may','might','this','that','these','those','it','its','not','no','as','if','so','we','our',
  'your','their','they','he','she','his','her','you','my','me','us','them','who','which',
  'what','how','all','more','also','when','where','about','get','just','than','then','into',
  'any','each','both','other','some','such','only','new','up','out','go','use','there','here',
  'see','like','one','two','three','can','www','http','https','com','html','css','true',
  'false','null','undefined','class','style','data','type','name','content','href','src',
  'error','code','page','site','click','next','back','skip','load','loading','cookie',
  'cookies','accept','close','search','menu','home','read','more','view','show','hide',
  // Bot/CAPTCHA challenge page words — prevent garbage keywords from blocked pages
  'javascript','disabled','enable','disable','robot','verify','reload','requires','continue',
  'blocked','challenge','captcha','human','security','cloudflare','checking','browser',
  'access','please','order','allows','attention','moment','perform','trigger','solution',
  'online','attacks','action','performed','several','including','submitting','command',
  'malformed','reference','prevent','future','completing','solving','proves','completed',
  // Foreign language name fragments from multilingual portals (e.g. wikipedia.org)
  'basa','bahasa','bahaso','fran','espa','catal','tina','portugu','sloven','norsk',
  'nynorsk','bokm','deutsch','italiano','polski','srpski','srpskohrvatski','suomi',
  'svenska','dansk','cymraeg','esperanto','euskara','galego','malagasy','melayu',
  'latina','ladin','shqip','tatar','winaray','kiswahili','sesotho','qazaq','zbekcha',
  'rbaycanca','sinugboanong','binisaya','minangkabau','asturianu','afrikaans',
  'eesti','lietuvi','latvie','magyar','indonesia','karai','simple',
]);

function extractTopKeywords(html: string): Array<{ word: string; count: number }> {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]{2,8};/gi, ' ')   // strip named HTML entities: &rsquo; &ndash; &amp; etc.
    .replace(/&#\d+;/gi, ' ')         // strip numeric HTML entities: &#8217; &#160; etc.
    .replace(/[^a-zA-Z\s]/g, ' ')
    .toLowerCase();
  const counts: Record<string, number> = {};
  for (const word of text.split(/\s+/)) {
    // Min length 5 filters truncated Unicode fragments (e.g. "fran" from Français, "espa" from Español)
    if (word.length >= 5 && !STOP_WORDS.has(word)) {
      counts[word] = (counts[word] ?? 0) + 1;
    }
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  // Prefer words appearing 2+ times; if fewer than 15 such words, include singles too
  const frequent = sorted.filter(([, n]) => n >= 2);
  const list = frequent.length >= 15 ? frequent : sorted;
  return list.slice(0, 60).map(([word, count]) => ({ word, count }));
}


export async function runTechnicalSeo(
  domain: string,
  sharedHtml: string,
  sharedHeaders: Headers,
  sharedResponseMs: number,
  sharedFinalUrl?: string,
  options: TechnicalSeoOptions = {},
): Promise<TechnicalSeoResult> {
  const fetcher = options.fetcher ?? fetchWithTimeout;
  const transportEvidenceAvailable = options.transportEvidenceAvailable !== false;
  // Use the pre-resolved final URL (from audit.ts pre-fetch) as the base for file fetches.
  // This avoids redirect-following subrequests: CF Workers counts every redirect hop as a
  // separate subrequest, so fetching https://hubspot.com/robots.txt → redirect to
  // https://www.hubspot.com/robots.txt burns 2 subrequests instead of 1.
  // By using the already-resolved canonical origin we always fetch directly.
  let canonicalOrigin: string;
  try {
    canonicalOrigin = sharedFinalUrl ? new URL(sharedFinalUrl).origin : `https://${domain}`;
  } catch {
    canonicalOrigin = `https://${domain}`;
  }
  const baseUrl = canonicalOrigin;

  const checks: Check[] = [];
  const issues: string[] = [];
  let blocked_ai_bots: string[] = [];
  let crawler_policy_v2 = buildCrawlerPolicyV2('', 'error');
  let llms_txt_present = false;
  let llms_txt_status: TechnicalSeoResult['llms_txt_status'] = 'error';
  let sitemap_url_count = 0;
  const response_time_ms = sharedResponseMs;

  // HTTP→HTTPS check: free derivation from the shared final URL — no extra subrequest needed.
  // The pre-fetch already followed all redirects; if the final URL is HTTPS, the redirect works.
  const redirectsToHttps = (sharedFinalUrl ?? '').startsWith('https://');
  checks.push({ name: 'HTTP redirects to HTTPS', passed: redirectsToHttps });
  if (!redirectsToHttps) issues.push('HTTP does not redirect to HTTPS — mixed-content risk');

  // HTTP/3 detection — read Alt-Svc from shared headers (free — no extra fetch)
  const altSvc = sharedHeaders.get('alt-svc') ?? '';
  const http3Supported = altSvc.includes('h3=');

  const [robotsProbe, sitemapProbe, llmsProbe, adsProbe] = await Promise.all([
    probeText(fetcher, `${baseUrl}/robots.txt`, 8000),
    probeText(fetcher, `${baseUrl}/sitemap.xml`, 8000),
    probeText(fetcher, `${baseUrl}/llms.txt`, 5000),
    options.includeAdsTxt === false
      ? Promise.resolve<TextProbe>({ status: 'missing', text: '' })
      : probeText(fetcher, `${baseUrl}/ads.txt`, 5000),
  ]);

  const httpsEnabled = (sharedFinalUrl ?? '').startsWith('https://');
  checks.push({ name: 'HTTPS enabled', passed: httpsEnabled, detail: httpsEnabled ? 'Domain resolves over HTTPS' : 'Domain is not serving over HTTPS' });

  if (transportEvidenceAvailable) {
    const ttfbOk = response_time_ms < 2000;
    checks.push({ name: 'Response time < 2s', passed: ttfbOk, detail: `${response_time_ms}ms` });
    if (!ttfbOk) issues.push(`Slow TTFB: ${response_time_ms}ms`);
  }

  // Robots.txt
  const robotsContent = robotsProbe.text;
  crawler_policy_v2 = buildCrawlerPolicyV2(robotsContent, robotsProbe.status);
  blocked_ai_bots = [
    ...crawler_policy_v2.search_index.blocked,
    ...crawler_policy_v2.training.blocked,
    ...crawler_policy_v2.user_fetch.blocked,
  ];
  checks.push({ name: 'Robots.txt present', passed: robotsContent.length > 0 });
  checks.push({
    name: 'Search and index crawlers not blocked',
    passed: crawler_policy_v2.search_index.blocked.length === 0,
    detail: crawler_policy_v2.search_index.blocked.length > 0
      ? `Blocking: ${crawler_policy_v2.search_index.blocked.join(', ')}`
      : undefined,
  });
  if (crawler_policy_v2.search_index.blocked.length > 0) {
    issues.push(`Blocking search/index crawlers: ${crawler_policy_v2.search_index.blocked.join(', ')}`);
  }

  // llms.txt
  llms_txt_status = llmsProbe.status;
  llms_txt_present = llmsProbe.status === 'complete' && llmsProbe.text.length > 10;
  checks.push({ name: 'llms.txt present', passed: llms_txt_present });
  if (!llms_txt_present && llmsProbe.status !== 'error') issues.push('No llms.txt — AI engines cannot discover content index');

  // Sitemap — handle both direct sitemaps (<url>) and sitemap indexes (<sitemap>)
  let sitemapContent = sitemapProbe.text;
  let directUrls   = (sitemapContent.match(/<url>/g)     ?? []).length;
  let indexEntries = (sitemapContent.match(/<sitemap>/g) ?? []).length;
  sitemap_url_count = directUrls > 0 ? directUrls : indexEntries;

  // Fallback: if /sitemap.xml not found, check robots.txt Sitemap: directive
  if (sitemap_url_count === 0 && robotsContent) {
    const altSitemapUrl = (robotsContent.match(/^Sitemap:\s*(\S+)/im) ?? [])[1]?.trim();
    if (altSitemapUrl) {
      try {
        const altProbe = await probeText(fetcher, altSitemapUrl, 8000);
        const altContent = altProbe.text;
        directUrls   = (altContent.match(/<url>/g)     ?? []).length;
        indexEntries = (altContent.match(/<sitemap>/g) ?? []).length;
        sitemap_url_count = directUrls > 0 ? directUrls : indexEntries;
        if (sitemap_url_count > 0) sitemapContent = altContent;
      } catch { /* ignore — sitemap URL in robots.txt may be unreachable */ }
    }
  }

  // Sitemap index: each <sitemap> entry represents a sub-sitemap with many URLs
  const sitemapDetail = directUrls > 0 ? `${directUrls} URLs`
    : indexEntries > 0 ? `sitemap index (${indexEntries} sub-sitemaps)` : '0 URLs';
  checks.push({ name: 'Sitemap present', passed: sitemap_url_count > 0, detail: sitemapDetail });
  if (sitemap_url_count === 0 && sitemapProbe.status !== 'error') issues.push('No sitemap.xml found');

  const robots_summary = parseRobotsSummary(robotsContent);

  // Defaults
  let tech_stack: TechStack = { web_server: null, cdn: null, paas: null, backend_language: null, cms: null, ecommerce: null, frameworks: [], js_libraries: [], css_framework: null, analytics: [], tag_manager: [], heatmaps: [], ab_testing: [], chat: null, forms: [], video: [], maps: [], payments: [], email_marketing: [], monitoring: [], cookie_consent: null, versions: {} };
  let security_headers: SecurityHeaders = { hsts: false, xframe: false, xcontent: false, csp: false, referrer: false, permissions: false, score: 0 };
  let page_meta: PageMeta = { title: null, description: null, og_title: null, og_description: null, og_image: null, og_type: null, og_site_name: null, canonical_url: null, twitter_card: null, twitter_title: null, twitter_description: null, twitter_image: null, favicon: null, lang: null, article_published_time: null, article_modified_time: null, article_author: null };
  let page_weight_kb = 0;
  let render_blocking_scripts = 0;
  let h1_tags: string[] = [];
  let h2_tags: string[] = [];
  let dom_element_count = 0;
  let compression: CompressionInfo = { enabled: false, encoding: null, raw_kb: 0, compressed_kb: null, savings_pct: null };
  let image_audit: ImageAudit = { total: 0, missing_alt: 0, missing_alt_srcs: [], modern_count: 0 };
  let has_media_queries = false;
  let unsafe_cross_origin_links = 0;
  let plaintext_emails = 0;
  let deprecated_tags: string[] = [];
  let top_keywords: Array<{ word: string; count: number }> = [];
  let rss_feed_url: string | null = null;
  let pwa: TechnicalSeoResult['pwa'] = null;
  let ai_training_optout = false;

  if (sharedHtml) {
    const html = sharedHtml;

    security_headers = detectSecurityHeaders(sharedHeaders);
    // Security header details are reported by the dedicated security_audit module — no duplicate here.

    // Always use decompressed html.length for raw KB —
    // content-length is the compressed wire size (used below for compression savings).
    page_weight_kb = Math.round(html.length / 1024);
    tech_stack = detectTechStack(html, sharedHeaders);

    // Extract page meta for SERP / Social previews.
    page_meta = extractPageMeta(html);

    // Only scripts in <head> can block initial HTML parsing. Body scripts are
    // intentionally excluded even when they omit async/defer.
    const headHtml = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '';
    const scriptTagRegex = /<script\s([^>]*)>/gi;
    let sm;
    while ((sm = scriptTagRegex.exec(headHtml)) !== null) {
      const attrs = sm[1];
      if (/\bsrc\s*=/i.test(attrs) && !/\basync\b/i.test(attrs) && !/\bdefer\b/i.test(attrs) && !/\btype\s*=\s*["']module["']/i.test(attrs)) {
        render_blocking_scripts++;
      }
    }
    if (render_blocking_scripts > 0) {
      issues.push(`${render_blocking_scripts} render-blocking script${render_blocking_scripts > 1 ? 's' : ''} found — add async or defer to improve page load`);
    }
    checks.push({ name: 'No render-blocking scripts', passed: render_blocking_scripts === 0, detail: render_blocking_scripts > 0 ? `${render_blocking_scripts} blocking script${render_blocking_scripts > 1 ? 's' : ''}` : 'All scripts are async/deferred' });

    const hasNoindex = /<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
    checks.push({ name: 'No noindex directive', passed: !hasNoindex });
    if (hasNoindex) issues.push('CRITICAL: noindex meta tag found — page excluded from all search engines');

    checks.push({ name: 'HTML lang attribute', passed: !!page_meta.lang, detail: page_meta.lang ?? undefined });
    if (!page_meta.lang) issues.push('Missing lang attribute on <html>');

    const title = page_meta.title ?? '';
    const titleRange = textLengthRange(title, page_meta.lang ?? undefined);
    const isRootHomepage = (() => {
      try { return new URL(sharedFinalUrl ?? '').pathname.replace(/\/+$/, '') === ''; } catch { return false; }
    })();
    const brandOnlyHomepage = isRootHomepage && isBrandOnlyHomepageTitle(title, domain);
    const titleOk = brandOnlyHomepage || isTextLengthGood(title, page_meta.lang ?? undefined);
    const titleDetail = brandOnlyHomepage
      ? `"${title.slice(0, 60)}" (${title.length} chars; root-domain brand homepage, generic length target not applied)`
      : `"${title.slice(0, 60)}" (${title.length} chars; target ${titleRange.label})`;
    checks.push({ name: `Title tag length (${titleRange.label} chars)`, passed: titleOk, detail: titleDetail });
    if (!titleOk) issues.push(`Title tag length: ${title.length} chars (target ${titleRange.label})`);

    const desc = page_meta.description ?? '';
    const descRange = descriptionLengthRange(desc, page_meta.lang ?? undefined);
    const descOk = isDescriptionLengthGood(desc, page_meta.lang ?? undefined);
    checks.push({ name: `Meta description length (${descRange.label} chars)`, passed: descOk, detail: `${desc.length} chars; target ${descRange.label}` });
    if (!descOk) issues.push(`Meta description: ${desc.length} chars (target ${descRange.label})`);
    // Flag when title and description are identical — they serve different purposes and Google
    // may rewrite the snippet if they match, weakening click-through rate.
    if (title && desc && title.trim().toLowerCase() === desc.trim().toLowerCase()) {
      issues.push('Title tag and meta description are identical — they should be distinct; use the title for the page topic and the description as a persuasive summary');
    }

    const hasViewport = /<meta[^>]*name=["']viewport["']/i.test(html);
    checks.push({ name: 'Mobile viewport meta', passed: hasViewport });
    if (!hasViewport) issues.push('Missing mobile viewport meta tag');

    const hasCanonical = /<link[^>]*rel=["']canonical["']/i.test(html);
    checks.push({ name: 'Canonical link present', passed: hasCanonical });
    if (!hasCanonical) issues.push('No canonical URL — duplicate content risk');

    // OG completeness: all 4 core tags required for proper social sharing + AI citation
    const ogTags = { 'og:title': !!page_meta.og_title, 'og:description': !!page_meta.og_description, 'og:image': !!page_meta.og_image, 'og:type': !!page_meta.og_type };
    const ogMissing = Object.entries(ogTags).filter(([, v]) => !v).map(([k]) => k);
    checks.push({ name: 'Open Graph tags complete', passed: ogMissing.length === 0, detail: ogMissing.length ? `Missing: ${ogMissing.join(', ')}` : 'All core tags present' });
    if (ogMissing.length > 0) issues.push(`Missing OG tags: ${ogMissing.join(', ')} — affects social sharing and machine-readable page context`);
    else if (!page_meta.og_site_name) issues.push('og:site_name not set — social platforms may show full URL instead of brand name');

    // Strip scripts/styles first — prevents false H1 matches from styled-components/emotion SSR
    // injection artifacts (e.g. a <h1> element whose text content is ".css-1qggkls{outline:none;}")
    const htmlNoScriptStyle = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '');
    const h1count = (htmlNoScriptStyle.match(/<h1[^>]*>/gi) ?? []).length;
    checks.push({ name: 'Single H1 tag', passed: h1count === 1, detail: `${h1count} H1 tags found` });
    if (h1count !== 1) issues.push(`${h1count} H1 tags (should be exactly 1)`);

    const hasHreflang = /<link[^>]+rel=["']alternate["'][^>]+hreflang/i.test(html);
    checks.push({ name: 'hreflang for multilingual', passed: hasHreflang });
    if (!hasHreflang) issues.push('No hreflang tags — multilingual targeting not signalled');

    // ── New enrichment fields ─────────────────────────────────────────────────
    h1_tags = extractTagText(htmlNoScriptStyle, 'h1');
    h2_tags = extractTagText(htmlNoScriptStyle, 'h2');

    const htmlForDomCount = htmlNoScriptStyle
      .replace(/<svg[\s\S]*?<\/svg>/gi, '<svg/>'); // collapse SVGs to single tag
    dom_element_count = (htmlForDomCount.match(/<[a-z][a-z0-9-]*[\s>\/]/gi) ?? []).length;
    checks.push({ name: 'DOM size ≤ 1500 nodes', passed: dom_element_count <= 1500, detail: `${dom_element_count.toLocaleString()} elements` });
    if (dom_element_count > 1500) issues.push(`DOM too large: ${dom_element_count.toLocaleString()} elements (target ≤ 1,500)`);

    const enc = sharedHeaders.get('content-encoding') ?? null;
    const clHeader = sharedHeaders.get('content-length');
    const cmpRaw = page_weight_kb;
    const cmpCompressed = clHeader ? Math.round(parseInt(clHeader, 10) / 1024) : null;
    const cmpSavings = (cmpCompressed !== null && cmpRaw > 0 && cmpCompressed < cmpRaw)
      ? Math.round((1 - cmpCompressed / cmpRaw) * 100) : null;
    const isEncoded = !!(enc && /gzip|br|zstd/.test(enc));
    // Major CDNs (Cloudflare, CloudFront, Fastly, Akamai, Vercel, Netlify, BunnyCDN) compress
    // responses for real browsers but NOT for server-side fetches that omit Accept-Encoding.
    // Our Worker fetch has no Accept-Encoding, so we never see Content-Encoding from CDN edges.
    // Treat CDN-fronted sites as having compression handled at the edge rather than flagging them.
    const CDN_COMPRESSORS = new Set(['Cloudflare', 'Amazon CloudFront', 'Fastly', 'Akamai', 'Vercel Edge Network', 'Netlify Edge', 'BunnyCDN']);
    const cdnManaged = !isEncoded && CDN_COMPRESSORS.has(tech_stack.cdn ?? '');
    const varySupports = !isEncoded && !cdnManaged && (sharedHeaders.get('vary') ?? '').toLowerCase().includes('accept-encoding');
    const compressionOk = isEncoded || cdnManaged || varySupports;
    const compressionEncoding = isEncoded ? enc : (compressionOk ? 'CDN-managed' : null);
    compression = { enabled: compressionOk, encoding: compressionEncoding, raw_kb: cmpRaw, compressed_kb: cmpCompressed, savings_pct: cmpSavings };
    const compressionDetail = isEncoded ? `${enc} — ${cmpSavings ?? '?'}% savings`
      : cdnManaged ? `CDN-managed (${tech_stack.cdn} compresses at edge)`
      : varySupports ? 'Vary: Accept-Encoding present — server supports compression'
      : 'No compression detected';
    checks.push({ name: 'HTML compression (GZIP/Brotli)', passed: compressionOk, detail: compressionDetail });
    if (!compressionOk) issues.push('No HTML compression — enable GZIP or Brotli to reduce transfer size');

    checks.push({ name: 'HTTP/3 supported', passed: http3Supported, detail: http3Supported ? `Alt-Svc: ${altSvc.slice(0, 80)}` : 'No Alt-Svc header advertising h3' });

    const pageWeightOk = page_weight_kb <= 500;
    checks.push({ name: 'Page Weight', passed: pageWeightOk, detail: pageWeightOk ? `HTML: ${page_weight_kb} KB — document only, not including JS/CSS/images` : `HTML: ${page_weight_kb} KB — large document size` });
    if (!pageWeightOk) issues.push(`HTML document is ${page_weight_kb} KB — large document size (excludes JS/CSS/images)`);

    image_audit = auditImages(html);
    checks.push({ name: 'Image alt attributes', passed: image_audit.missing_alt === 0, detail: `${image_audit.total - image_audit.missing_alt}/${image_audit.total} images have alt text` });
    // Alt text issues are reported by accessibility module (WCAG 1.1.1) — no duplicate here.

    // Detect media queries in inline <style> blocks; also accept viewport meta as proxy
    // (modern sites load CSS externally so @media won't appear in raw HTML)
    const hasInlineMedia = /@media\s*[(\s]/i.test(html);
    const hasViewportMeta = /<meta[^>]+name=["']viewport["']/i.test(html);
    has_media_queries = hasInlineMedia || hasViewportMeta;
    checks.push({ name: 'CSS media queries (responsive)', passed: has_media_queries,
      detail: has_media_queries ? (hasInlineMedia ? 'Inline @media rules found' : 'Viewport meta present (external CSS)') : undefined });
    if (!has_media_queries) issues.push('No CSS media queries detected — responsive design may be absent');

    unsafe_cross_origin_links = countUnsafeCrossOriginLinks(html);
    checks.push({ name: 'Safe cross-origin links', passed: unsafe_cross_origin_links === 0, detail: unsafe_cross_origin_links > 0 ? `${unsafe_cross_origin_links} target="_blank" missing rel="noopener"` : 'All safe' });
    if (unsafe_cross_origin_links > 0) issues.push(`${unsafe_cross_origin_links} unsafe cross-origin link${unsafe_cross_origin_links > 1 ? 's' : ''} — add rel="noopener noreferrer"`);

    plaintext_emails = (html.match(/href=["']mailto:/gi) ?? []).length;

    const DEPR = ['font', 'center', 'marquee', 'blink', 'strike', 'basefont', 'big', 'tt'];
    deprecated_tags = DEPR.filter(t => new RegExp(`<${t}[\\s>/]`, 'i').test(html));
    checks.push({ name: 'No deprecated HTML tags', passed: deprecated_tags.length === 0, detail: deprecated_tags.length > 0 ? deprecated_tags.join(', ') : undefined });
    if (deprecated_tags.length > 0) issues.push(`Deprecated HTML tags: <${deprecated_tags.join('>, <')}>`);

    top_keywords = extractTopKeywords(html);

    // ── RSS / Atom feed detection ─────────────────────────────────────────────
    const htmlFeedHref = html.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]+href=["']([^"']+)["']/i)?.[1]?.trim()
      ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+type=["']application\/(?:rss|atom)\+xml["']/i)?.[1]?.trim()
      ?? null;

    // ── PWA manifest detection ────────────────────────────────────────────────
    const manifestHref = html.match(/<link[^>]+rel=["']manifest["'][^>]+href=["']([^"']+)["']/i)?.[1]?.trim()
      ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']manifest["']/i)?.[1]?.trim()
      ?? null;

    // ── AI training opt-out detection ─────────────────────────────────────────
    const robotsMetaContent = html.match(/<meta[^>]+name=["']robots["'][^>]*content=["']([^"']+)["']/gi) ?? [];
    const robotsContentStr = robotsMetaContent.join(' ').toLowerCase();
    const hasNoai = robotsContentStr.includes('noai') || robotsContentStr.includes('noimageai');
    const hasCCBot = /<meta[^>]+name=["']CCBot["']/i.test(html);
    const hasGPTBot = /<meta[^>]+name=["']GPTBot["']/i.test(html);
    const hasAnthropicAi = /<meta[^>]+name=["']anthropic-ai["']/i.test(html);
    ai_training_optout = hasNoai || hasCCBot || hasGPTBot || hasAnthropicAi || crawler_policy_v2.training_opt_out;

    // RSS: use HTML-declared feed link only — probe fetches removed to save subrequests.
    rss_feed_url = htmlFeedHref;
    // PWA: confirm manifest presence from HTML link tag; skip manifest fetch to save subrequest.
    // display/icons/name stay null — "has_manifest: true" is the actionable signal.
    pwa = manifestHref ? { has_manifest: true, display: null, has_icons: false, name: null } : null;

    checks.push({ name: 'RSS / Atom feed', passed: !!rss_feed_url, detail: rss_feed_url ? `Feed found: ${rss_feed_url}` : 'No RSS or Atom feed detected — content publishing not discoverable by feed readers or AI crawlers' });
    checks.push({ name: 'PWA manifest', passed: !!pwa?.has_manifest, detail: pwa?.has_manifest ? `display: ${pwa.display ?? 'not set'}, icons: ${pwa.has_icons ? 'yes' : 'none'}` : 'No web app manifest — site cannot be installed as a PWA' });
  }

  const ads_txt = adsProbe.status === 'complete' && adsProbe.text.trim().length > 0;

  const passed = checks.filter((c) => c.passed).length;
  const score = Math.round((passed / checks.length) * 100);

  return {
    checks, score, issues,
    blocked_ai_bots, crawler_policy_v2, llms_txt_present, llms_txt_status, sitemap_url_count,
    response_time_ms, transport_evidence_available: transportEvidenceAvailable, tech_stack, security_headers, page_meta,
    robots_summary, page_weight_kb, render_blocking_scripts,
    h1_tags, h2_tags, dom_element_count, compression,
    image_audit, has_media_queries, ads_txt,
    unsafe_cross_origin_links, plaintext_emails, deprecated_tags, top_keywords,
    http3_supported: http3Supported,
    rss_feed_url,
    pwa,
    ai_training_optout,
  };
}
