import type { Env } from '../lib/types';
import { callLlm } from '../lib/llm';
import { extractJsonArray, extractJsonObject } from '../lib/json';
import { CITATION_PREDICTOR_SYSTEM, buildCitationPrompt } from '../prompts';
import { isBotChallengePage } from '../lib/bot-detection';
import type { SubrequestBudgetLike } from '../lib/subrequest-budget';
import { extractJsonLdBlocks } from '../lib/json-ld';

// Models are managed by lib/llm.ts (Workers AI → Groq or OpenRouter fallback).

export interface GeoPredictedResult {
  queries: QueryPrediction[];
  citation_rate: number;
  avg_confidence: number;
  vertical?: string;
  location?: string;
  vertical_override_applied: boolean;
  /** false when AI was unavailable and all queries are generic templates — module should be suppressed */
  is_reliable: boolean;
  model_predictions: number;
}

export interface GeoPredictedOptions {
  budget?: SubrequestBudgetLike;
  allowAiClassification?: boolean;
  allowAiQueryGeneration?: boolean;
  maxModelPredictions?: number;
}

export interface QueryPrediction {
  query: string;
  cited: boolean;
  confidence: number;
  reasoning: string;
}

// 3 queries per vertical — run sequentially with primary → fallback → heuristic chain
const QUERY_TEMPLATES: Record<string, string[]> = {
  dental: [
    'best dental clinic in {location}',
    'emergency dentist {location}',
    'dental implants cost {location}',
  ],
  legal: [
    'best law firm in {location}',
    'employment lawyer {location}',
    'business lawyer {location}',
  ],
  fitness: [
    'best gym in {location}',
    'personal trainer {location}',
    'yoga studio {location}',
  ],
  real_estate: [
    'best real estate agent {location}',
    'buy apartment {location}',
    'rent house {location}',
  ],
  hotel: [
    'best luxury hotel {location}',
    'boutique hotel {location}',
    'weekend getaway {location}',
  ],
  restaurant: [
    'best restaurant in {location}',
    'fine dining {location}',
    'Sunday brunch {location}',
  ],
  food_delivery: [
    'best food delivery service {location}',
    'order food online {location}',
    'fast food delivery {location}',
  ],
  medical: [
    'best private clinic {location}',
    'specialist doctor {location}',
    'urgent care clinic {location}',
  ],
  ecommerce: [
    'best online store {location}',
    'fast delivery {location}',
    'top rated shop {location}',
  ],
  finance: [
    'best financial advisor {location}',
    'ai trading platform review',
    'investment app {location}',
  ],
  tech: [
    'best saas platform review',
    'top software tools for business',
    'ai software platform {location}',
  ],
  education: [
    'best online learning platform',
    'top language learning app',
    'best e-learning platform {location}',
  ],
  home_services: [
    'best plumber near me {location}',
    'emergency plumbing service {location}',
    'drain cleaning service {location}',
  ],
  news: [
    'best news source for breaking stories',
    'most trusted news websites',
    'reliable news coverage online',
  ],
  media: [
    'best things to do in {location}',
    'events this weekend {location}',
    'city guide {location}',
  ],
  editorial: [
    'independent blog and project notes',
    'personal writing and technical notes',
    'author website and article archive',
  ],
  general: [
    'top rated service provider {location}',
    'trusted company {location}',
    'professional services {location}',
  ],
};

const KNOWN_CITIES = [
  'London','New York','Los Angeles','Chicago','Houston','Phoenix','Philadelphia',
  'San Antonio','San Diego','Dallas','San Jose','Austin','Jacksonville',
  'Toronto','Montreal','Vancouver','Calgary','Edmonton',
  'Sydney','Melbourne','Brisbane','Perth','Adelaide',
  'Singapore','Hong Kong','Tokyo','Osaka','Seoul','Shanghai','Beijing','Mumbai',
  'Bangalore','Delhi','Hyderabad','Chennai','Kolkata',
  'Paris','Berlin','Amsterdam','Madrid','Barcelona','Rome','Milan','Vienna',
  'Zurich','Geneva','Brussels','Stockholm','Oslo','Copenhagen','Helsinki',
  'Dubai','Abu Dhabi','Riyadh','Doha','Kuwait City','Manama','Muscat',
  'Cairo','Nairobi','Lagos','Cape Town','Johannesburg',
  'São Paulo','Buenos Aires','Mexico City','Bogotá','Lima','Santiago',
];

