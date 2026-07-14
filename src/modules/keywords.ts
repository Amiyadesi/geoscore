import type { Env } from '../lib/types';
import { callLlm } from '../lib/llm';
import { extractJsonObject } from '../lib/json';
import { buildSearchEvidence } from '../lib/search-gateway';
import { detectVertical, detectLocation, guessVerticalFromDomain, detectVerticalFromSchema } from './geo_predicted';
import { isBotChallengePage } from '../lib/bot-detection';

export interface KeywordResult {
  keywords: KeywordItem[];
  seed_queries: string[];
  vertical: string;
  location: string;
  /** false when AI seed generation failed and bigram extraction was used as fallback */
  is_reliable: boolean;
}

export interface KeywordItem {
  keyword: string;
  intent: 'transactional' | 'commercial' | 'informational' | 'local';
  geo_potential: boolean; // likely to trigger an AI answer
}

export interface KeywordRunOptions {
  llmTimeoutMs?: number;
  searchTimeoutMs?: number;
}

const DEFAULT_LLM_TIMEOUT_MS = 5500;
const DEFAULT_SEARCH_TIMEOUT_MS = 2200;

const INTENT_RULES: Array<[RegExp, KeywordItem['intent']]> = [
  [/\b(buy|price|cost|cheap|deal|discount|order|book|hire|get|near me)\b/i, 'transactional'],
  [/\b(best|top|vs|compare|review|alternative|recommend)\b/i, 'commercial'],
  [/\b(how|what|why|when|which|is|are|can|does|guide|tips|explained)\b/i, 'informational'],
  [/\b(near me|in \w+|local|\d{4,5}|open now|open today)\b/i, 'local'],
];

function classifyIntent(kw: string): KeywordItem['intent'] {
  for (const [re, intent] of INTENT_RULES) {
    if (re.test(kw)) return intent;
  }
  return 'commercial';
}

function hasGeoPotential(kw: string): boolean {
  return /\b(best|top|how|what|which|why|guide|tips|review|compare|vs|recommend|alternative)\b/i.test(kw);
}

// Google suggestqueries removed — saved 8 subrequests per audit.
// AI-generated keywords (via Groq/CF AI) provide equivalent coverage with zero extra fetches.

