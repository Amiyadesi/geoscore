import type { Env } from '../lib/types';
import type { AuditContext } from '../lib/audit-core';
import { callLlm } from '../lib/llm';
import { extractJsonObject } from '../lib/json';

export interface AiContentInsightsResult {
  business_context: {
    description: string;
    industry_niche: string;
    target_audience: string;
  };
  content_analysis: {
    summary: string;
    strengths: string[];
    weaknesses: string[];
  };
  trust_scores: {
    topical_relevance: number;
    subject_expertise: number;
    credibility: number;
    summary: string;
  };
  freshness: {
    score: number;
    signals: string[];
    summary: string;
  };
  opportunities: {
    summary: string;
    quick_wins: string[];
  };
  ai_visibility_score: number;
}

const SYSTEM_PROMPT = `You are an evidence-bound SEO and content analyst. Analyze only the provided webpage content and site context, then return a structured JSON object with no extra text. Be concise but specific. Return valid JSON only.

CRITICAL: Do not invent a business model, services, prices, packages, addresses, phone numbers, locations, customers, or authority entities. Industry topics in articles do not change the site archetype. For freshness, report ONLY signals directly observable in the page content. NEVER infer or guess domain registration dates, founding years, or any date not explicitly written on the page.`;

export function buildAnalysisPrompt(domain: string, pageText: string, context?: AuditContext): string {
  const contextJson = context ? JSON.stringify({
    site_archetype: context.site_archetype,
    industry_vertical: context.industry_vertical,
    business_model: context.business_model,
    entity: context.entity,
    locale: context.locale,
    evidence: context.evidence,
  }) : '{"site_archetype":"unknown"}';
  const editorialGuard = context && ['personal_blog', 'editorial', 'portfolio'].includes(context.site_archetype)
    ? 'This is a personal/editorial site. Use author, publication, article, and project language. Do not propose services, pricing, packages, LocalBusiness, phone, address, or local-service tactics.'
    : 'Use neutral site/content language unless the supplied context explicitly proves a commercial model.';
  return `Analyze this webpage for "${domain}" and return JSON with this exact structure. Treat SITE CONTEXT as authoritative and PAGE CONTENT as the only factual evidence.

SITE CONTEXT: ${contextJson}
CONSTRAINT: ${editorialGuard}

{
  "business_context": {
    "description": "1-2 sentence factual description of what this site publishes or provides",
    "industry_niche": "topic or industry only when supported by content/context",
    "target_audience": "primary readers or users only when supported by evidence"
  },
  "content_analysis": {
    "summary": "2-3 sentence content quality summary",
    "strengths": ["strength 1", "strength 2", "strength 3"],
    "weaknesses": ["weakness 1", "weakness 2", "weakness 3"]
  },
  "trust_scores": {
    "topical_relevance": 85,
    "subject_expertise": 72,
    "credibility": 68,
    "summary": "1-2 sentence explanation of trust scores"
  },
  "freshness": {
    "score": 60,
    "signals": ["ONLY list signals you can directly observe on the page — e.g. blog post dates, copyright year, 'last updated' notices, dated testimonials. NEVER guess or infer domain registration dates."],
    "summary": "1 sentence about content freshness based only on observable page signals"
  },
  "opportunities": {
    "summary": "1-2 sentences on biggest opportunities",
    "quick_wins": ["action 1", "action 2", "action 3"]
  },
  "ai_visibility_score": 78
}

All numeric scores are 0-100. ai_visibility_score reflects how likely AI assistants (ChatGPT, Gemini, Perplexity) would cite this page.

PAGE CONTENT:
${pageText.slice(0, 3500)}`;
}

async function callAiModel(domain: string, pageText: string, env: Env, context?: AuditContext): Promise<AiContentInsightsResult | null> {
  const text = await callLlm([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildAnalysisPrompt(domain, pageText, context) },
  ], 1024, env, { jsonMode: true, temperature: 0.2 });
  const raw = extractJsonObject(text);
  if (!raw) return null;
  const clamp = (n: unknown) => Math.min(100, Math.max(0, Number(n) || 0));

  // Defensive extraction — model may omit or mis-name keys
  const bc = (raw.business_context ?? {}) as Record<string, unknown>;
  const ca = (raw.content_analysis ?? {}) as Record<string, unknown>;
  const ts = (raw.trust_scores ?? {}) as Record<string, unknown>;
  const fr = (raw.freshness ?? {}) as Record<string, unknown>;
  const op = (raw.opportunities ?? {}) as Record<string, unknown>;
  const editorial = !!context && ['personal_blog', 'editorial', 'portfolio'].includes(context.site_archetype);
  const commercialPattern = /\b(pric(?:e|ing)|package|service plan|localbusiness|phone number|street address|opening hours)\b|价格|套餐|服务报价|本地商家|电话号码|地址/i;
  const safeText = (value: unknown) => {
    const textValue = String(value ?? '');
    return editorial && commercialPattern.test(textValue) ? '' : textValue;
  };
  const safeList = (value: unknown) => Array.isArray(value)
    ? value.map(String).filter(item => !(editorial && commercialPattern.test(item)))
    : [];

  return {
    business_context: {
      description: safeText(bc.description),
      industry_niche: safeText(bc.industry_niche) || 'General',
      target_audience: safeText(bc.target_audience) || 'General audience',
    },
    content_analysis: {
      summary:    String(ca.summary    ?? ''),
      strengths: safeList(ca.strengths),
      weaknesses: safeList(ca.weaknesses),
    },
    trust_scores: {
      topical_relevance: clamp(ts.topical_relevance),
      subject_expertise: clamp(ts.subject_expertise),
      credibility:       clamp(ts.credibility),
      summary:           String(ts.summary ?? ''),
    },
    freshness: {
      score:   clamp(fr.score),
      signals: safeList(fr.signals),
      summary: String(fr.summary ?? ''),
    },
    opportunities: {
      summary: safeText(op.summary),
      quick_wins: safeList(op.quick_wins),
    },
    ai_visibility_score: clamp(raw.ai_visibility_score),
  };
}

export async function runAiContentInsights(
  domain: string,
  env: Env,
  pageText?: string,
  context?: AuditContext,
): Promise<AiContentInsightsResult | null> {
  // pageText is pre-extracted by audit.ts from technical_seo to avoid a separate fetch
  // (Cloudflare Workers subrequest limit would be exceeded with an extra fetch here)
  if (!pageText) pageText = `Domain: ${domain}`;

  // callLlm handles Workers AI → Groq-or-OpenRouter fallback automatically. If all providers
  // are unavailable, return null so the route reports skipped instead of invented scores.
  try {
    const result = await callAiModel(domain, pageText, env, context);
    if (result) return result;
  } catch { /* Workers AI and the configured external fallback are unavailable */ }

  return null;
}
