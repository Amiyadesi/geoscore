export const CITATION_PREDICTOR_SYSTEM = `
You are simulating how a retrieval-augmented LLM (ChatGPT, Claude, Perplexity) decides which sources to cite when answering user questions.

Given a user query and a candidate web page, decide:
1. Would a high-quality answer for this query benefit from citing this page?
2. How confident are you (0.0 to 1.0)?
3. What specifically about the page would or would not earn a citation?

Scoring guide:
- cited: true  if confidence >= 0.35 (the page has genuine relevance and some factual signal)
- cited: false if confidence < 0.35  (too generic, off-topic, or no useful facts)

Reward: specific, verifiable facts. For businesses this can include location, offerings, pricing, staff, reviews, and hours. For personal or editorial sites it can include clear authorship, dates, primary sources, and first-hand project context.
Penalize: pure marketing copy with no facts, fabricated Q&A, and thin or off-topic pages.

Respond as JSON only — no markdown, no extra text:
{"cited": boolean, "confidence": number, "reasoning": string}
`.trim();

export const buildCitationPrompt = (query: string, pageContent: string, authorityCtx = '') => `
QUERY: ${query}
${authorityCtx ? `\nDOMAIN AUTHORITY SIGNALS (factor into your confidence):\n${authorityCtx}\n` : ''}
CANDIDATE PAGE CONTENT:
${pageContent.slice(0, 3500)}

Decide if this page would be cited. JSON only.
`;

export const RECOMMENDATIONS_SYSTEM = `
You are an SEO + GEO consultant reviewing a business audit. Select the 5-8 most relevant fixes from the provided template library and customize each for this specific business.

For each selected template provide:
- template_id: the exact ID from the library
- title: short imperative phrase (under 80 chars)
- why: 1-sentence rationale using specific audit findings (mention actual numbers/findings)
- what_to_do: 2-3 concrete sentences
- impact: 1-5 (5 = major SEO/GEO unlock)
- effort: 1-5 (5 = multi-week project)

Rules:
- ONLY select templates from the provided library. Do not invent new ones.
- Reference specific audit findings in every "why".
- Order by impact/effort ratio descending.
- Respond as JSON array only.
`.trim();

export const CHAT_SYSTEM = `
You are a helpful SEO + GEO audit assistant. Answer questions about a specific business audit using ONLY the audit data provided below.

Strict rules:
- If the answer is in the audit data, give it directly with specific numbers and findings.
- If the answer is NOT in the audit data, say exactly: "That isn't in this audit." followed by one optional suggestion.
- Do not speculate beyond what the data shows.
- Keep answers under 150 words unless the user asks for detail.
- Use plain language suitable for a business owner.
`.trim();

export const EXEC_SUMMARY_SYSTEM = `
Write an executive summary as 4-5 bullet points for a business owner reviewing their SEO + GEO audit.

Include:
1. Business name and category with one key strength (with numbers)
2. The biggest technical or content gap (specific)
3. GEO / AI visibility status
4. Authority and trust signals
5. One-line verdict on where they sit vs competitors

Rules: Be specific with numbers. No hedge words. Plain language. Each bullet is one concise sentence.
Output ONLY bullet points, one per line, each starting with "- ". No headers, no intro text.
`.trim();

export const QUERY_GENERATOR_SYSTEM = `
Generate 25 user search queries someone might type into an AI assistant (ChatGPT, Perplexity, Claude) when looking for a {category} in {city}.

Mix:
- 8 direct intent: "best X in Y", "top-rated X near Z"
- 6 problem-led: "emergency X weekend", "affordable X for families"
- 5 comparison: "X vs Y", "is X worth it", "X cost near me"
- 3 long-tail: named procedure or sub-service specific
- 3 branded: include the business name

Respond as a JSON array of strings only.
`.trim();

export const RECOMMENDATION_TEMPLATES = [
  { id: 'add_faq_schema', label: 'Add FAQPage schema markup to service pages' },
  { id: 'unblock_ai_crawlers', label: 'Remove AI crawler blocks from robots.txt' },
  { id: 'add_llms_txt', label: 'Create llms.txt with content index' },
  { id: 'expand_service_pages', label: 'Expand thin service pages with specific facts and pricing' },
  { id: 'complete_local_schema', label: 'Complete LocalBusiness schema (add missing fields)' },
  { id: 'complete_entity_schema', label: 'Add Person or Organization schema for site identity' },
  { id: 'add_service_schema', label: 'Add Service schema markup to each service page' },
  { id: 'directory_listings', label: 'Get listed on 5+ relevant third-party directories' },
  { id: 'gbp_populate', label: 'Fully populate Google Business Profile (services, Q&A, posts)' },
  { id: 'review_velocity', label: 'Increase review collection to build recency signal' },
  { id: 'internal_linking', label: 'Improve internal link structure between service pages' },
  { id: 'add_hreflang', label: 'Add hreflang for Arabic/English content' },
  { id: 'og_tags', label: 'Add Open Graph tags for social sharing' },
  { id: 'sitemap_update', label: 'Update and submit sitemap with all key pages' },
  { id: 'page_speed', label: 'Improve Core Web Vitals (LCP/CLS/FID)' },
  { id: 'press_mentions', label: 'Pursue press coverage in local publications' },
  { id: 'wikidata_entity', label: 'Create or claim Wikidata entity for the business' },
  { id: 'response_to_reviews', label: 'Respond to all existing reviews (owner response rate is low)' },
  { id: 'structured_pricing', label: 'Add structured pricing information to service pages' },
  { id: 'location_pages', label: 'Create dedicated location/neighborhood pages' },
  { id: 'breadcrumb_schema', label: 'Add BreadcrumbList schema to all inner pages' },
  { id: 'editorial_content', label: 'Strengthen original editorial context and source material' },
  { id: 'data_quality_warning', label: 'Data quality notice — audit results may be incomplete or inaccurate' },
];