export async function runKeywords(
  domain: string,
  env: Env,
  sharedHtml: string,
  verticalOverride?: string | null,
  locationOverride?: string | null,
  options: KeywordRunOptions = {},
): Promise<KeywordResult> {
  // Build pageContent from shared html — no additional fetch needed
  let pageContent = '';
  let metaSignals = '';
  if (sharedHtml) {
    const title  = (sharedHtml.match(/<title[^>]*>([^<]+)<\/title>/i) ?? [])[1] ?? '';
    const desc   = (sharedHtml.match(/name=["']description["'][^>]*content=["']([^"']+)["']/i) ??
                    sharedHtml.match(/content=["']([^"']+)["'][^>]*name=["']description["']/i) ?? [])[1] ?? '';
    const ogDesc = (sharedHtml.match(/property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ?? [])[1] ?? '';
    metaSignals  = `${title} ${desc} ${ogDesc}`.trim();
    // Strip script/style block content before tokenising — avoids JS/CSS tokens
    // (e.g. CAPTCHA challenge pages are mostly JS and would produce garbage seeds)
    const cleanedHtml = sharedHtml
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ');
    const body   = cleanedHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 4000);
    pageContent  = `${metaSignals} ${body}`.slice(0, 5000);
  } else {
    pageContent = domain;
    metaSignals = domain;
  }

  // ── Bot-challenge detection ─────────────────────────────────────────────────
  // Check BEFORE vertical detection or any AI call.
  // Sites like Canva serve "Unsupported client" or Cloudflare challenge pages to
  // non-browser UAs. Sending that garbage to the LLM produces nonsense keywords.
  // If blocked, fall back to domain-only signal (clean but sparse — AI will infer
  // from domain name; bigram fallback will use vertical templates).
  if (isBotChallengePage(pageContent)) {
    pageContent = `Business at ${domain}`;
    metaSignals = domain;
  }

  // Schema @type takes priority: it's the site owner's explicit declaration of business type.
  let vertical = verticalOverride ?? detectVerticalFromSchema(sharedHtml) ?? detectVertical(pageContent);
  // When the regex can't classify (returns 'general') — e.g. bot-blocked sites where
  // pageContent = "Business at domain.com" — try domain-name guessing as a fallback.
  // This ensures bayut.com → real_estate, airbnb.com → hotel, etc. so that seed queries
  // and keyword templates are at least topically relevant.
  if (vertical === 'general') {
    const domainGuess = guessVerticalFromDomain(domain);
    if (domainGuess) vertical = domainGuess;
  }
  // Location is only meaningful for local-service verticals.
  // Global SaaS/tech/finance/ecommerce sites mention cities in blog posts and testimonials,
  // so detectLocation produces false positives (e.g. "London" for moz.com).
  const LOCAL_VERTICALS = new Set(['dental','legal','fitness','real_estate','hotel','restaurant','food_delivery','medical','home_services']);
  const location = locationOverride ?? (LOCAL_VERTICALS.has(vertical) ? detectLocation(pageContent) : 'your area');
  const locationStr = location === 'your area' ? '' : location;

  // AI-powered: get context-aware seeds + keyword suggestions in ONE LLM call.
  // Seeds reflect what the site actually does → far better autocomplete results than bigrams.
  const aiInsights = await generateAiKeywordInsights(
    domain,
    vertical,
    locationStr,
    pageContent,
    env,
    options.llmTimeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
  );
  const aiSeedsAvailable = aiInsights.seeds.length >= 2;

  // Use AI seeds when valid; fall back to bigram extraction for bot-blocked/sparse pages
  let seeds = aiSeedsAvailable
    ? aiInsights.seeds
    : buildContentSeeds(pageContent, vertical, locationStr, domain);

  // Halal food delivery — override seeds with domain-specific queries
  if (vertical === 'food_delivery' && /\bhalal\b/i.test(pageContent)) {
    const loc = locationStr || 'near me';
    seeds = [
      `halal food delivery ${loc}`,
      `halal meat delivery ${loc}`,
      `best halal delivery service ${loc}`,
    ];
  }

  // Build raw keyword set from AI seeds — no external autocomplete fetches needed
  const raw = new Set<string>();
  seeds.forEach(s => raw.add(s.toLowerCase().trim()));

  const searchEvidence = await buildSearchEvidence(env, seeds, 1400, {
    timeoutMs: options.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS,
  });
  const searchKeywords = extractKeywordsFromSearchEvidence(searchEvidence);

  // Classify each keyword
  const keywords: KeywordItem[] = Array.from(raw)
    .filter(kw => kw.length > 3 && kw.split(' ').length >= 2)
    .map(kw => ({
      keyword: kw,
      intent: classifyIntent(kw),
      geo_potential: hasGeoPotential(kw),
    }));

  // Add AI-generated keywords from the combined insights call (no extra subrequest needed)
  aiInsights.keywords.forEach(kw => {
    if (!keywords.find(k => k.keyword === kw.toLowerCase())) {
      keywords.push({
        keyword: kw.toLowerCase(),
        intent: classifyIntent(kw),
        geo_potential: hasGeoPotential(kw),
      });
    }
  });

  searchKeywords.forEach(kw => {
    const normalized = kw.toLowerCase();
    if (!keywords.find(k => k.keyword === normalized)) {
      keywords.push({
        keyword: normalized,
        intent: classifyIntent(normalized),
        geo_potential: hasGeoPotential(normalized),
      });
    }
  });

  // Sort: geo_potential first, then by intent priority
  const intentOrder: Record<KeywordItem['intent'], number> = {
    transactional: 0, commercial: 1, local: 2, informational: 3,
  };
  keywords.sort((a, b) => {
    if (a.geo_potential !== b.geo_potential) return a.geo_potential ? -1 : 1;
    return intentOrder[a.intent] - intentOrder[b.intent];
  });

  return {
    keywords: keywords.slice(0, 30),
    seed_queries: seeds,
    vertical,
    location,
    // Reliable only when: (a) AI generated seeds AND (b) we had real page HTML to work from.
    // Domain-name-only inference (sharedHtml empty) produces hallucinated topics — suppress it.
    is_reliable: aiSeedsAvailable && !!sharedHtml,
  };
}

// Stopwords for seed phrase extraction — filters UI/nav noise, keeps topic words
const SEED_STOP = new Set([
  'the','and','for','with','you','your','our','from','that','this','are','was','were',
  'have','has','had','been','not','all','but','can','will','get','use','new','more',
  'also','just','only','some','such','when','what','where','how','who','which',
  'find','book','sign','login','start','free','help','home','next','back','skip',
  'read','show','hide','view','open','close','save','send','click','accept','join',
  'about','info','page','site','web','apps','mobile','cookie','terms','privacy',
  'here','there','they','their','them','him','her','she','its','been','into',
  'over','than','then','even','back','most','many','each','both','other',
  'used','make','made','made','take','need','want','like','know','come','came',
  'time','year','work','good','great','shop','store','more','best','top','visit',
  // Bot/CAPTCHA challenge page words — prevent garbage seeds from blocked pages
  'please','enable','disable','javascript','cookies','browser','checking','access',
  'allow','block','loading','verify','captcha','human','robot','continue','before',
  'blocker','script','style','function','return','window','document','object',
  'const','typeof','undefined','false','null','true','https','http','www',
]);

// guessVerticalFromDomain is imported from geo_predicted (single source of truth)
// isBotChallengePage is imported from ../lib/bot-detection (single source of truth)

/**
 * Build seed queries from the page's actual content (title + meta).
 * Falls back to vertical templates if content is too sparse.
 */
function buildContentSeeds(metaText: string, vertical: string, location: string, domain = ''): string[] {
  const loc = location || '';
  const locSuffix = loc ? ` ${loc}` : '';

  // Detect bot/CAPTCHA challenge pages — bail out immediately to vertical templates
  if (isBotChallengePage(metaText)) {
    const guessed = guessVerticalFromDomain(domain) ?? vertical;
    return buildVerticalSeeds(guessed, loc);
  }

  // Normalise: lowercase, strip punctuation, tokenise
  const tokens = metaText
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !SEED_STOP.has(w));

  if (tokens.length < 3) {
    // Too little content — fall back to vertical templates (try domain hint first)
    const guessed = guessVerticalFromDomain(domain) ?? vertical;
    return buildVerticalSeeds(guessed, loc);
  }

  // Count single-word frequency
  const freq: Record<string, number> = {};
  for (const w of tokens) freq[w] = (freq[w] ?? 0) + 1;

  // Count bigram frequency across adjacent non-stop tokens
  const bigramFreq: Record<string, number> = {};
  for (let i = 0; i < tokens.length - 1; i++) {
    const b = `${tokens[i]} ${tokens[i + 1]}`;
    bigramFreq[b] = (bigramFreq[b] ?? 0) + 1;
  }

  // Top single words (must appear 2+ times, or just top words if sparse)
  const topWords = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w);

  // Top bigrams (must appear 2+ times; if none, take top 3 unique bigrams once)
  const repeatedBigrams = Object.entries(bigramFreq)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([b]) => b);

  const singleBigrams = Object.entries(bigramFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([b]) => b);

  const topBigrams = repeatedBigrams.length >= 2 ? repeatedBigrams : singleBigrams;

  // Build 3 seeds from content signals
  const seeds: string[] = [];

  // Seed 1: best [top bigram or word] [location]
  if (topBigrams.length >= 1) {
    seeds.push(`best ${topBigrams[0]}${locSuffix}`.trim());
  } else if (topWords.length >= 1) {
    seeds.push(`best ${topWords[0]}${locSuffix}`.trim());
  }

  // Seed 2: [top bigram 2] or [word1] [word2] [location]
  if (topBigrams.length >= 2 && topBigrams[1] !== topBigrams[0]) {
    seeds.push(`${topBigrams[1]}${locSuffix}`.trim());
  } else if (topWords.length >= 2) {
    seeds.push(`top ${topWords[0]} ${topWords[1]}`.trim());
  }

  // Seed 3: [word1] [word2] or location variant
  if (topWords.length >= 3) {
    const thirdSeed = loc
      ? `${topWords[0]} ${topWords[1]} ${loc}`.trim()
      : `${topWords[1]} ${topWords[2]}`.trim();
    if (!seeds.includes(thirdSeed)) seeds.push(thirdSeed);
  } else if (seeds.length < 3 && topBigrams.length >= 3) {
    seeds.push(`${topBigrams[2]}${locSuffix}`.trim());
  }

  // De-duplicate and fill gaps with vertical fallback
  const unique = [...new Set(seeds)].filter(Boolean).slice(0, 3);
  if (unique.length < 3) {
    const fallback = buildVerticalSeeds(vertical, loc);
    for (const f of fallback) {
      if (unique.length >= 3) break;
      if (!unique.includes(f)) unique.push(f);
    }
  }
  return unique;
}

function buildVerticalSeeds(vertical: string, location: string): string[] {
  const loc = location || 'near me';
  const templates: Record<string, string[]> = {
    dental:      [`best dentist ${loc}`, `dental clinic ${loc}`, `teeth whitening ${loc}`],
    hotel:       [`best hotel ${loc}`, `luxury hotel ${loc}`, `hotel deals ${loc}`],
    restaurant:  [`best restaurant ${loc}`, `top restaurants ${loc}`, `fine dining ${loc}`],
    fitness:     [`best gym ${loc}`, `personal trainer ${loc}`, `yoga classes ${loc}`],
    legal:       [`best lawyer ${loc}`, `law firm ${loc}`, `legal advice ${loc}`],
    real_estate: [`property for sale ${loc}`, `estate agent ${loc}`, `buy house ${loc}`],
    medical:     [`private clinic ${loc}`, `specialist doctor ${loc}`, `health centre ${loc}`],
    ecommerce:   [`buy online ${loc}`, `best online shop`, `fast delivery ${loc}`],
    finance:     [`best financial advisor ${loc}`, `ai trading platform review`, `investment app ${loc}`],
    tech:        [`best saas platform review`, `top software tools for business`, `ai platform ${loc}`],
    education:   [`best online learning platform`, `top language learning app`, `learn online free`],
    editorial:   [`independent blog and project notes`, `personal writing and technical notes`, `author website and article archive`],
    food_delivery:[`best food delivery service ${loc}`, `order food online ${loc}`, `fast food delivery ${loc}`],
    general:     [`best service ${loc}`, `top company ${loc}`, `professional services ${loc}`],
  };
  return templates[vertical] ?? templates.general;
}

interface AiKeywordInsights {
  seeds: string[];
  keywords: string[];
}

/**
 * Single AI call that returns both:
 *  - seeds: 3 context-aware search queries for THIS specific business
 *           (replaces garbage bigram extraction → better autocomplete results)
 *  - keywords: 8 high-intent SEO keywords for the keyword table
 *
 * pageContent snippet lets the LLM understand what the site actually does
 * rather than guessing from vertical/domain alone.
 */
async function generateAiKeywordInsights(
  domain: string,
  vertical: string,
  location: string,
  pageContent: string,
  env: Env,
  timeoutMs: number,
): Promise<AiKeywordInsights> {
  const empty: AiKeywordInsights = { seeds: [], keywords: [] };
  try {
    const locStr  = location ? ` in ${location}` : '';
    const snippet = pageContent.slice(0, 700);

    const text = await settleWithin(callLlm([
      {
        role: 'system',
        content: 'You are a keyword research expert. Output ONLY valid JSON — no markdown, no explanation.',
      },
      {
        role: 'user',
        content: `Analyze this website and generate search keywords.\n\nDomain: ${domain}\nVertical: ${vertical}${locStr}\nPage snippet: ${snippet}\n\nReturn a JSON object with exactly two fields:\n- "seeds": array of 3 specific search queries a real user would type to find THIS business (reflect what the site actually does, e.g. "best ai writing assistant", "mac menu bar developer tool", "language learning app for spanish")\n- "keywords": array of 8 high-intent SEO keywords mixing transactional, commercial, and question-based queries — include some that AI engines like ChatGPT and Perplexity would answer\n\nReturn ONLY valid JSON, e.g. {"seeds":["...","...","..."],"keywords":["...","..."]}`,
      },
    ], 400, env, { jsonMode: true, temperature: 0.2 }), timeoutMs);
    if (!text) return empty;
    const parsed = extractJsonObject(text) as { seeds?: unknown; keywords?: unknown } | null;
    if (!parsed) return empty;

    const seeds    = Array.isArray(parsed.seeds)    ? (parsed.seeds    as string[]).filter(s => typeof s === 'string').slice(0, 3) : [];
    const keywords = Array.isArray(parsed.keywords) ? (parsed.keywords as string[]).filter(k => typeof k === 'string').slice(0, 8) : [];
    return { seeds, keywords };
  } catch {
    return empty;
  }
}

/** Keep optional AI enrichment from turning a complete audit into a timeout. */
async function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>(resolve => {
        timeout = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function extractKeywordsFromSearchEvidence(evidence: string): string[] {
  if (!evidence) return [];
  const cleaned = evidence
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ');

  const tokens = cleaned
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !SEED_STOP.has(word));

  const phrases = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i += 1) {
    phrases.add(`${tokens[i]} ${tokens[i + 1]}`);
  }
  for (let i = 0; i < tokens.length - 2; i += 1) {
    phrases.add(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }

  return Array.from(phrases)
    .filter((phrase) => phrase.length >= 8 && !/^\d/.test(phrase))
    .slice(0, 8);
}
