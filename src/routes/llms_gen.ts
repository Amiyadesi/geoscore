import type { Env } from '../lib/types';
import { CF_FAST_CHAT_MODEL } from '../lib/ai-models';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function handleLlmsGen(req: Request, env: Env): Promise<Response> {
  let domain = '';
  let vertical = 'business';
  let keywords: string[] = [];
  let schemas: string[] = [];

  try {
    const body = await req.json() as {
      domain?: string;
      vertical?: string;
      keywords?: string[];
      schemas?: string[];
    };
    domain = (body.domain ?? '').trim();
    vertical = (body.vertical ?? 'business').trim();
    keywords = (body.keywords ?? []).slice(0, 12);
    schemas = (body.schemas ?? []).slice(0, 8);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  if (!domain || domain.length < 3) {
    return new Response(JSON.stringify({ error: 'domain required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  const kwList = keywords.length ? keywords.join(', ') : 'not specified';
  const schemaList = schemas.length ? schemas.join(', ') : 'none';

  const prompt = `Write a complete llms.txt file for the website ${domain}.

llms.txt is a plain-text file that helps AI language models (ChatGPT, Claude, Perplexity, Gemini) discover and understand a website's content. It is placed at https://${domain}/llms.txt.

Format rules:
- Start with "# ${domain}" as the H1 heading
- Next: 2-3 sentence description of what the site is and who it serves
- Section "## About": business overview, founding, mission
- Section "## Key Pages": list important pages as markdown links
  - Format: [Page Title](https://${domain}/path): brief description
- Section "## Topics Covered": bullet list of main subject areas (use the keywords)
- Section "## Schema Markup": note the structured data types implemented
- Section "## Canonical URL": state https://${domain}/

Context:
- Website: ${domain}
- Type: ${vertical}
- Key topics/keywords: ${kwList}
- Schema types implemented: ${schemaList}

Write ONLY the llms.txt content. No explanation, no preamble. Be specific and accurate. For pages you cannot know, use realistic generic paths like /about, /services, /contact, /blog.`;

  try {
    const stream: unknown = await env.AI.run(CF_FAST_CHAT_MODEL, {
      prompt,
      stream: true,
      max_tokens: 900,
    } as Parameters<typeof env.AI.run>[1]);
    if (!(stream instanceof ReadableStream)) throw new Error('Workers AI did not return a stream');

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        ...CORS,
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'AI unavailable — try again shortly' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }
}
