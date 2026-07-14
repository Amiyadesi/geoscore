export interface ContentQualityResult {
  word_count: number;
  h2_count: number;
  h3_count: number;
  image_count: number;
  images_with_alt: number;
  alt_coverage_pct: number;
  internal_links: number;
  external_links: number;
  has_phone: boolean;
  has_email: boolean;
  has_address: boolean;
  lang_attr: string | null;
  has_noindex: boolean;
  score: number;
  issues: string[];
  readability: ReadabilityScore;
  is_saas_product: boolean;
  has_pricing_language: boolean;
}

export interface ReadabilityScore {
  flesch_ease: number | null;
  grade_level: number | null;
  grade_label: string;
  avg_words_per_sentence: number;
  reading_time_min: number;
  method: 'flesch_en' | 'not_applicable';
  applicable: boolean;
}

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const stripped = w.replace(/e$/, '');
  const vowelGroups = stripped.match(/[aeiouy]{1,2}/g);
  return Math.max(1, vowelGroups ? vowelGroups.length : 1);
}

function countContentTerms(text: string): string[] {
  const terms: string[] = [];
  for (const match of text.matchAll(/[\u3400-\u9fff]|[A-Za-z0-9]+(?:['’_-][A-Za-z0-9]+)*/g)) {
    terms.push(match[0]);
  }
  return terms;
}

function computeReadability(text: string, wordCount: number, locale: string | null): ReadabilityScore {
  const isCjk = !!locale?.toLowerCase().startsWith('zh') || /[\u3400-\u9fff]/.test(text);
  if (isCjk) {
    return {
      flesch_ease: null,
      grade_level: null,
      grade_label: 'Not applicable for Chinese/CJK content',
      avg_words_per_sentence: 0,
      reading_time_min: Math.max(1, Math.round(wordCount / 350)),
      method: 'not_applicable',
      applicable: false,
    };
  }
  if (wordCount < 30) {
    return { flesch_ease: null, grade_level: null, grade_label: 'Insufficient content', avg_words_per_sentence: 0, reading_time_min: 0, method: 'flesch_en', applicable: false };
  }
  const sentenceMatches: string[] = text.match(/[^.!?]*[.!?]+/g) ?? [];
  const sentences = Math.max(1, sentenceMatches.filter(sentence => sentence.trim().length > 10).length);
  const words = text.split(/\s+/).filter(w => w.length > 1);
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  // Cap at 40 wps — link-heavy pages with no prose punctuation (Craigslist, portals)
  // would otherwise produce impossible grade levels (e.g. 517 words / 5 sentences = grade 48)
  const avgWordsPerSentence = Math.min(40, wordCount / sentences);
  const avgSyllablesPerWord = syllables / Math.max(1, words.length);

  // Flesch Reading Ease (0–100, higher = easier)
  const flesch = Math.round(Math.min(100, Math.max(0,
    206.835 - 1.015 * avgWordsPerSentence - 84.6 * avgSyllablesPerWord
  )));
  // Flesch-Kincaid Grade Level
  const grade = Math.round(Math.max(0, 0.39 * avgWordsPerSentence + 11.8 * avgSyllablesPerWord - 15.59));
  const label = flesch >= 90 ? 'Very Easy' : flesch >= 80 ? 'Easy' : flesch >= 70 ? 'Fairly Easy'
    : flesch >= 60 ? 'Standard' : flesch >= 50 ? 'Fairly Difficult' : flesch >= 30 ? 'Difficult' : 'Very Difficult';

  return {
    flesch_ease: flesch,
    grade_level: grade,
    grade_label: label,
    avg_words_per_sentence: Math.round(avgWordsPerSentence * 10) / 10,
    reading_time_min: Math.max(1, Math.round(wordCount / 238)),
    method: 'flesch_en',
    applicable: true,
  };
}

export async function runContentQuality(domain: string, html: string, innerPagesHtml: string[] = []): Promise<ContentQualityResult> {
  const issues: string[] = [];
  const empty: ContentQualityResult = {
    word_count: 0, h2_count: 0, h3_count: 0, image_count: 0,
    images_with_alt: 0, alt_coverage_pct: 100, internal_links: 0,
    external_links: 0, has_phone: false, has_email: false, has_address: false,
    lang_attr: null, has_noindex: false, score: 0, is_saas_product: false, has_pricing_language: false,
    issues: ['No page content available for content analysis'],
    readability: { flesch_ease: null, grade_level: null, grade_label: 'N/A', avg_words_per_sentence: 0, reading_time_min: 0, method: 'not_applicable', applicable: false },
  };

  if (!html) return empty;

  // Strip noisy blocks before analysis
  // nav + footer are stripped so word count matches on_page_seo (which also strips them),
  // preventing two modules reporting different counts for the same page.
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '');

  // Lang attribute (reported by technical_seo check — no duplicate here)
  const langMatch = html.match(/<html[^>]+lang=["']([^"']+)["']/i);
  const lang_attr = langMatch?.[1] ?? null;

  // noindex detection — computed after word count so we can suppress false positives
  const has_noindex = /<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);

  // Word count
  const text = stripped.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const words = countContentTerms(text);
  const word_count = words.length;
  // Detect JavaScript SPA: extremely low word count means content is client-rendered
  const likely_spa = word_count < 50;
  if (likely_spa) {
    // Don't fire noindex CRITICAL on bot-blocked pages — they often return a noindex error page
    // (e.g. "Unsupported client" pages from Canva/Figma) which would be a false alarm
    if (has_noindex) {
      issues.push('Could not fully render page — possible bot protection; noindex may be on an error page, not the real homepage');
    } else {
      issues.push(`JavaScript SPA detected: only ${word_count} words visible to crawlers — ensure critical content is server-rendered for indexability`);
    }
  } else {
    // noindex on a full page is reported by technical_seo (which owns meta-robots) — no duplicate here.
  }
  if (!likely_spa) {
    if (word_count < 300) {
      issues.push(`Thin content: ${word_count} words (target 300+ for GEO citation eligibility)`);
    } else if (word_count < 600) {
      issues.push(`Low word count: ${word_count} words (600+ recommended for authority pages)`);
    }
  }

  // Headings (H2 structure is reported by on_page_seo — no duplicate here)
  const h2_count = (stripped.match(/<h2[^>]*>/gi) ?? []).length;
  const h3_count = (stripped.match(/<h3[^>]*>/gi) ?? []).length;

  // Images and alt text
  const imgs = stripped.match(/<img[^>]+>/gi) ?? [];
  const image_count = imgs.length;
  // Count images that have an explicit alt attribute (including alt="" for decorative images).
  // alt="" is the correct WCAG treatment for decorative images — count as covered, not missing.
  // Only images with NO alt attribute at all are considered uncovered.
  const images_with_alt = imgs.filter(img => /alt=/i.test(img)).length;
  const alt_coverage_pct = image_count > 0 ? Math.round((images_with_alt / image_count) * 100) : 100;
  // Alt text issues are reported by accessibility (WCAG 1.1.1) — no duplicate here.
  // alt_coverage_pct is still returned as a metric for scoring and recommendations.

  // Links
  const anchors = stripped.match(/<a[^>]+href=["']([^"'#]+)["'][^>]*>/gi) ?? [];
  let internal_links = 0;
  let external_links = 0;
  for (const a of anchors) {
    const href = (a.match(/href=["']([^"']+)["']/i)?.[1] ?? '').toLowerCase();
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
    if (href.startsWith('http') && !href.includes(domain.toLowerCase())) external_links++;
    else internal_links++;
  }

  // Contact signals — international patterns
  let has_phone = /(?:^|[\s\(])\+?\d[\d\s\-.\(\)]{6,}\d(?=$|[\s\)])/.test(text);
  let has_email = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(text);
  let has_address = /(street|road|avenue|boulevard|lane|drive|court|building|floor|suite|office|p\.o\.?\s*box|\d+\s+\w+\s+(?:st|rd|ave|blvd|ln|dr)\.?)/i.test(text);

  // Enrich contact signals from inner pages (/contact, /about, etc.) when not found on homepage
  if (innerPagesHtml.length > 0 && (!has_phone || !has_email || !has_address)) {
    const innerText = innerPagesHtml
      .map(h => h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))
      .join(' ');
    if (!has_phone) has_phone = /(?:^|[\s\(])\+?\d[\d\s\-.\(\)]{6,}\d(?=$|[\s\)])/.test(innerText);
    if (!has_email) has_email = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(innerText);
    if (!has_address) has_address = /(street|road|avenue|boulevard|lane|drive|court|building|floor|suite|office|p\.o\.?\s*box|\d+\s+\w+\s+(?:st|rd|ave|blvd|ln|dr)\.?)/i.test(innerText);
  }

  // Detect whether this is a local business or a global org/SaaS from JSON-LD in the HTML
  const schemaTypes = (html.match(/"@type"\s*:\s*"([^"]+)"/gi) ?? [])
    .map(m => (m.match(/"([^"]+)"$/) ?? [])[1] ?? '');
  const hasSoftwareSchema = schemaTypes.some(t => ['SoftwareApplication', 'WebApplication'].includes(t));
  const isLocalBiz = schemaTypes.some(t =>
    t === 'LocalBusiness' || t.endsWith('Store') || t.endsWith('Restaurant') ||
    t.endsWith('Salon') || t.endsWith('Gym') || t.endsWith('Hotel') ||
    // Medical, legal, home services and other brick-and-mortar LocalBusiness subtypes
    ['Dentist', 'Physician', 'Hospital', 'MedicalClinic', 'Optician', 'Pharmacy',
     'LegalService', 'Attorney', 'Accountant', 'FinancialService', 'RealEstateAgent',
     'HomeAndConstructionBusiness', 'Plumber', 'HVACBusiness', 'Electrician',
     'GeneralContractor', 'Locksmith', 'MovingCompany', 'AutoDealer', 'AutoRepair',
     'GasStation', 'HealthClub', 'SportsClub', 'LodgingBusiness', 'Hotel',
     'FoodEstablishment', 'Bakery', 'CafeOrCoffeeShop', 'Veterinary',
     'EntertainmentBusiness', 'ProfessionalService', 'ChildCare'].includes(t)
  );
  // Detect SaaS/digital product from nav links and pricing language even without JSON-LD schema
  const hasSaasNav = /href=["'][^"']*\/(signup|sign-up|register|login|log-in|pricing|dashboard|app)\b/i.test(html);
  const hasPricingLanguage = /\$[\d,.]+\s*\/\s*(mo|month|yr|year)|per\s+month|free\s+trial|upgrade\s+to\s+pro/i.test(text);
  const hasSaasOgImage = /lovable\.app|v0\.dev|bolt\.new|stackblitz\.io/i.test(html);
  // isLocalBiz from explicit schema overrides all SaaS signals — a dental practice with
  // nested Organization schema is still a local business, not SaaS
  const isSaasProduct = !isLocalBiz && (
    hasSoftwareSchema || hasSaasOgImage || (hasSaasNav && hasPricingLanguage)
  );
  // Only local businesses genuinely need phone/address; org/media/SaaS sites legitimately omit them.
  const requiresContactInfo = isLocalBiz;

  // Contact issues
  if (!likely_spa) {
    if (!has_phone && !has_email && requiresContactInfo) issues.push('No contact information found on homepage — weakens trust signals');
    else if (!has_phone && requiresContactInfo) issues.push('No phone number — consider adding for local SEO and LLM citation');
    if (!has_address && requiresContactInfo) issues.push('No location/address text — weakens local SEO signals');
  }

  const readability = computeReadability(text, word_count, lang_attr);

  // Score 0-100
  // Phone and address only count toward the score for local businesses.
  // Global org/SaaS sites are scored on content quality, not contact completeness.
  let score = 0;
  if (word_count >= 600) score += 30;
  else if (word_count >= 300) score += 18;
  if (h2_count >= 2) score += 15;
  if (alt_coverage_pct >= 80) score += 20;
  else if (alt_coverage_pct >= 50) score += 10;
  if (requiresContactInfo) {
    if (has_phone) score += 10;
    if (has_address) score += 10;
    if (has_email) score += 5;
    if (lang_attr) score += 5;
  } else {
    // For orgs/SaaS: email still a mild trust signal; redistribute the phone/address points to lang
    if (has_email) score += 10;
    if (lang_attr) score += 15;
    score += 10; // baseline — not penalised for legitimately omitting phone/address
  }

  return {
    word_count, h2_count, h3_count, image_count, images_with_alt,
    alt_coverage_pct, internal_links, external_links,
    has_phone, has_email, has_address, lang_attr, has_noindex,
    score, issues, readability,
    is_saas_product: isSaasProduct,
    has_pricing_language: hasPricingLanguage,
  };
}
