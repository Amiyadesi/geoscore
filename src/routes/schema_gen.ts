import type { Env } from '../lib/types';
import { CF_FAST_CHAT_MODEL } from '../lib/ai-models';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const VALID_SCHEMA_TYPES = [
  'LocalBusiness',
  'Restaurant',
  'MedicalBusiness',
  'LegalService',
  'HomeAndConstructionBusiness',
  'FinancialService',
  'Store',
  'SoftwareApplication',
  'WebSite',
  'Organization',
  'NewsArticle',
  'BlogPosting',
] as const;

type SchemaType = (typeof VALID_SCHEMA_TYPES)[number];

export async function handleSchemaGen(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  let domain = '';
  let businessName = '';
  let schemaType: SchemaType = 'LocalBusiness';
  let description: string | undefined;
  let city: string | undefined;
  let country: string | undefined;

  try {
    const body = await req.json() as {
      domain?: string;
      businessName?: string;
      schemaType?: string;
      description?: string;
      city?: string;
      country?: string;
    };

    domain       = (body.domain       ?? '').trim();
    businessName = (body.businessName ?? '').trim();
    description  = body.description ? body.description.trim() : undefined;
    city         = body.city        ? body.city.trim()        : undefined;
    country      = body.country     ? body.country.trim()     : undefined;

    const rawType = (body.schemaType ?? '').trim();
    if (rawType && VALID_SCHEMA_TYPES.includes(rawType as SchemaType)) {
      schemaType = rawType as SchemaType;
    } else if (rawType) {
      return new Response(
        JSON.stringify({
          error: `Invalid schemaType. Must be one of: ${VALID_SCHEMA_TYPES.join(', ')}`,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } }
      );
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  if (!domain) {
    return new Response(JSON.stringify({ error: 'domain is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  if (!businessName) {
    return new Response(JSON.stringify({ error: 'businessName is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  const locationStr = city
    ? city + (country ? `, ${country}` : '')
    : 'Not provided';

  const prompt = `Generate a complete, valid JSON-LD schema markup object for a ${schemaType}.

Business: ${businessName}
Domain: ${domain}
Type: ${schemaType}
Description: ${description || 'Not provided'}
Location: ${locationStr}

Rules:
- Include "@context": "https://schema.org" and "@type": "${schemaType}"
- Include only properties supported by the supplied facts
- Omit unknown telephone, address, social links, prices, offers, availability, and results
- Never use placeholder contact details, price "0", empty sameAs arrays, or invented FAQ answers
- For SoftwareApplication: include applicationCategory and operatingSystem only when supported by the supplied description
- Use https://${domain} as the url
- Output ONLY the raw JSON object. No <script> tags. No markdown. No explanation.`;

  try {
    const stream = await (env.AI as any).run(CF_FAST_CHAT_MODEL, {
      prompt,
      stream: true,
      max_tokens: 900,
    });

    return new Response(stream as ReadableStream, {
      headers: { 'Content-Type': 'text/event-stream', ...CORS },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'AI unavailable — try again shortly' }), {
      status: 503, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }
}
