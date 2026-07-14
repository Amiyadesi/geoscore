import type { ModuleResult } from '../lib/types';
import { RECOMMENDATION_TEMPLATES } from '../prompts';
import type { SchemaSiteType } from './schema_audit';

export interface Recommendation {
  template_id: string;
  title: string;
  why: string;
  what_to_do: string;
  impact: number;
  effort: number;
}

interface TechData { llms_txt_present?: boolean; sitemap_url_count?: number; blocked_ai_bots?: string[]; checks?: Array<{ name: string; passed: boolean }>; response_time_ms?: number; tech_stack?: { cms?: string | null }; page_meta?: { og_image?: string | null } }
interface SchemaData { coverage?: Record<string, boolean>; schemas_found?: string[]; site_type?: SchemaSiteType }
interface AuthData { wikipedia?: boolean; wikidata_id?: string; indexed_page_count?: number | null; domain_age_years?: number; page_rank?: number | null }
interface GeoData { citation_rate?: number; is_reliable?: boolean }
interface ContentData { word_count?: number; has_phone?: boolean; has_address?: boolean; h2_count?: number; alt_coverage_pct?: number; has_noindex?: boolean; lang_attr?: string | null; score?: number; issues?: string[]; is_saas_product?: boolean; has_pricing_language?: boolean }
interface BotData { reason?: string }
interface RedirectData { issues?: string[]; is_clean?: boolean; chain_length?: number }

// AI-builder CMS tools — sites built with these are always SaaS/digital products
const AI_BUILDER_CMS = new Set(['Lovable', 'Bolt', 'v0 (Vercel)', 'Framer', 'Webflow']);

// Explicit LocalBusiness subtypes from schema.org that are NOT SaaS/corporate entities.
// When a site has one of these schema types, Organization nested within it is just
// contact metadata — NOT a signal of a corporate/SaaS identity.
const LOCAL_BIZ_SCHEMA_TYPES = new Set([
  'LocalBusiness',
  // Medical
  'Dentist', 'Physician', 'Hospital', 'MedicalClinic', 'Optician', 'Pharmacy',
  'MedicalBusiness', 'Optometrist', 'EmergencyService',
  // Legal / financial
  'LegalService', 'Attorney', 'Notary', 'Accountant', 'FinancialService',
  'InsuranceAgency', 'RealEstateAgent',
  // Home services
  'HomeAndConstructionBusiness', 'Plumber', 'HVACBusiness', 'Electrician',
  'GeneralContractor', 'Locksmith', 'MovingCompany', 'Roofing',
  // Auto
  'AutoDealer', 'AutoRepair', 'GasStation', 'CarWash',
  // Beauty / wellness
  'BeautySalon', 'HairSalon', 'NailSalon', 'DaySpa', 'TattooParlor',
  // Fitness
  'HealthClub', 'SportsClub',
  // Food / hospitality
  'Restaurant', 'FoodEstablishment', 'Bakery', 'CafeOrCoffeeShop',
  'FastFoodRestaurant', 'BarOrPub', 'IceCreamShop',
  // Lodging
  'LodgingBusiness', 'Hotel', 'Motel', 'BedAndBreakfast', 'Hostel',
  // Education (local)
  'ChildCare',
  // Animal
  'AnimalShelter', 'Veterinary',
  // Retail (ends in Store handled below)
  'GroceryStore', 'ConvenienceStore',
  // Entertainment
  'EntertainmentBusiness', 'AmusementPark', 'MovieTheater',
  // Professional
  'ProfessionalService',
]);