// Common English words that the "in <Word>" regex would false-positive on
// Each word is checked individually so multi-word phrases like "Early Access" are caught too
const LOCATION_STOP = new Set([
  'start','started','starting','free','trial','your','just','more','join','find','meet',
  'help','from','with','this','that','they','some','most','many','each','here','there',
  'where','about','when','what','how','why','who','which','our','the','its','has','can',
  'get','new','see','try','use','all','any','and','but','for','not','you','one','two',
  'app','web','site','us','uk','ca','au','me','inc','llc','ltd','now','soon','days',
  'minutes','seconds','hours','weeks','months','years','service','services','business',
  'company','platform','product','products','feature','features','solution','solutions',
  'pricing','contact','login','signup','account','team','careers','blog','news',
  // Product-status / lifecycle words that commonly appear in "in <Word>" phrases
  'early','access','beta','alpha','preview','launch','release','development','testing',
  'production','staging','progress','maintenance','review',
  'private','public','open','closed','limited','general','global','worldwide','built',
  'real','time','live','demo','coming','motion',
  // Navigation / UI words that appear as headings/links (e.g. "Discover", "Explore")
  'discover','explore','browse','search','create','design','build','connect','learn',
  'work','play','feed','store','shop','market','studio','lab','hub','center','centre',
  'community','network','portfolio','gallery','library','trending','featured','popular',
  'latest','top','best','all','inspiration','showcase','hire','jobs','pricing',
  // Common sentence openers that follow "in" in marketing copy
  'which','ways','terms','seconds','minutes','hours','style','line','touch','stock',
  'depth','detail','progress','action','full','use','short','summary','brief',
  // Login / CTA words that appear capitalized in nav ("Sign in", "Log in", "Opt in")
  'sign','log','fill','opt','plug','check','trade','dial','tune','factor',
]);

/**
 * Extract vertical from JSON-LD schema markup in the raw HTML.
 * Schema @type is the most authoritative vertical signal — it's what the site
 * owner explicitly declared their business type to be, unambiguous and machine-readable.
 * Takes priority over regex content-analysis and AI inference.
 * Returns null when no unambiguous schema→vertical mapping is found.
 */
