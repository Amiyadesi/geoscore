import type { Env } from '../lib/types';
import { CF_CHAT_MODEL } from '../lib/ai-models';
import { CHAT_SYSTEM } from '../prompts';

export async function handleChat(req: Request, auditId: string, env: Env, ctx: ExecutionContext): Promise<Response> {
  let body: { question?: string; session_id?: string };
  try {
    body = await req.json() as { question?: string; session_id?: string };
  } catch {
    return new Response('{"error":"invalid JSON body"}', {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const question = body.question?.trim() ?? '';
  const sessionId = body.session_id ?? crypto.randomUUID();

  if (!question) {
    return new Response('{"error":"question required"}', {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Load audit data
  const audit = await env.DB.prepare(
    'SELECT full_json, summary_json FROM audits WHERE id = ?'
  ).bind(auditId).first<{ full_json: string; summary_json: string }>();

  if (!audit) {
    return new Response('{"error":"audit not found"}', {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Load recent chat history
  const history = await env.DB.prepare(
    `SELECT role, content FROM chat_history
     WHERE audit_id = ? AND session_id = ?
     ORDER BY created_at ASC LIMIT 10`
  ).bind(auditId, sessionId).all<{ role: string; content: string }>();

  // Save user message
  await env.DB.prepare(
    `INSERT INTO chat_history (audit_id, session_id, role, content) VALUES (?, ?, 'user', ?)`
  ).bind(auditId, sessionId, question).run();

  // Build context (truncate audit to save tokens)
  const auditContext = audit.full_json
    ? JSON.stringify(JSON.parse(audit.full_json)).slice(0, 6000)
    : audit.summary_json ?? '';

  const messages = [
    { role: 'system' as const, content: `${CHAT_SYSTEM}\n\nAUDIT DATA:\n${auditContext}` },
    ...history.results.map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
    { role: 'user' as const, content: question },
  ];

  // Stream response
  let aiResult: unknown;
  try {
    aiResult = await env.AI.run(CF_CHAT_MODEL, {
      messages,
      stream: true,
    } as Parameters<typeof env.AI.run>[1]);
  } catch {
    const errMsg = 'data: {"response":"AI is temporarily unavailable — please try again in a moment."}\ndata: [DONE]\n\n';
    return new Response(errMsg, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // Save assistant response (best-effort, async)
  const [stream1, stream2] = (aiResult as unknown as ReadableStream).tee();

  // Collect full response to save to history
  const saveToHistory = async () => {
    const reader = stream2.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        // Parse SSE chunks from Workers AI stream
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
        for (const line of lines) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.response) fullText += data.response;
          } catch { /* skip */ }
        }
      }
      if (fullText) {
        await env.DB.prepare(
          `INSERT INTO chat_history (audit_id, session_id, role, content) VALUES (?, ?, 'assistant', ?)`
        ).bind(auditId, sessionId, fullText).run();
      }
    } catch { /* non-critical */ }
  };

  // Keep Worker alive until history is saved
  ctx.waitUntil(saveToHistory());

  return new Response(stream1, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'X-Session-Id': sessionId,
    },
  });
}
