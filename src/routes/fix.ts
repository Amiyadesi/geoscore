import type { Env } from '../lib/types';
import { CF_CHAT_MODEL } from '../lib/ai-models';

export async function handleFix(req: Request, env: Env): Promise<Response> {
  let body: { domain?: string; title?: string; why?: string; template_id?: string };
  try {
    body = await req.json() as typeof body;
  } catch {
    return new Response('{"error":"invalid JSON body"}', { status: 400 });
  }
  const domain = (body.domain ?? '').trim();
  const title  = (body.title  ?? '').trim();
  const why    = (body.why    ?? '').trim();

  if (!title) {
    return new Response('{"error":"title required"}', { status: 400 });
  }

  const prompt =
    `You are an expert SEO and GEO (Generative Engine Optimization) consultant.\n` +
    `Website being fixed: ${domain || 'unknown'}\n\n` +
    `Issue identified: ${title}\n` +
    `Why it matters: ${why}\n\n` +
    `Write a complete, practical fix guide for a business owner and their developer.\n` +
    `Structure it as numbered steps. For each step:\n` +
    `- Be specific and actionable\n` +
    `- Include copy-paste code snippets (JSON-LD, HTML, robots.txt, etc.) where relevant\n` +
    `- Explain WHY each step matters in one sentence\n` +
    `End with a "Verify" section so they know the fix worked.\n` +
    `Keep each step concise. No filler text.`;

  let aiResult: unknown;
  try {
    aiResult = await env.AI.run(CF_CHAT_MODEL, {
      messages: [
        {
          role: 'system',
          content: 'You are a precise technical SEO and GEO consultant. Write complete, copy-paste-ready fix guides. Use numbered steps. Show exact code. No marketing language.',
        },
        { role: 'user', content: prompt },
      ],
      stream: true,
    } as Parameters<typeof env.AI.run>[1]);
  } catch {
    const errMsg = 'data: {"response":"AI is temporarily unavailable — please try again in a moment."}\ndata: [DONE]\n\n';
    return new Response(errMsg, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  return new Response(aiResult as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
