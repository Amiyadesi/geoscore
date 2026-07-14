import type { Env } from '../lib/types';
import { fetchWithTimeout } from '../lib/http';
import { isValidPublicHostname, PUBLIC_DOMAIN_ERROR } from '../lib/security';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Geographic/person entity exclusion — same pattern as authority.ts to ensure consistency
const GEO_PERSON_PATTERN = /\b(village|town|city|municipality|commune|settlement|district|province|region|county|river|mountain|lake|island|peninsula|cape|bay|born|politician|footballer|athlete|actor|singer|musician|painter|philosopher|novelist|poet)\b/i;

// DuckDuckGo Instant Answer API — free, no auth, no quota.
// Its knowledge panel data is sourced from Wikipedia/Wikidata, which are
// the primary training corpora for every major LLM (ChatGPT, Gemini, Claude,
// Perplexity). If DDG has a knowledge panel for a brand, AI engines almost
// certainly know about it and will cite it in relevant queries.
interface DdgResponse {
  AbstractText: string;
  AbstractURL: string;
  AbstractSource: string;
  Heading: string;
  Type: string; // 'A' = article, 'D' = disambiguation, 'C' = category, '' = none
  Infobox?: { content?: Array<{ label: string; value: string }> };
  RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
}

export async function handleGeoProbe(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  let domain = '';
  let businessName = '';

  try {
    const body = await req.json() as { domain?: string; businessName?: string };
    domain       = (body.domain       ?? '').trim().toLowerCase();
    businessName = (body.businessName ?? '').trim();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  if (!domain || !businessName) {
    return new Response(JSON.stringify({ error: 'domain and businessName required' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  if (!isValidPublicHostname(domain)) {
    return new Response(JSON.stringify({ error: PUBLIC_DOMAIN_ERROR }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  const signals: string[] = [];
  let has_knowledge_panel = false;
  let knowledge_summary:  string | null = null;
  let knowledge_source:   string | null = null;
  let infobox_fields = 0;
  let entity_type:        string | null = null;
  let visibility_score = 0;

  // ── DuckDuckGo Instant Answer API ─────────────────────────────────────────
  try {
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(businessName)}&format=json&no_html=1&skip_disambig=1`;
    const ddgRes = await fetchWithTimeout(ddgUrl, { timeoutMs: 8000 });

    if (ddgRes.ok) {
      const ddg = await ddgRes.json() as DdgResponse;

      if (ddg.AbstractText && ddg.AbstractText.length > 30) {
        has_knowledge_panel = true;
        knowledge_summary   = ddg.AbstractText.slice(0, 350);
        knowledge_source    = ddg.AbstractSource || 'Wikipedia';
        signals.push(`Knowledge panel found via ${knowledge_source}`);
      }

      if (ddg.Heading) {
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (norm(ddg.Heading).includes(norm(businessName)) || norm(businessName).includes(norm(ddg.Heading))) {
          signals.push('Brand name matches the knowledge graph heading');
        }
      }

      if (ddg.Infobox?.content?.length) {
        infobox_fields = ddg.Infobox.content.length;
        signals.push(`Structured infobox with ${infobox_fields} data field${infobox_fields > 1 ? 's' : ''} (founding date, employees, HQ, etc.)`);
      }

      if (ddg.Type === 'A') {
        entity_type = 'Article';
        signals.push('Classified as a knowledge article entity (highest confidence)');
      } else if (ddg.Type === 'D') {
        entity_type = 'Disambiguation';
        signals.push('Found as a disambiguation entry — entity exists but may share a name');
      }

      const normBrand = businessName.toLowerCase();
      if (ddg.RelatedTopics?.some(t =>
        t.Text?.toLowerCase().includes(normBrand) ||
        t.FirstURL?.toLowerCase().includes(domain.toLowerCase())
      )) {
        signals.push('Brand referenced in related knowledge topics');
      }
    }
  } catch { /* DDG unavailable — treat as no knowledge panel */ }

  // ── Wikipedia direct check (fallback / consistency with authority module) ─
  // DDG doesn't always surface a panel even when a Wikipedia article exists.
  // Check directly so the result is consistent with what the main audit shows.
  // Uses same geo/person exclusion as authority.ts to avoid false positives.
  if (!has_knowledge_panel) {
    try {
      const brand = businessName.replace(/^www\./, '').split(/[\s.]/)[0].toLowerCase();
      const norm  = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normBrand = norm(brand);
      const wikiUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(brand)}&limit=5&format=json`;
      const wikiRes = await fetchWithTimeout(wikiUrl, { timeoutMs: 6000 });
      if (wikiRes.ok) {
        const wikiData = await wikiRes.json() as [string, string[], string[], string[]];
        const titles: string[] = wikiData[1] ?? [];
        const descs:  string[] = wikiData[2] ?? [];
        const match = titles.findIndex((t, i) => {
          const nt = norm(t);
          const titleMatch = nt === normBrand || nt.startsWith(normBrand + ' ') || nt.startsWith(normBrand + '-');
          if (!titleMatch) return false;
          return !GEO_PERSON_PATTERN.test(descs[i] ?? '');
        });
        if (match !== -1) {
          has_knowledge_panel = true;
          knowledge_source    = 'Wikipedia';
          knowledge_summary   = descs[match] || null;
          signals.push(`Wikipedia article found for this brand ("${titles[match]}")`);
          // Partial score — Wikipedia article exists but no rich DDG panel yet
          visibility_score   += 30;
        }
      }
    } catch { /* Wikipedia API unavailable */ }
  }

  // ── Score ─────────────────────────────────────────────────────────────────
  if (has_knowledge_panel)       visibility_score += 50;
  if (entity_type === 'Article') visibility_score += 20;
  if (infobox_fields >= 3)       visibility_score += 15;
  else if (infobox_fields >= 1)  visibility_score += 8;
  if (signals.length >= 3)       visibility_score += 10;
  else if (signals.length >= 2)  visibility_score += 5;
  visibility_score = Math.min(100, visibility_score);

  if (!has_knowledge_panel) {
    signals.push('No Wikipedia/knowledge panel entry detected');
    signals.push('AI engines trained on Wikipedia are unlikely to cite this brand unprompted');
    signals.push('Getting a Wikipedia article or Wikidata entry is the highest-impact GEO action');
  }

  return new Response(
    JSON.stringify({ domain, business_name: businessName, has_knowledge_panel, knowledge_summary, knowledge_source, infobox_fields, entity_type, visibility_score, signals }),
    { headers: { 'Content-Type': 'application/json', ...CORS } }
  );
}
