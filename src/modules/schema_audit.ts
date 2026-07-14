import type { SiteArchetype } from '../lib/audit-core';

export interface SchemaAuditResult {
  schemas_found: string[];
  coverage: Record<string, boolean>;
  issues: string[];
  score: number;
  schemas_raw: object[];
  site_type: SchemaSiteType;
  is_ecommerce: boolean;
  ecommerce_coverage: Record<string, boolean>;
  is_saas: boolean;
  is_media: boolean;
}

export type SchemaSiteType = 'local_business' | 'saas' | 'ecommerce' | 'media' | 'editorial' | 'general' | 'unknown';

// Schemas required for local businesses and generic sites
const REQUIRED_SCHEMAS_LOCAL = [
  'LocalBusiness',
  'Service',
  'FAQPage',
  'BreadcrumbList',
  'Organization',
];

// Schemas required for SaaS / tech / digital products
const REQUIRED_SCHEMAS_SAAS = [
  'Organization',
  'SoftwareApplication',
  'FAQPage',
  'BreadcrumbList',
  'WebSite',
];

// Schemas for media, news, and high-link-density portal/editorial sites
// These sites don't need LocalBusiness or SoftwareApplication — just identity + navigation schema
const REQUIRED_SCHEMAS_MEDIA = [
  'Organization',
  'WebSite',
  'BreadcrumbList',
];

// Personal sites and editorial blogs need an identifiable author/site entity plus
// clear site and navigation structure. FAQPage is a bonus, not a requirement.
const REQUIRED_SCHEMAS_EDITORIAL = [
  'Entity',
  'WebSite',
  'BreadcrumbList',
];

const REQUIRED_SCHEMAS_NEUTRAL = [
  'Entity',
  'WebSite',
  'BreadcrumbList',
];

const ECOMMERCE_SCHEMAS = ['Product', 'Offer', 'Review', 'AggregateRating', 'ItemList'];
// Core Product fields — sku removed; digital subscriptions, software, and tickets
// are all sold via schema.org/Product but rarely have a stock-keeping unit.
const ECOMMERCE_PRODUCT_FIELDS = ['name', 'description', 'image', 'offers'];

const LOCAL_BUSINESS_FIELDS = ['name', 'address', 'telephone', 'openingHours', 'sameAs', 'url'];

// LocalBusiness subtypes — all subclasses of schema.org/LocalBusiness.
// Defined at module level so it can be used inside the JSON-LD parsing loop.
const LOCAL_BIZ_SUBTYPES = new Set([
  'LocalBusiness', 'Dentist', 'Physician', 'Hospital', 'MedicalClinic', 'Optician',
  'Pharmacy', 'LegalService', 'Attorney', 'Notary', 'Accountant', 'FinancialService',
  'InsuranceAgency', 'RealEstateAgent', 'HomeAndConstructionBusiness', 'Plumber',
  'HVACBusiness', 'Electrician', 'GeneralContractor', 'Locksmith', 'MovingCompany',
  'AutoDealer', 'AutoRepair', 'GasStation', 'BeautySalon', 'HairSalon', 'NailSalon',
  'DaySpa', 'HealthClub', 'SportsClub', 'Restaurant', 'FoodEstablishment', 'Bakery',
  'CafeOrCoffeeShop', 'FastFoodRestaurant', 'LodgingBusiness', 'Hotel', 'Motel',
  'BedAndBreakfast', 'Veterinary', 'AnimalShelter', 'ChildCare', 'EntertainmentBusiness',
  'AmusementPark', 'MovieTheater', 'ProfessionalService',
]);