export function runRecommendations(
  modules: Record<string, ModuleResult>
): Recommendation[] {
  const tech = modules.technical_seo?.data as TechData | undefined;
  const schema = modules.schema_audit?.data as SchemaData | undefined;
  const auth = modules.authority?.data as AuthData | undefined;
  const geo = modules.geo_predicted?.data as GeoData | undefined;
  const content = modules.content_quality?.data as ContentData | undefined;
  // Bot-blocked: WAF/CAPTCHA prevented reading page content — all content-dependent
  // modules returned zeros/empty. Suppress recommendations that would be false positives
  // (SSR, thin content, social, schema, sitemap) and only surface domain-level findings.
  const botBlocked = !!(modules.bot_blocked?.data as BotData | undefined)?.reason;

  // Detect SaaS/digital product sites — they need Organization schema, not LocalBusiness
  const hasOrgSchema = schema?.coverage?.Organization === true;
  // Use schemas_found for Corporation etc. — coverage only tracks REQUIRED_SCHEMAS keys
  const schemasFound = schema?.schemas_found ?? [];
  const isPersonalEditorial = schema?.site_type === 'editorial';
  const hasEntitySchema = schema?.coverage?.Entity === true ||
    schemasFound.some(s => ['Person', 'Organization', 'Corporation'].includes(s) || s.includes('Organization'));
  const hasCorporateSchema =
    hasOrgSchema ||
    schemasFound.includes('Corporation') ||
    schemasFound.includes('SoftwareApplication') ||
    schemasFound.includes('WebApplication');

  // Sites with an explicit LocalBusiness subtype are brick-and-mortar entities.
  // Even if their JSON-LD also contains a nested Organization (common in Dentist schemas),
  // we must not treat them as corporate/SaaS. Store subtypes all end with 'Store'.
  const hasLocalBizSchema =
    schema?.coverage?.LocalBusiness === true ||
    schemasFound.some(s => LOCAL_BIZ_SCHEMA_TYPES.has(s) || s.endsWith('Store'));

  // Dental/legal/medical/home-service businesses that use AI-builder CMSes (Webflow, Framer)
  // should NOT be classified as SaaS. If the site has BOTH an address AND a phone number,
  // treat it as a local business regardless of the CMS used to build it.
  const seemsLikeLocalBusiness = content?.has_address === true && content?.has_phone === true;

  // isActualSaas: truly a software/digital product with schema or AI-builder signals.
  // Explicitly not SaaS when a LocalBusiness subtype is present OR when address+phone
  // indicate a brick-and-mortar entity (dentist using Webflow is still a dentist).
  // Used only for the schema type decision ("Organization + SoftwareApplication" vs "Organization").
  // Does NOT include nav-detected SaaS (hasSaasNav) because media sites with subscriber /login
  // would incorrectly get SoftwareApplication schema.
  const isActualSaas =
    !isPersonalEditorial && !hasLocalBizSchema && !seemsLikeLocalBusiness && (
      hasCorporateSchema ||
      AI_BUILDER_CMS.has(tech?.tech_stack?.cms ?? '') ||
      /lovable\.app|v0\.dev|bolt\.new/i.test(tech?.page_meta?.og_image ?? '')
    );

  // isSaasSite: broader — any non-local digital site.
  // has_pricing_language (subscription/SaaS pricing text) is a strong SaaS signal.
  // But gyms, studios, and membership businesses also show "$49/month" — they have BOTH a
  // physical address AND a phone number on their homepage. SaaS tools rarely have both.
  const isSaasSite =
    !isPersonalEditorial && (isActualSaas ||
    auth?.wikipedia === true ||
    (content?.is_saas_product === true && content?.has_pricing_language === true && !seemsLikeLocalBusiness));

  // fetchFailed: page content truly unavailable (both HTTPS and HTTP returned nothing).
  // Distinct from SPA: a real SPA has DOM elements and non-zero HTML weight; a failed fetch has 0 of both.
  const techData = modules.technical_seo?.data as { page_weight_kb?: number; dom_element_count?: number } | undefined;
  const fetchFailed = (content?.word_count ?? 0) === 0
    && (techData?.page_weight_kb ?? 0) === 0
    && (techData?.dom_element_count ?? 0) === 0;
  const likelySPA = (content?.word_count ?? Infinity) < 50 && !fetchFailed;

  // ── Data quality signal detection ──────────────────────────────────────────
  // SSL / connectivity errors detected by redirect_chain
  const redirectData = modules.redirect_chain?.data as RedirectData | undefined;
  const sslOrConnIssue = redirectData?.issues?.find(i =>
    /ssl|526|cloudflare error|origin.*unreachable|server error|site may be down/i.test(i)
  );
  const hasSslOrConnError = !!sslOrConnIssue;

  // Modules that hard-failed (runtime error, not just empty/bot-blocked)
  const CORE_MODULES = new Set([
    'technical_seo', 'schema_audit', 'content_quality', 'authority',
    'geo_predicted', 'redirect_chain', 'ssl_cert', 'keywords',
  ]);
  const failedModuleNames = Object.entries(modules)
    .filter(([name, m]) => CORE_MODULES.has(name) && m?.status === 'failed')
    .map(([name]) => name.replace(/_/g, ' '));

  // ── Build data quality warnings (always surfaced first, not counted against rec cap) ──
  const warnings: Recommendation[] = [];

  // 1. SSL / connection error — site is currently broken
  if (hasSslOrConnError) {
    warnings.push({
      template_id: 'data_quality_warning',
      title: 'Site is currently unreachable — audit scores reflect a broken site',
      why: `The site returned a connection error during analysis: "${sslOrConnIssue}". Every module score in this report reflects the site in a broken state, not under normal operation — results will change once the issue is resolved.`,
      what_to_do: 'Fix the SSL/connectivity issue first (check your Cloudflare origin certificate, DNS, and server configuration), then delete the cached audit and re-run to get accurate results.',
      impact: 5,
      effort: 1,
    });
  }

  // 2. Bot-blocked — on-page analysis used domain-name inference, not real content
  if (botBlocked) {
    const botReason = (modules.bot_blocked?.data as BotData | undefined)?.reason ?? 'WAF/CAPTCHA challenge detected';
    warnings.push({
      template_id: 'data_quality_warning',
      title: 'Bot protection blocked page analysis — some scores are estimated from domain name only',
      why: `Page content was inaccessible: ${botReason}. Schema markup, on-page text, headings, and content signals could not be read. GEO vertical classification and keyword topics were inferred from the domain name rather than actual page content — they may not reflect what this site actually covers.`,
      what_to_do: 'Visit the site directly in your browser to verify schema, meta tags, and content. For a complete audit, temporarily allow this tool\'s crawler or provide a staging URL, then re-run.',
      impact: 3,
      effort: 1,
    });
  }

  // 3a. Page fetch failed entirely (HTTP-only site, firewall, or server down)
  if (!botBlocked && fetchFailed) {
    warnings.push({
      template_id: 'data_quality_warning',
      title: 'Page content unavailable — site may be HTTP-only or unreachable',
      why: 'The crawler could not retrieve any page content. This usually means the site has no SSL/HTTPS and only serves over plain HTTP, or the server is blocking automated access. All content-based checks (schema, meta tags, headings, word count) reflect an empty page and are not meaningful.',
      what_to_do: 'Install an SSL certificate and serve the site over HTTPS. This is also the single highest-impact SEO and trust improvement for this domain. Then re-run the audit for accurate results.',
      impact: 5,
      effort: 2,
    });
  }

  // 3b. SPA / client-rendered — schema and content scores are a lower bound
  if (!botBlocked && likelySPA) {
    warnings.push({
      template_id: 'data_quality_warning',
      title: 'JavaScript-rendered page — schema and content scores may be incomplete',
      why: `Only ${content?.word_count ?? 0} words were visible to the crawler. This appears to be a client-side rendered app: schema markup, headings, and body text loaded via JavaScript are not included in these scores. Actual on-page content could be richer than what is shown here.`,
      what_to_do: 'Cross-check schema and content scores using Google\'s Rich Results Test and URL Inspection tool, which run JavaScript. Treat this audit\'s content scores as a lower bound until server-side rendering is added.',
      impact: 3,
      effort: 1,
    });
  }

  // 4. Module failures — specific modules couldn't complete
  if (failedModuleNames.length > 0) {
    warnings.push({
      template_id: 'data_quality_warning',
      title: `${failedModuleNames.length} audit module${failedModuleNames.length > 1 ? 's' : ''} failed — data for these areas is missing`,
      why: `The following modules could not complete: ${failedModuleNames.join(', ')}. Scores and recommendations for these areas are absent or based on partial data.`,
      what_to_do: 'Delete the cached audit and re-run to retry failed modules. If failures persist, the site may be rate-limiting or blocking specific checks.',
      impact: 2,
      effort: 1,
    });
  }

  // ── Actionable recommendations ─────────────────────────────────────────────
  const recs: Recommendation[] = [];

  // llms.txt — highest GEO impact, lowest effort
  if (!tech?.llms_txt_present) {
    recs.push({
      template_id: 'add_llms_txt',
      title: 'Create /llms.txt so AI engines can index your content',
      why: 'No llms.txt found — AI engines like Perplexity and ChatGPT cannot discover a structured content index for this site.',
      what_to_do: 'Create a plain-text /llms.txt with a concise site description and links to the pages you want crawlers to understand. Keep it aligned with published content; do not invent services, staff, or FAQs.',
      impact: 5,
      effort: 1,
    });
  }

  // AI bots blocked — critical GEO fix
  if (tech?.blocked_ai_bots && tech.blocked_ai_bots.length > 0) {
    recs.push({
      template_id: 'unblock_ai_crawlers',
      title: `Unblock AI crawlers (${tech.blocked_ai_bots.join(', ')}) in robots.txt`,
      why: `Actively blocking ${tech.blocked_ai_bots.length} AI crawler(s) — this prevents any crawling or citation by LLM-based engines.`,
      what_to_do: 'Remove or narrow the Disallow rules for AI bots in robots.txt. Only block if you have a specific legal reason to prevent AI training.',
      impact: 5,
      effort: 1,
    });
  }

  // Wikidata is appropriate for notable organisations, not a prerequisite for a personal site.
  if (!isPersonalEditorial && !auth?.wikidata_id) {
    recs.push({
      template_id: 'wikidata_entity',
      title: 'Create a Wikidata entity to establish LLM knowledge graph identity',
      why: 'No Wikidata entity found — LLMs are significantly less likely to cite businesses without a structured knowledge graph entry.',
      what_to_do: 'Create a Wikidata item for this business: official name, location, website URL, founding year, industry. Link it to the official site via schema sameAs.',
      impact: 5,
      effort: 2,
    });
  }

  // Schema — recommend the right type based on business classification
  // hasCorporateSchema covers Organization, Corporation, SoftwareApplication, WebApplication —
  // if any of these exist the site already has appropriate structured identity schema.
  // Skip when bot-blocked — we cannot read the page so schema presence is unknown.
  if (!botBlocked && isPersonalEditorial && !hasEntitySchema) {
    recs.push({
      template_id: 'complete_entity_schema',
      title: 'Add Person or Organization schema for a stable site identity',
      why: 'No author or site entity schema was found, so crawlers cannot reliably connect the published work to its owner.',
      what_to_do: 'Add Person or Organization JSON-LD using the published name, canonical site URL, and only verified sameAs links. Do not add an address, price, FAQ, or commercial claims that the site does not publish.',
      impact: 4,
      effort: 1,
    });
  } else if (!botBlocked && isActualSaas && !hasCorporateSchema) {
    // True SaaS/digital product with no org-type schema: recommend Organization + SoftwareApplication
    recs.push({
      template_id: 'complete_local_schema',
      title: 'Add Organization + SoftwareApplication schema to establish digital identity',
      why: 'No JSON-LD schema found — AI engines cannot extract structured facts about this platform\'s capabilities, pricing, or purpose.',
      what_to_do: 'Add JSON-LD with "@type": ["Organization", "SoftwareApplication"] in <head>: name, url, description, applicationCategory, offers (with price and priceCurrency), sameAs (Product Hunt, GitHub, LinkedIn). Validate at schema.org/validator.',
      impact: 5,
      effort: 2,
    });
  } else if (!botBlocked && !isActualSaas && isSaasSite && !hasCorporateSchema && !schema?.coverage?.LocalBusiness) {
    // Established org (nonprofit, media, government-adjacent) with Wikipedia but not SaaS:
    // needs Organization schema — SoftwareApplication would be wrong here.
    // Guard on !LocalBusiness: gyms/studios with pricing plans may have LocalBusiness schema
    // but also get classified as isSaasSite via subscription pricing language.
    recs.push({
      template_id: 'complete_local_schema',
      title: 'Add Organization schema to establish structured digital identity',
      why: 'No Organization JSON-LD schema found — AI engines cannot reliably extract your organisation\'s name, mission, or contact details.',
      what_to_do: 'Add JSON-LD with "@type": "Organization" in <head>: name, url, description, logo, contactPoint, sameAs (Wikipedia, social profiles). Validate at schema.org/validator.',
      impact: 5,
      effort: 2,
    });
  } else if (!botBlocked && !isPersonalEditorial && !isSaasSite && !schema?.coverage?.LocalBusiness && !hasOrgSchema && !likelySPA) {
    // Local business: needs LocalBusiness schema
    recs.push({
      template_id: 'complete_local_schema',
      title: 'Add LocalBusiness JSON-LD schema with all required fields',
      why: 'No LocalBusiness schema found — AI engines cannot extract structured facts like address, hours, and phone from this site.',
      what_to_do: 'Add LocalBusiness schema in <head> with: name, address, telephone, openingHours, url, geo coordinates, sameAs (Google Maps link). Validate with Schema.org validator.',
      impact: 5,
      effort: 2,
    });
  }

  // GEO citation rate low — tailor evidence expectations to the site type.
  if (isPersonalEditorial && geo !== undefined && geo.is_reliable !== false && (geo.citation_rate ?? 0) < 0.4 && !likelySPA) {
    recs.push({
      template_id: 'editorial_content',
      title: 'Make core posts easier to evaluate as original sources',
      why: 'The citation simulation found little page-level evidence for the tested questions. Personal sites benefit from clear authorship and source context, not commercial detail.',
      what_to_do: 'Strengthen existing posts or project notes with first-hand context, dates where relevant, citations for claims, and a clear author/site relationship. Do not pad pages with invented FAQs, prices, or outcomes.',
      impact: 4,
      effort: 2,
    });
  } else if (!isPersonalEditorial && geo !== undefined && geo.is_reliable !== false && (geo.citation_rate ?? 0) < 0.4 && !likelySPA) {
    recs.push({
      template_id: 'expand_service_pages',
      title: 'Add specific facts, prices, and outcomes to service pages',
      why: `Homepage content is light on specific facts, prices, and concrete details — key signals AI systems use when deciding whether to cite a page as a source.`,
      what_to_do: 'For each service: add exact price range, procedure duration, number of customers served, named staff member, and measurable outcomes. Be factual, not promotional.',
      impact: 5,
      effort: 3,
    });
  }

  // FAQPage is optional for editorial sites. Never prompt users to fabricate one.
  if (!botBlocked && !isPersonalEditorial && !schema?.coverage?.FAQPage) {
    recs.push({
      template_id: 'add_faq_schema',
      title: 'Add FAQPage schema to answer common service questions',
      why: 'No FAQPage schema found — AI engines favour pages with structured Q&A when constructing answers to user queries.',
      what_to_do: 'Add a FAQ section to each service page covering the 5 most common questions. Mark up with FAQPage JSON-LD. Include pricing, availability, and process questions.',
      impact: 4,
      effort: 2,
    });
  }

  // Sitemap missing — skip for bot-blocked sites (sitemap may exist but be restricted to the crawler)
  if (!botBlocked && (!tech?.sitemap_url_count || tech.sitemap_url_count === 0)) {
    recs.push({
      template_id: 'sitemap_update',
      title: 'Create and submit an XML sitemap',
      why: 'No sitemap.xml found — search engines are crawling without a structured content map, likely missing pages.',
      what_to_do: 'Generate an XML sitemap for the pages you want indexed. Submit it via Google Search Console and include lastmod dates when they are maintained accurately.',
      impact: 4,
      effort: 2,
    });
  }

  // Open Graph missing
  if (tech?.checks?.find((c) => c.name === 'Open Graph tags complete' && !c.passed)) {
    recs.push({
      template_id: 'og_tags',
      title: 'Add Open Graph tags for social sharing and link previews',
      why: 'No Open Graph tags detected — links shared on social media show no image or description, reducing click-through.',
      what_to_do: 'Add og:title, og:description, og:image, og:url to every page. Use an image that truthfully represents the page content.',
      impact: 3,
      effort: 1,
    });
  }

  // Authority — press mentions / backlinks (tailored to business type)
  // Skip for Wikipedia-listed sites — they are established orgs with real backlinks; 0 sampled
  // is a scraper-blocking artifact, not low authority. Recommending "get listed on SaaS directories"
  // for BBC/Wikipedia would be a false positive.
  // Also skip for sites with meaningful OpenPageRank (≥ 3) — CC=0 on a high-OPR site means
  // Common Crawl is being blocked, not that the site has no backlinks.
  // indexed_page_count === null means Common Crawl was not checked (removed to save subrequests) —
  // only fire this recommendation when we have a real count of 0.
  if (auth !== undefined && auth.indexed_page_count !== null && (auth.indexed_page_count ?? 0) < 10 && !auth.wikipedia && (auth.page_rank == null || auth.page_rank < 3)) {
    recs.push({
      template_id: 'press_mentions',
      title: isPersonalEditorial
        ? 'Build references around original posts and projects'
        : isSaasSite ? 'Get listed on SaaS directories and review platforms' : 'Build authority through press coverage and directory listings',
      why: `Only ${auth.indexed_page_count ?? 0} indexed pages from Common Crawl found — low crawl coverage reduces both Google ranking and LLM citation likelihood.`,
      what_to_do: isPersonalEditorial
        ? 'Publish links where the work is genuinely discussed: project pages, communities, source repositories, or peer writing. Prefer references that add context for readers over directory submissions made only for ranking.'
        : isSaasSite
        ? 'Submit to Product Hunt, AlternativeTo, G2, Capterra, and Trustpilot. Pitch a story to a relevant newsletter or trade blog. Relevant independent references can strengthen discoverability and entity corroboration.'
        : 'Get listed on Google Business Profile, Yelp, and industry associations. Pitch one expert story to a trade or local publication each quarter. Relevant independent references can strengthen rankings and entity corroboration.',
      impact: 4,
      effort: 3,
    });
  }

  // Slow response time
  if (tech?.response_time_ms && tech.response_time_ms > 2000) {
    recs.push({
      template_id: 'page_speed',
      title: 'Improve page load speed — current TTFB is too slow',
      why: `TTFB of ${tech.response_time_ms}ms detected — slow sites are penalised in Core Web Vitals and crawl budget.`,
      what_to_do: 'Enable Cloudflare caching or a CDN. Compress images, defer non-critical JS. Target TTFB under 800ms. Check GTmetrix monthly.',
      impact: 3,
      effort: 3,
    });
  }

  // Content: thin page (critical for GEO) — skip when bot-blocked (zero words = CAPTCHA page, not real content)
  if (!botBlocked && content !== undefined && (content.word_count ?? 0) < 300) {
    recs.push({
      template_id: isPersonalEditorial ? 'editorial_content' : 'expand_service_pages',
      title: likelySPA
        ? 'Enable server-side rendering — crawlers cannot read page content'
        : isPersonalEditorial
          ? 'Expand only the core pages that lack context'
        : 'Expand thin homepage content — current word count too low for GEO',
      why: likelySPA
        ? `Only ${content.word_count ?? 0} words visible to search crawlers — the page requires JavaScript to load its content. Search and AI engines see an empty shell with no text or schema.`
        : isPersonalEditorial
          ? `Only ${content.word_count ?? 0} words detected. The page needs enough real context for readers to understand the author, topic, and linked work.`
        : `Only ${content.word_count ?? 0} words detected. AI engines require substantive content (300+ words) to consider a page citation-worthy.`,
      what_to_do: likelySPA
        ? 'Add server-side rendered content to the initial HTML response so crawlers can read it without JavaScript. Use Next.js/Nuxt SSR, static pre-rendering, or at minimum a <noscript> block with core page content and public contact details.'
        : isPersonalEditorial
          ? 'Improve the existing about page, post introductions, and project notes with concrete first-hand context and links to primary material. Do not add filler, fake FAQs, prices, or outcome claims just to reach a word target.'
        : 'Add dedicated sections for each service with specific facts, FAQs, pricing, and outcomes. Aim for 600+ words on service pages. Write for people, structure for machines.',
      impact: 5,
      effort: likelySPA ? 3 : 2,
    });
  }

  // Content: no phone number — only flag when content_quality also flagged it.
  // content_quality uses richer signals (hasSaasNav, hasPricingLanguage, WebSite schema)
  // to determine requiresContactInfo, so we mirror that decision here rather than
  // duplicating the same heuristics in recommendations.
  const contentQualityFlaggedPhone = content?.issues?.some(i =>
    i.includes('No contact information') || i.includes('No phone number')
  ) ?? false;
  if (!botBlocked && content !== undefined && !isPersonalEditorial && !content.has_phone && !isSaasSite && !likelySPA && contentQualityFlaggedPhone) {
    recs.push({
      template_id: 'gbp_populate',
      title: 'Add phone number and contact details to homepage',
      why: 'No phone number detected on homepage — LLMs and local search engines expect contact information for local businesses.',
      what_to_do: 'Add a visible phone number in international E.164 format (+1..., +44..., +61..., etc.) in the header, footer, and a dedicated contact section. Mark it up with schema.org/telephone.',
      impact: 4,
      effort: 1,
    });
  }

  // Content: images missing alt text (skip bot-blocked — zero images = CAPTCHA page artifact)
  if (!botBlocked && content !== undefined && (content.alt_coverage_pct ?? 100) < 80) {
    recs.push({
      template_id: 'expand_service_pages',
      title: 'Fix missing image alt text across the site',
      why: `${100 - (content.alt_coverage_pct ?? 100)}% of images lack alt text — search engines and screen readers cannot interpret these images.`,
      what_to_do: 'Add descriptive alt text to every <img> tag describing what the image shows, not generic "photo" or empty strings. Use keywords naturally.',
      impact: 3,
      effort: 1,
    });
  }

  // Validate all template_ids are in the library
  const validIds = new Set(RECOMMENDATION_TEMPLATES.map((t) => t.id));

  // Warnings: always shown first, not counted against the 8-recommendation cap
  const validWarnings = warnings.filter((r) => validIds.has(r.template_id));

  // Actionable recommendations: sorted by impact/effort ratio, capped at 8
  const filtered = recs.filter((r) => validIds.has(r.template_id));
  filtered.sort((a, b) => b.impact / b.effort - a.impact / a.effort);

  return [...validWarnings, ...filtered.slice(0, 8)];
}