export function detectVerticalFromSchema(html: string): string | null {
  if (!html) return null;

  // Collect all @type values from every JSON-LD block (handles arrays and nested objects)
  const types = new Set<string>();
  for (const block of extractJsonLdBlocks(html)) {
    for (const m of block.matchAll(/"@type"\s*:\s*(?:"([^"]+)"|\[([^\]]+)\])/g)) {
      if (m[1]) types.add(m[1]);
      if (m[2]) { for (const t of m[2].matchAll(/"([^"]+)"/g)) types.add(t[1]); }
    }
  }
  if (types.size === 0) return null;

  // Priority order: most specific type wins.
  // Tech / Software — catches Notion, Figma, Vercel, etc. that AI routinely misclassifies
  if (types.has('SoftwareApplication') || types.has('WebApplication') || types.has('MobileApplication')) return 'tech';
  // News — unambiguous; generic "Organization" is not enough
  if (types.has('NewsMediaOrganization') || types.has('Newspaper')) return 'news';
  // Restaurant / Food
  if (types.has('Restaurant') || types.has('FastFoodRestaurant') || types.has('Bakery') ||
      types.has('CafeOrCoffeeShop') || types.has('BarOrPub') || types.has('FoodEstablishment')) return 'restaurant';
  if (types.has('FoodDeliveryService')) return 'food_delivery';
  // Accommodation
  if (types.has('Hotel') || types.has('Motel') || types.has('BedAndBreakfast') ||
      types.has('LodgingBusiness') || types.has('VacationRental') || types.has('Hostel')) return 'hotel';
  // Healthcare — most specific first
  if (types.has('Dentist')) return 'dental';
  if (types.has('Physician') || types.has('Hospital') || types.has('MedicalClinic') ||
      types.has('MedicalOrganization') || types.has('Pharmacy')) return 'medical';
  // Legal
  if (types.has('LegalService') || types.has('Attorney') || types.has('Notary')) return 'legal';
  // Fitness
  if (types.has('HealthClub') || types.has('SportsClub') || types.has('GymOrHealthClub') ||
      types.has('ExerciseGym')) return 'fitness';
  // Real estate
  if (types.has('RealEstateAgent') || types.has('ApartmentComplex')) return 'real_estate';
  // Home services
  if (types.has('HomeAndConstructionBusiness') || types.has('Plumber') || types.has('Electrician') ||
      types.has('GeneralContractor') || types.has('HVACBusiness') || types.has('Locksmith') ||
      types.has('MovingCompany') || types.has('RoofingContractor') || types.has('AutoRepair')) return 'home_services';
  // E-commerce
  if (types.has('OnlineStore') || types.has('Product') || types.has('Offer')) return 'ecommerce';
  // Finance
  if (types.has('FinancialService') || types.has('Bank') || types.has('InsuranceAgency') ||
      types.has('AccountingService')) return 'finance';
  // Education
  if (types.has('CollegeOrUniversity') || types.has('EducationalOrganization') ||
      types.has('School') || types.has('ElementarySchool')) return 'education';
  // Personal blogs and editorial sites are not generic service providers. This comes
  // after commercial types so a real product or local business stays commercial.
  if (['Blog', 'BlogPosting', 'Article', 'Person', 'ProfilePage', 'WebSite', 'CollectionPage', 'CreativeWork']
    .some(type => types.has(type))) return 'editorial';

  return null;
}

export function detectLocation(content: string): string {
  const lower = content.toLowerCase();
  for (const city of KNOWN_CITIES) {
    if (lower.includes(city.toLowerCase())) return city;
  }
  // Fallback: try to extract "in <City>" pattern — exclude common English false positives.
  // Check every word of the captured phrase against LOCATION_STOP so multi-word phrases
  // like "Early Access" or "Open Beta" don't get treated as city names.
  const m = content.match(/\bin\s+([A-Z][a-zA-Z]{2,}(?:\s+[A-Z][a-zA-Z]+)?)\b/);
  if (m) {
    const words = m[1].toLowerCase().split(/\s+/);
    if (!words.some(w => LOCATION_STOP.has(w))) return m[1];
  }
  return 'your area';
}

export function detectVertical(content: string): string {
  const lower = content.toLowerCase();
  // Business directories — detect first to prevent vertical misclassification
  // (directories list every type of business in their descriptions)
  if (/\b(yellow pages|yellowpages|whitepages|business directory|local business listings|find local businesses|business finder|company directory|yelp|tripadvisor|trustpilot)\b/i.test(lower)) return 'general';

  // ── NEWS / MEDIA — checked early before tech because news sites cover tech topics in articles ──
  // "breaking news", "newsroom", "latest news" are unambiguous news-organisation signals.
  // A SaaS company would never describe itself with these phrases.
  if (/\b(breaking news|latest news|top stories|live news|newsroom)\b/.test(lower)) return 'news';
  if (/\bnews\b/.test(lower) && /\b(journalism|journalist|reporter|editorial|correspondent|broadcast)\b/.test(lower)) return 'news';
  // City guide / entertainment media (timeout.com, yelp editorial, local event guides)
  // Must have specific guide-language — prevents generic "things" or "events" from other sites matching
  if (/\b(things to do|what'?s on|city guide|entertainment guide|event listings?|weekend guide|guide to (?:the )?(?:best|top))\b/.test(lower)) return 'media';

  // Editorial self-description is stronger than incidental tech terms in posts.
  if (/\b(personal blog|independent blog|writing archive|author website|personal site|project notes|my notes)\b/.test(lower)) return 'editorial';

  // ── EDUCATION — checked before tech because coding bootcamps etc. would match tech ──
  if (/\b(language learning|learn (a )?language|learn (spanish|french|german|italian|japanese|chinese|korean|portuguese|arabic|russian|hindi)|language (course|lesson|class|tutor)|language school|fluent|fluency|vocabulary|grammar lesson|pronunciation|e-?learning platform|online course|online learning|mooc|edtech|tutoring platform|coding bootcamp|online academy|learning management)\b/i.test(lower)) return 'education';

  // ── FINANCE (trading/broker platforms) — checked before tech because fintech platforms use AI terminology ──
  // Capital.com, eToro, etc. heavily market their "AI-powered" trading but are fundamentally finance companies.
  if (/\b(trading platform|investment platform|online broker|brokerage|spread betting|cfd trading|forex trading|stock trading|crypto trading|stock market|financial markets?|trade (stocks?|forex|crypto|shares?)|buy (stocks?|shares?|crypto)|invest(ing)? in (stocks?|shares?|crypto)|portfolio tracker|copy trading)\b/i.test(lower)) return 'finance';

  // ── TECH / SAAS ──
  // AI assistant / AI productivity tools — catch before broader SaaS checks
  if (/\b(ai assistant|ai agent|llm|large language model|generative ai|gpt|copilot|chatbot|voice assistant|personal ai|ai.{0,15}(does|runs|works|builds|manages)|autonomous agent|agentic|multi.?agent)\b/i.test(lower)) return 'tech';
  // Developer productivity tools, AI coding tools, macOS/desktop apps for developers
  if (/\b(claude code|claude ai|macos app|menu bar app|developer workflow|code editor|terminal emulator|multi.?session|multi.?account|ide extension|vscode|github copilot|developer productivity|coding tool|coding assistant|developer utility|desktop app for)\b/i.test(lower)) return 'tech';
  // Design / creative software tools (Figma, Sketch, Adobe XD, Miro, Canva, Photoshop, etc.)
  // "design" alone is too broad; require it in compound phrases or with a co-signal
  if (/\b(ui\s*[\/-]?\s*ux\s*design|interface design|product design (tool|platform|software)|design tool|design (and|&) prototyping|collaborative design|design system|wireframe|wireframing|prototyping tool|prototype (and|&) design|vector (editor|graphics)|photo editor|photo editing|video editing|motion graphics|creative suite|graphic design (tool|software|platform)|illustration (tool|software))\b/i.test(lower)) return 'tech';
  // Tech/SaaS signals — only match when not already classified as news above
  if (/saas|software platform|developer tools|devops|cloud platform|open.?source|repository|repositories|pull request|version control/.test(lower)) return 'tech';
  // API check tightened — require deploy/sdk/endpoint, not generic "platform"/"software" which appear everywhere
  if (/api\b/.test(lower) && /\b(deploy|sdk|endpoint|webhook|developer portal)\b/.test(lower)) return 'tech';
  // Broader SaaS/marketing platform signals (catches HubSpot, Ahrefs, Semrush, Hootsuite, etc.)
  if (/\b(marketing platform|marketing software|marketing hub|sales software|sales hub|crm platform|crm software|analytics platform|seo (tools?|platform|audit)|site audit|website audit|geo audit|content audit|technical seo|rank tracker|backlink checker|ai marketing|marketing automation|hris|workforce management software)\b/i.test(lower)) return 'tech';
  // CRM/business software with named hubs (HubSpot "Marketing Hub", "Sales Hub", etc.)
  if (/\b(crm|inbound marketing|marketing hub|sales hub|service hub|cms hub)\b/.test(lower) && /\bsoftware\b/.test(lower)) return 'tech';
  // Software & Tools companies (HubSpot title: "Software & Tools for your Business")
  if (/\bsoftware\b.{0,40}\btools?\b|\btools?\b.{0,40}\bsoftware\b/i.test(lower) && /\b(business|marketing|sales|customer|service|team)\b/.test(lower)) return 'tech';

  if (/dental|dentist|teeth|tooth|orthodont|implant|braces/.test(lower)) return 'dental';
  // Ecommerce platforms — checked before finance because store builders (Shopify, WooCommerce)
  // use payment language but are not financial services companies
  if (/\b(sell online|online store|ecommerce platform|start your (free )?store|build your (online )?store|commerce platform|shopify|woocommerce)\b/i.test(lower)) return 'ecommerce';
  if (/\b(add to cart|add to bag|buy now|shopping cart)\b/i.test(lower)) return 'ecommerce';
  // Finance/payments — tightened with word boundaries to avoid false positives from words like
  // "investigate" (invest), "fundamental" (fund), "trade-off" (trade), "trademark" (trade)
  if (/payment.{0,25}(platform|gateway|processing|infrastructure|api)|financial.{0,25}(infrastructure|technology|platform|services)|\bfintech\b|\bstock market\b|\bcrypto(currency)?\b|\bforex\b|\b(hedge|mutual|index) fund\b|\bwealth management\b|\bfinancial.?advis|\btrading (platform|software|bot|signal|strategy|app)\b|\binvestment (platform|app|fund|portfolio|management)\b|\bportfolio management\b|\bpay.?day loan\b|\binsurance (platform|quote|policy)\b/.test(lower)) return 'finance';
  // Hotel / short-term accommodation — includes traditional hotels and home-sharing platforms
  // (Airbnb uses "places to stay" and "host your home", Vrbo uses "vacation rental")
  if (/\bhotel\b|\bresort\b|\baccommodation\b|\blodging\b|\bvacation rental\b|\bshort.?term rental\b|\bplaces? to stay\b|\bhost your (home|place|space)\b|\bhome.?sharing\b/.test(lower)) return 'hotel';
  // Food delivery — check before restaurant; halal sites and explicit delivery services often misclassify as restaurant
  if (/\bhalal\b/i.test(lower) && /\bdeliver/i.test(lower)) return 'food_delivery';
  if (/\b(food delivery service|meal delivery|grocery delivery|order food online)\b/i.test(lower)) return 'food_delivery';
  // Restaurant: require specific culinary terms — avoid "menu" and "food" which appear in nav/generic HTML
  if (/restaurant|cuisine|chef|bistro|eatery|takeaway|takeout|brunch|dining room|dine in|fine dining|steakhouse|ramen|tapas|dim sum|delicatessen|\bdeli\b|brasserie/.test(lower)) return 'restaurant';
  if (/burger|pizza|sushi|chicken wings|grill house|café/.test(lower)) return 'restaurant';
  // Fitness: require specific terms — bare "fitness" in a board listing (4chan /fit/) would otherwise misclassify
  if (/\b(gym|yoga|crossfit|pilates|personal.?train|bodybuilding|weight.?loss|workout routine|fitness coach|fitness studio|fitness centre|fitness center)\b/.test(lower)) return 'fitness';
  // Legal: require specific practitioner terms — bare "legal" appears in every site's footer (Terms of Use, etc.)
  if (/lawyer|law firm|attorney|solicitor|advocate|legal advice|legal services|legal counsel/.test(lower)) return 'legal';
  if (/real estate|property listing|apartment for|villa for|mortgage broker/.test(lower)) return 'real_estate';
  // Home services — check BEFORE medical because plumbing/HVAC companies use medical metaphors in marketing
  // ("drain doctors", "roof clinic", "pipe specialists") that would otherwise trigger false medical detection.
  if (/\b(plumbing|plumber|drain cleaning|drain (service|repair)|sewer|hvac|heating (and|&) cooling|air conditioning (service|repair|installation)|roofing|roofer|electrician|handyman|pest control|locksmith|carpet cleaning|pressure washing|window cleaning)\b/.test(lower)) return 'home_services';
  // Medical: require specific clinical terms — "clinic" and "specialist" removed (too generic).
  // Home-service companies ("urgent plumbing care"), beauticians ("beauty clinic"), and
  // gyms ("wellness specialist") all use these terms without being medical practices.
  if (/\b(medical practice|medical clinic|medical center|medical centre|doctor|physician|gp practice|family medicine|general practitioner|urgent care clinic|emergency room|emergency department|pharmacy|pharmacist|chiropractor|physiotherapy|physiotherapist|optometrist|ophthalmology|psychiatry|psychiatrist|pediatrician|paediatrician|nursing home|primary care physician|hospital)\b/.test(lower)) return 'medical';
  return 'general';
}

async function callModel(
  query: string,
  pageContent: string,
  env: Env,
  authorityCtx = '',
  budget?: SubrequestBudgetLike,
): Promise<QueryPrediction | null> {
  const text = await callLlm([
    { role: 'system', content: CITATION_PREDICTOR_SYSTEM },
    { role: 'user', content: buildCitationPrompt(query, pageContent, authorityCtx) },
  ], 256, env, { jsonMode: true, temperature: 0, budget });

  const parsed = extractJsonObject(text);
  if (!parsed) return null;

  const confidence = Math.min(1, Math.max(0, Number(parsed.confidence) || 0));
  return {
    query,
    cited: parsed.cited === true || confidence >= 0.6,
    confidence,
    reasoning: String(parsed.reasoning ?? ''),
  };
}

function heuristicScore(query: string, pageContent: string): QueryPrediction {
  const lower = pageContent.toLowerCase();
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const termMatches = queryWords.filter(t => lower.includes(t)).length;

  let score = queryWords.length > 0 ? (termMatches / queryWords.length) * 0.15 : 0;
  if (/\b\d[\d\s\-().]{7,}\d\b/.test(pageContent))                              score += 0.10; // phone
  if (/\d+\s+\w+\s+(street|st\.?|avenue|ave\.?|road|rd\.?|blvd)/i.test(pageContent)) score += 0.05; // address
  if (lower.includes('application/ld+json'))                                     score += 0.10; // schema
  if (/review|rating|\bstars?\b|testimonial/i.test(lower))                       score += 0.05; // social proof
  if (/contact|about[-\s]us|our team/i.test(lower))                              score += 0.03; // trust

  const confidence = Math.min(0.28, Math.round(score * 100) / 100);
  return {
    query,
    cited: false,
    confidence,
    reasoning: `AI unavailable — heuristic: ${termMatches}/${queryWords.length} query terms matched; ${confidence >= 0.1 ? 'structured signals present' : 'few signals found'}`,
  };
}

const VERTICAL_NAMES = [
  'dental','legal','fitness','real_estate','hotel','restaurant','food_delivery',
  'medical','home_services','ecommerce','finance','tech','education','news','media','editorial','general',
] as const;

/**
 * AI fallback for vertical classification — called only when regex returns 'general'
 * and there is enough content to reason about. One tiny LLM call (max_tokens: 15).
 */
async function aiClassifyVertical(content: string, env: Env, budget?: SubrequestBudgetLike): Promise<string> {
  try {
    const snippet = content.slice(0, 500);
    const raw = (await callLlm([
      {
        role: 'system',
        content: `You are a website classifier. Respond with ONLY one of these exact labels (use underscores as shown):\ndental, legal, fitness, real_estate, hotel, restaurant, food_delivery, medical, home_services, ecommerce, finance, tech, education, news, media, editorial, general\n\nNo other text, no punctuation.`,
      },
      {
        role: 'user',
        content: `Classify this website:\n${snippet}`,
      },
    ], 15, env, { temperature: 0, budget })).trim().toLowerCase();

    // Exact match (handles correct responses)
    if ((VERTICAL_NAMES as readonly string[]).includes(raw)) return raw;

    // Strip-and-compare (handles "real estate" → "real_estate", "food delivery" → "food_delivery")
    const stripped = raw.replace(/[\s_\-]/g, '');
    for (const v of VERTICAL_NAMES) {
      if (v.replace('_', '') === stripped) return v;
    }

    // Keyword hints for common LLM paraphrases
    if (/\b(tech|software|saas|startup|app\b|platform|developer|digital|ai\b|tool)/i.test(raw)) return 'tech';
    if (/real.?estate|property|realtor|housing/i.test(raw))                                      return 'real_estate';
    if (/food.?deliv|deliv.?food|takeaway|takeout/i.test(raw))                                   return 'food_delivery';
    if (/hotel|resort|lodg|accommodation/i.test(raw))                                            return 'hotel';
    if (/restaurant|dining|cuisine|bistro/i.test(raw))                                           return 'restaurant';
    if (/fitness|gym|yoga|workout/i.test(raw))                                                   return 'fitness';
    if (/legal|law\b|attorney|solicitor/i.test(raw))                                             return 'legal';
    if (/medical|health|clinic|doctor|hospital/i.test(raw))                                      return 'medical';
    if (/dental|dentist|teeth/i.test(raw))                                                       return 'dental';
    if (/ecommerce|e-commerce|shop\b|store|commerce/i.test(raw))                                 return 'ecommerce';
    if (/finance|financial|invest|bank|trading/i.test(raw))                                      return 'finance';
    if (/education|learning|course|school|tutor/i.test(raw))                                     return 'education';
    if (/blog|personal site|portfolio|author|editorial|writing|article archive/i.test(raw))       return 'editorial';
    if (/news|journalism|broadcast|reporter|editorial|media/i.test(raw))                         return 'news';
    if (/city.?guide|things.?to.?do|entertainment|magazine|listings/i.test(raw))                return 'media';
    if (/plumb|drain|hvac|roofing|electrician|handyman|pest.?control|locksmith/i.test(raw))     return 'home_services';

    return 'general';
  } catch {
    return 'general';
  }
}

/**
 * Generate 3 business-specific GEO queries via AI, using page content to understand
 * what the site actually does. This avoids generic vertical queries like
 * "best financial advisor London" for Stripe (which is a payment processor).
 * Falls back to template queries if AI is unavailable or returns bad output.
 */

/**
 * Detect Cloudflare / bot-challenge / unsupported-client pages from their visible text.
 * These pages contain zero useful business content — passing them to the LLM produces
 * nonsense queries (e.g. "Cordova app integration" for Canva).
 */
// isBotChallengePage is imported from ../lib/bot-detection (single source of truth)

/**
 * Guess a vertical from the domain name alone — used when page content is unavailable
 * because the site is bot-blocked, returns a Cloudflare error, or is a JS SPA with
 * no server-rendered text.  The domain name is often a strong signal: "bayut.com" is
 * a well-known UAE real estate portal; "halal" in a domain → food_delivery, etc.
 *
 * Returns null when no confident guess can be made (caller falls back to 'general').
 *
 * Exported so keywords.ts can reuse this instead of duplicating the logic.
 */
export function guessVerticalFromDomain(domain: string): string | null {
  const d = domain.toLowerCase();
  // Accommodation / travel — check before restaurant because Airbnb has "bnb"
  if (/booking|hotel|hostel|airbnb|agoda|expedia|trivago|hotels\.|marriott|hilton|hyatt|vrbo|homeaway/.test(d)) return 'hotel';
  // Food & dining
  if (/restaurant|tripadvisor|yelp|zomato|opentable|doordash|ubereats|grubhub|deliveroo/.test(d)) return 'restaurant';
  if (/eventbrite|ticketmaster|concert|venue/.test(d)) return 'media'; // 'entertainment' not in VERTICAL_NAMES — use closest defined vertical
  if (/timeout/.test(d)) return 'media';
  if (/food|meal|halal|pizza|sushi|burger|delivery(?!y)|delivr/.test(d) && !/realestate|realty/.test(d)) return 'food_delivery';
  // Real estate — includes major regional portals (MENA, India, etc.)
  if (/rightmove|zillow|realtor|realestate|property|estate|bayut|propertyfinder|dubizzle|lamudi|magicbricks|99acres|housing\.com|nestoria|idealista|immobilien|immo\./.test(d)) return 'real_estate';
  // Fitness
  if (/gym|fitness|yoga|sport|crossfit|pilates/.test(d)) return 'fitness';
  // Dental
  if (/dental|dentist|teeth|orthodon/.test(d)) return 'dental';
  // Medical
  if (/clinic|hospital|health|medical|pharma|doctor/.test(d)) return 'medical';
  // Legal
  if (/legal|lawyer|attorney|solicitor|lawfirm/.test(d)) return 'legal';
  // E-commerce
  if (/amazon|ebay|shopify|etsy|ecommerce|shop\./.test(d)) return 'ecommerce';
  // Finance
  if (/bank|finance|invest|trading|crypto|forex/.test(d)) return 'finance';
  // Tech / SaaS
  if (/saas|software|github|gitlab|tech\./.test(d)) return 'tech';
  // Education
  if (/learn|course|academy|school|tutor|edu|class|lingo|vocab|fluent|glosso/.test(d)) return 'education';
  return null;
}

async function generateAiGeoQueries(
  vertical: string,
  location: string,
  pageContent: string,
  env: Env,
  budget?: SubrequestBudgetLike,
): Promise<string[]> {
  try {
    const locStr = (location && location !== 'your area') ? ` (city: ${location})` : '';
    const snippet = pageContent.slice(0, 800);
    const text = await callLlm([
      {
        role: 'system',
        content: 'You are an SEO expert. Output ONLY a JSON array. No markdown, no explanation.',
      },
      {
        role: 'user',
        content: `Generate exactly 3 search queries that an AI (ChatGPT, Perplexity, Google AI) would answer by citing THIS specific business.\n\nVertical: ${vertical}${locStr}\nPage content: ${snippet}\n\nRules:\n- Queries must reflect what this business ACTUALLY does (not generic vertical queries)\n- Use real search language ("best X for Y", "how to Z", "X vs Y")\n- Only include city/location if this is clearly a local business (restaurant, clinic, gym); for global SaaS/brands omit location\n- Mix query types: review/comparison, how-to, and best-of\n\nReturn ONLY a JSON array of exactly 3 strings. Example format (do not copy the topics — use the actual business above): ["best [tool type] for [use case]","how to [action] with [product]","[product] vs [competitor] comparison"]`,
      },
    ], 250, env, { temperature: 0.2, budget });
    const parsed = extractJsonArray(text);
    if (!parsed) return [];

    // Process and clean up the generated queries
    const queries = parsed
      .filter((q): q is string => typeof q === 'string' && q.length > 5)
      .map(q => {
        // Safe check: If the LLM returned raw placeholder tags, clean them up inline
        let cleaned = q;
        if (location && location !== 'your area') {
          cleaned = cleaned.replace(/\{location\}/gi, location).replace(/\byour area\b/gi, location);
        } else {
          cleaned = cleaned.replace(/\s*\{location\}\s*/gi, ' ').replace(/\s*\byour area\b\s*/gi, ' ').trim();
        }
        cleaned = cleaned.replace(/\bgeneric\b/gi, '').replace(/\s+/g, ' ').trim();
        return cleaned;
      })
      .filter(q => q.length > 5)
      .slice(0, 3);

    return queries;
  } catch {
    return [];
  }
}

export async function runGeoPredicted(
  domain: string,
  env: Env,
  sharedHtml: string,
  verticalOverride?: string | null,
  locationOverride?: string | null,
  options: GeoPredictedOptions = {},
): Promise<GeoPredictedResult> {
  let pageContent = '';
  if (sharedHtml) {
    // Extract title + meta description + OG description from <head> before stripping —
    // these are server-rendered even on JS SPAs and are the most reliable vertical signal.
    const titleText  = (sharedHtml.match(/<title[^>]*>([^<]{0,200})<\/title>/i) ?? [])[1] ?? '';
    const descText   = (sharedHtml.match(/name=["']description["'][^>]*content=["']([^"']{0,300})["']/i) ??
                        sharedHtml.match(/content=["']([^"']{0,300})["'][^>]*name=["']description["']/i) ?? [])[1] ?? '';
    const ogDescText = (sharedHtml.match(/property=["']og:description["'][^>]*content=["']([^"']{0,300})["']/i) ??
                        sharedHtml.match(/content=["']([^"']{0,300})["'][^>]*property=["']og:description["']/i) ?? [])[1] ?? '';
    const metaSignals = `${titleText} ${descText} ${ogDescText}`;
    // Strip <script> and <style> blocks BEFORE stripping tags — prevents JS bundle code
    // (e.g. React/Next.js SPA bundles) from polluting the content analysis with variable
    // names, inline strings, and payment/auth library text that biases vertical detection.
    const cleanedHtml = sharedHtml
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ');
    const bodyText = cleanedHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 4000);
    pageContent = `${metaSignals} ${bodyText}`.trim();
  } else {
    pageContent = `Business at ${domain}`;
  }

  // ── Bot-challenge detection ─────────────────────────────────────────────────
  // Sites like Canva serve "Unsupported client", Cloudflare 526 SSL errors, or
  // CAPTCHA challenge pages.  Sending that HTML to the LLM produces nonsense queries.
  // If blocked, replace with a minimal domain signal — the domain name itself is
  // enough for the AI to recognise known portals (bayut.com, airbnb.com, etc.).
  if (isBotChallengePage(pageContent)) {
    pageContent = `Business at ${domain}`;
  }

  // Schema @type is the most authoritative vertical signal — site owner's explicit declaration.
  // Check it first (before regex and AI) so a SoftwareApplication schema on notion.com can never
  // be overridden by AI guessing 'restaurant' from page copy.
  let vertical = verticalOverride ?? detectVerticalFromSchema(sharedHtml) ?? detectVertical(pageContent);
  // AI fallback: regex returns 'general' for niche/unknown sites → ask the LLM.
  // Threshold lowered to 50 chars so bot-blocked sites (content = "Business at domain.com")
  // still reach the AI — the domain name alone is often enough context.
  if (options.allowAiClassification !== false && !verticalOverride && vertical === 'general' && pageContent.length > 50) {
    const aiV = await aiClassifyVertical(pageContent, env, options.budget);
    if (aiV !== 'general') vertical = aiV;
  }
  // Domain-name guessing as final fallback when AI also returns 'general' —
  // handles well-known portals like bayut.com (real estate), booking.com (hotel), etc.
  if (!verticalOverride && vertical === 'general') {
    const domainGuess = guessVerticalFromDomain(domain);
    if (domainGuess) vertical = domainGuess;
  }
  // Location is only meaningful for local-service verticals.
  // Global SaaS/tech/finance/ecommerce sites mention cities in blog posts and testimonials,
  // so detectLocation produces false positives (e.g. "London" for moz.com).
  // food_delivery intentionally excluded: meal-kit services (HelloFresh, Blue Apron) are global,
  // so location-templated queries like "food delivery Geneva" look wrong in fallback mode.
  // AI-generated queries will use location when appropriate (local DoorDash/Uber Eats content
  // mentions cities, so AI correctly adds location for those).
  const LOCAL_VERTICALS = new Set(['dental','legal','fitness','real_estate','hotel','restaurant','medical','media','home_services']);
  const location = locationOverride ?? (LOCAL_VERTICALS.has(vertical) ? detectLocation(pageContent) : 'your area');
  const overrideApplied = !!(verticalOverride || locationOverride);

  // Try AI-generated business-specific queries first — fall back to templates.
  // Threshold is intentionally low (20 chars) so bot-blocked sites that only have
  // "Business at domain.com" still reach the AI — the domain name is often enough
  // for the model to identify the business (e.g. "bayut.com" → UAE property portal).
  let queries: string[] = [];
  let aiQueriesGenerated = false;
  if (options.allowAiQueryGeneration !== false && pageContent.length > 20) {
    queries = await generateAiGeoQueries(vertical, location, pageContent, env, options.budget);
    aiQueriesGenerated = queries.length > 0;
  }
  // Fill remaining slots from templates (strip {location} when location is unknown)
  if (queries.length < 3) {
    const templates = QUERY_TEMPLATES[vertical] ?? QUERY_TEMPLATES.general;
    const fallback = templates.map(t => {
      if (!location || location === 'your area') {
        // Remove the {location} token and any trailing space
        return t.replace(/\s*\{location\}/g, '').trim();
      }
      return t.replace('{location}', location);
    });
    for (const fq of fallback) {
      if (queries.length >= 3) break;
      if (fq && !queries.includes(fq)) queries.push(fq);
    }
  }

  // Halal food delivery — override with domain-specific queries
  if (vertical === 'food_delivery' && /\bhalal\b/i.test(pageContent)) {
    const loc = location !== 'your area' ? location : '';
    queries = [
      `halal food delivery${loc ? ' ' + loc : ''}`,
      `best halal delivery service${loc ? ' ' + loc : ''}`,
      `halal meat delivery near me`,
    ];
  }

  // Build authority context so the LLM calibrates confidence realistically
  const hasSchema    = sharedHtml.includes('application/ld+json');
  const hasReviews   = /testimonial|review.*\d+.*star|rating.*\d/i.test(pageContent);
  const hasPricing   = /\$[\d,.]+|\d+.*\/mo|per\s+month/i.test(pageContent);
  const hasBacklinks = false; // not available in this module — assume none for new sites without schema
  const authoritySignals: string[] = [];
  if (!hasSchema)    authoritySignals.push('No structured schema markup (JSON-LD) — AI cannot extract machine-readable facts');
  if (!hasReviews)   authoritySignals.push('No independently verifiable third-party reviews or star ratings');
  if (vertical !== 'editorial' && !hasPricing) authoritySignals.push('No specific pricing data on the page');
  if (vertical === 'editorial') authoritySignals.push('Editorial sites are assessed on identifiable authorship, original material, and clear sources rather than commercial pricing');
  if (authoritySignals.length === 0) authoritySignals.push('Page has structured data and verifiable signals');
  const authorityCtx = authoritySignals.join('; ');

  // Run queries sequentially — parallel AI calls hit Cloudflare Workers AI concurrency limits
  const predictions: QueryPrediction[] = [];
  let modelPredictions = 0;
  const maxModelPredictions = Math.max(0, Math.min(queries.length, options.maxModelPredictions ?? queries.length));
  for (const [index, query] of queries.entries()) {
    let prediction: QueryPrediction | null = null;

    if (index < maxModelPredictions) {
      try {
        prediction = await callModel(query, pageContent, env, authorityCtx, options.budget);
        if (prediction) modelPredictions += 1;
      } catch {
        prediction = null;
      }
    }

    // Heuristic if AI unavailable
    predictions.push(prediction ?? heuristicScore(query, pageContent));
  }

  const citedCount = predictions.filter((p) => p.cited).length;
  const citation_rate = predictions.length > 0 ? citedCount / predictions.length : 0;
  const avg_confidence =
    predictions.length > 0
      ? predictions.reduce((s, p) => s + p.confidence, 0) / predictions.length
      : 0;

  return {
    queries: predictions,
    citation_rate,
    avg_confidence,
    vertical,
    location,
    vertical_override_applied: overrideApplied,
    // Reliable only when: (a) AI generated queries AND (b) we had real page HTML to analyse.
    // Domain-name-only mode (sharedHtml empty) produces hallucinated verticals — suppress GEO section.
    is_reliable: aiQueriesGenerated && modelPredictions > 0 && !!sharedHtml,
    model_predictions: modelPredictions,
  };
}