export async function runSchemaAudit(
  domain: string,
  html: string,
  innerPagesHtml: string[] = [],
  archetype?: SiteArchetype,
): Promise<SchemaAuditResult> {
  const issues: string[] = [];
  const schemasFound: string[] = [];
  const coverage: Record<string, boolean> = {};

  if (!html) {
    return { schemas_found: [], coverage: {}, issues: ['No page content available'], score: 0, schemas_raw: [], site_type: 'unknown', is_ecommerce: false, ecommerce_coverage: {}, is_saas: false, is_media: false };
  }

  // Combine homepage + inner pages so schema defined on /about or /contact is detected.
  // Deduplicate blocks: SPAs serve identical HTML for all URL paths, so inner pages
  // fetched from /about or /contact return the same homepage, causing duplicate schemas.
  const allHtml = innerPagesHtml.length > 0 ? [html, ...innerPagesHtml].join('\n') : html;
  const jsonLdBlocks = [...new Set(extractJsonLd(allHtml))];
  const allTypes: string[] = [];
  const schemasRaw: object[] = [];
  // Product completeness issues are deferred — only added to main issues[] when is_ecommerce is
  // confirmed (after the loop). This prevents false positives on news/media sites that use Product
  // schema for subscriptions (The Guardian, NYT) without being e-commerce sites.
  const pendingProductIssues: string[] = [];

  for (const block of jsonLdBlocks) {
    try {
      const parsed = JSON.parse(block);
      schemasRaw.push(parsed);
      const types = extractTypes(parsed);
      allTypes.push(...types);

      // Check LocalBusiness completeness — only for actual LocalBusiness types, NOT plain Organization.
      // Organization is used by global brands and media sites that legitimately omit address/phone/hours.
      if (types.some(t => LOCAL_BIZ_SUBTYPES.has(t) || t.endsWith('Store'))) {
        const missingFields = LOCAL_BUSINESS_FIELDS.filter(f => !block.includes(`"${f}"`));
        if (missingFields.length > 0) {
          issues.push(`LocalBusiness schema missing fields: ${missingFields.join(', ')}`);
        }
      }

      // Collect Product completeness issues — deferred until is_ecommerce is known
      if (types.includes('Product')) {
        const missingProdFields = ECOMMERCE_PRODUCT_FIELDS.filter(f => !block.includes(`"${f}"`));
        if (missingProdFields.length > 0) {
          pendingProductIssues.push(`Product schema missing fields: ${missingProdFields.join(', ')} — affects Shopping rich results`);
        }
      }
    } catch {
      issues.push('Malformed JSON-LD block found');
    }
  }

  const uniqueTypes = [...new Set(allTypes)];
  schemasFound.push(...uniqueTypes);

  const hasLocalBizSubtype = uniqueTypes.some(t => LOCAL_BIZ_SUBTYPES.has(t) || t.endsWith('Store'));

  // Opportunity coverage — only flag schemas relevant to this site type.
  // Use substring matching so that subtypes like NewsMediaOrganization and HomeAndConstructionBusiness
  // satisfy the check (they are Organisation/LocalBusiness sub-classes by naming convention).
  const hasOrgOrLocal = uniqueTypes.some(t =>
    ['Organization','LocalBusiness','Corporation'].includes(t) ||
    t.includes('Organization') || t.includes('LocalBusiness')
  ) || hasLocalBizSubtype;
  const hasLocal      = uniqueTypes.some(t => t.includes('LocalBusiness')) || hasLocalBizSubtype;

  // Media / news / portal detection — high link density or news-specific schema types.
  // Three-pronged check for the high-link-density branch:
  //   1. No subscription pricing language (rules out Shopify, Squarespace)
  //   2. No /pricing page link — SaaS tools (Figma, HubSpot, Notion) have a /pricing URL;
  //      news/media sites use /subscribe or /membership instead
  //   3. High link count — portals and news sites have 150+ hrefs on the homepage
  const homepageLinkCount = (html.match(/\bhref=/gi) ?? []).length;
  const isHighLinkSite    = homepageLinkCount >= 150;
  // Generic Article and BlogPosting schemas describe editorial sites, not newsrooms.
  const isNewsType        = uniqueTypes.some(t => ['NewsArticle','NewsMediaOrganization','Newspaper'].includes(t));
  const hasPersonalEditorialIdentity = uniqueTypes.some(t => ['Blog', 'BlogPosting', 'Person', 'ProfilePage'].includes(t));
  const hasPortalStructure = uniqueTypes.includes('Organization') &&
    uniqueTypes.some(t => ['CollectionPage', 'ItemList'].includes(t));
  // hasPricingLang / hasPricingPage must be computed before is_media since we use them in the guard
  const hasPricingLangEarly = /\$[\d,.]+\s*\/\s*(mo|month|yr|year)|per\s+month|free\s+trial|upgrade\s+to\s+pro/i.test(allHtml);
  // A same-site /pricing URL is a strong SaaS signal. External links to another
  // product's pricing page are common in blog posts and must not reclassify a site.
  const escapedDomain = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasPricingPage = new RegExp(
    `href=["'](?:https?:\\/\\/(?:www\\.)?${escapedDomain})?\\/pricing(?:["'?\\/])`,
    'i',
  ).test(allHtml);
  const is_media = !hasLocalBizSubtype && (
    isNewsType ||
    (isHighLinkSite && hasPortalStructure && !hasPersonalEditorialIdentity && !hasPricingLangEarly && !hasPricingPage)
  );

  // SaaS / digital product detection.
  // Tightened vs the old heuristic: /login, /register, and /app are too common on media and
  // subscription sites to be reliable SaaS signals on their own.  Instead require BOTH a
  // dedicated pricing/signup URL AND explicit pricing language, OR rely on schema/OG signals
  // that are authoritative by design (SoftwareApplication schema, AI-builder OG images).
  const hasSaasNav      = /href=["'][^"']*\/(signup|sign-up|pricing|dashboard)\b/i.test(allHtml);
  const hasPricingLang  = hasPricingLangEarly;  // reuse value computed above for is_media guard
  const hasSaasOgImage  = /lovable\.app|v0\.dev|bolt\.new|stackblitz\.io/i.test(allHtml);
  const hasSoftwareType = uniqueTypes.some(t => ['SoftwareApplication','WebApplication'].includes(t));
  // SaaS = digital-product signals AND not a local business AND not a media/portal site.
  // hasPricingPage is a reliable standalone signal: SaaS tools always have a /pricing page,
  // and non-SaaS sites (media, local businesses, e-commerce) use /subscribe or /checkout instead.
  // This catches SaaS products with per-seat or per-editor pricing (e.g. Figma, Miro, Linear)
  // that don't show "$X/month" on the homepage and thus miss hasPricingLang.
  const is_saas = !hasLocalBizSubtype && !is_media && (
    hasSoftwareType ||
    hasSaasOgImage  ||
    hasPricingPage  ||                  // /pricing URL = strong standalone SaaS signal
    (hasSaasNav && hasPricingLang)      // both required — nav link alone is too broad
  );

  // E-commerce detection: require Product schema as the anchor — it's the definitive signal.
  // ItemList, Review, and AggregateRating appear on news sites (article lists), hotels,
  // and SaaS review pages, so they can't trigger e-commerce alone.
  // Excluded contexts:
  //   - Media/portal sites: ItemList is used for news carousels, not product listings
  //   - SaaS sites: many use Product schema to mark up their software plans/tiers (HubSpot,
  //     Salesforce, etc.) — these are NOT retail/e-commerce products
  const is_ecommerce = !is_media && !is_saas && uniqueTypes.includes('Product');

  // A personal/editorial site is defined by its own schema and only when no
  // local-business, product, SaaS, or portal/news evidence contradicts it.
  const hasEditorialSchema = uniqueTypes.some(t => [
    'Blog', 'BlogPosting', 'Article', 'Person', 'ProfilePage', 'WebSite', 'CollectionPage', 'CreativeWork',
  ].includes(t));
  const is_editorial = !hasLocalBizSubtype && !is_saas && !is_ecommerce && !is_media && hasEditorialSchema;
  const contextualSiteType: SchemaSiteType | null = archetype === 'saas' ? 'saas'
    : archetype === 'ecommerce' ? 'ecommerce'
    : archetype === 'news_media' ? 'media'
    : ['personal_blog', 'editorial', 'documentation', 'portfolio'].includes(archetype ?? '') ? 'editorial'
    : ['local_business', 'professional_services'].includes(archetype ?? '') ? 'local_business'
    : archetype ? 'general'
    : null;
  const site_type: SchemaSiteType = contextualSiteType ?? (is_saas ? 'saas'
    : is_ecommerce ? 'ecommerce'
    : is_media ? 'media'
    : is_editorial ? 'editorial'
    : hasLocalBizSubtype ? 'local_business'
    : 'general');

  // Pick the schema checklist appropriate to this site type.
  const REQUIRED_SCHEMAS = site_type === 'saas' ? REQUIRED_SCHEMAS_SAAS
    : site_type === 'editorial' ? REQUIRED_SCHEMAS_EDITORIAL
    : site_type === 'media' ? REQUIRED_SCHEMAS_MEDIA
    : site_type === 'local_business' ? REQUIRED_SCHEMAS_LOCAL
    : REQUIRED_SCHEMAS_NEUTRAL;
  const hasEntity = hasOrgOrLocal || uniqueTypes.some(t => ['Person', 'ProfilePage'].includes(t));

  for (const schema of REQUIRED_SCHEMAS) {
    let present = uniqueTypes.some((t) => t.includes(schema));
    if (schema === 'Entity') present = hasEntity;
    // Map LocalBusiness subtypes to LocalBusiness coverage
    if (schema === 'LocalBusiness' && hasLocalBizSubtype) present = true;
    // Corporation is schema.org's corporate-entity type — treat it as satisfying Organization coverage.
    // Shopify, Microsoft, etc. use Corporation; without this mapping their org coverage shows false.
    if (schema === 'Organization' && (uniqueTypes.includes('Corporation') || hasLocalBizSubtype)) present = true;
    coverage[schema] = present;
    // LocalBusiness only flagged as missing for sites without Organization-level schema
    if (!present && !(schema === 'LocalBusiness' && hasOrgOrLocal)) {
      issues.push(`Missing ${schema} schema`);
    }
  }

  const ecommerce_coverage: Record<string, boolean> = {};
  if (is_ecommerce) {
    // Now that we know the site is genuinely e-commerce, add deferred Product completeness issues
    issues.push(...pendingProductIssues);
    for (const s of ECOMMERCE_SCHEMAS) {
      ecommerce_coverage[s] = uniqueTypes.includes(s);
      if (!uniqueTypes.includes(s)) {
        issues.push(`E-commerce: Missing ${s} schema — needed for Google Shopping rich results`);
      }
    }
  }

  // Compatibility score: only known, applicable coverage participates. Optional or
  // unrelated types (for example FAQPage on a personal blog) must not inflate it.
  const applicableCoverage = [
    ...Object.values(coverage),
    ...Object.values(ecommerce_coverage),
  ];
  const passedCoverage = applicableCoverage.filter(Boolean).length;
  const score = applicableCoverage.length > 0
    ? Math.round(passedCoverage / applicableCoverage.length * 100)
    : 0;

  return { schemas_found: schemasFound, coverage, issues, score, schemas_raw: schemasRaw, site_type, is_ecommerce, ecommerce_coverage, is_saas, is_media };
}

function extractJsonLd(html: string): string[] {
  const blocks: string[] = [];

  // Primary: explicit application/ld+json script tags
  const ldJsonRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = ldJsonRegex.exec(html)) !== null) {
    const trimmed = match[1].trim();
    if (trimmed) blocks.push(trimmed);
  }

  // Secondary: scan inline <script> and JSON blobs for embedded schema objects.
  // Many React/Next.js apps serialize schema into __NEXT_DATA__ or window.__SCHEMA__ etc.
  // Pattern: finds any JSON object that has both @context (schema.org) and @type at the top level.
  // Runs unconditionally so it supplements (not replaces) primary ld+json blocks.
  {
    const schemaPattern = /\{"@context"\s*:\s*"https?:\/\/(?:www\.)?schema\.org[^"]*"[^{}]*"@type"\s*:\s*"[^"]+"/g;
    // Extract up to 5 candidate objects by tracking brace depth
    let pm;
    let attempts = 0;
    while ((pm = schemaPattern.exec(html)) !== null && attempts < 10) {
      attempts++;
      // Walk forward from the match start to find the complete JSON object
      let depth = 0; let start = pm.index; let i = start;
      for (; i < html.length && i < start + 8000; i++) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}') { depth--; if (depth === 0) break; }
      }
      if (depth === 0 && i > start) {
        const candidate = html.slice(start, i + 1);
        try {
          JSON.parse(candidate); // validate it's real JSON
          if (!blocks.includes(candidate)) blocks.push(candidate); // deduplicate
        } catch { /* not valid JSON — skip */ }
      }
    }
  }

  return blocks;
}

function extractTypes(obj: unknown): string[] {
  if (!obj || typeof obj !== 'object') return [];
  const types: string[] = [];
  const o = obj as Record<string, unknown>;
  if (o['@type']) {
    const t = o['@type'];
    if (typeof t === 'string') types.push(t);
    else if (Array.isArray(t)) types.push(...t);
  }
  for (const val of Object.values(o)) {
    if (typeof val === 'object') types.push(...extractTypes(val));
  }
  return types;
}
