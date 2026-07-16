import type { Env } from '../lib/types';
import { CF_FAST_CHAT_MODEL } from '../lib/ai-models';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function handleSerpGen(req: Request, env: Env): Promise<Response> {
  let title = '';
  let description = '';
  let domain = '';

  try {
    const body = await req.json() as { title?: string; description?: string; domain?: string };
    title       = (body.title       ?? '').trim().slice(0, 300);
    description = (body.description ?? '').trim().slice(0, 500);
    domain      = (body.domain      ?? '').trim();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  if (!title && !description) {
    return new Response(JSON.stringify({ error: 'title or description required' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  const prompt = `You are an SEO copywriter. Rewrite a page title and meta description for optimal Google search appearance.

Output ONLY a raw JSON object — no markdown fences, no explanation, nothing else.

Input:
Title: ${title || '(none)'}
Description: ${description || '(none)'}
Domain: ${domain || '(unknown)'}

Requirements:
- "title": 50-60 characters. Keep the brand or product name. Make it specific and compelling. Hard limit: 60 chars.
- "description": 140-155 characters. Clear value proposition. Natural call to action. Hard limit: 155 chars.

Output the JSON object only, like this:
{"title": "...", "description": "..."}`;

  try {
    const result: unknown = await env.AI.run(CF_FAST_CHAT_MODEL, {
      prompt,
      stream: false,
      max_tokens: 250,
    } as Parameters<typeof env.AI.run>[1]);

    const response = result && typeof result === 'object'
      ? (result as { response?: unknown }).response
      : null;
    const raw = typeof response === 'string' ? response.trim() : '';

    // Extract a JSON object even if the model adds surrounding prose
    const match = raw.match(/\{[^{}]*"title"[^{}]*"description"[^{}]*\}/s)
                ?? raw.match(/\{[^{}]*"description"[^{}]*"title"[^{}]*\}/s);

    if (!match) {
      return new Response(JSON.stringify({ error: 'Unexpected AI response format', raw }), {
        status: 502, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    let parsed: { title?: string; description?: string };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return new Response(JSON.stringify({ error: 'Could not parse AI response', raw }), {
        status: 502, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    return new Response(
      JSON.stringify({
        title:       (parsed.title       ?? '').trim(),
        description: (parsed.description ?? '').trim(),
      }),
      { headers: { 'Content-Type': 'application/json', ...CORS } }
    );
  } catch {
    return new Response(JSON.stringify({ error: 'AI unavailable — try again shortly' }), {
      status: 503, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }
}
