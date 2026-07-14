import type { Env } from '../lib/types';
import { cacheKey } from '../lib/cache';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

export async function handleFeedback(req: Request, env: Env): Promise<Response> {
  try {
    const body = await req.json() as {
      domain: string;
      module: string;
      field: string;
      reported_value?: string;
      correct_value?: string;
    };

    if (!body.domain || !body.module || !body.field) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: CORS });
    }

    const domain = body.domain.toLowerCase().trim();

    // 1. Store raw feedback
    await env.DB.prepare(
      `INSERT INTO feedback (domain, module, field, reported_value, correct_value)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(domain, body.module, body.field, body.reported_value ?? null, body.correct_value ?? null).run();

    // 2. If it's a vertical correction — update domain_overrides
    if (body.field === 'vertical' && body.correct_value) {
      const existing = await env.DB.prepare(
        `SELECT confidence FROM domain_overrides WHERE domain = ?`
      ).bind(domain).first<{ confidence: number }>();

      if (existing) {
        await env.DB.prepare(
          `UPDATE domain_overrides SET vertical = ?, confidence = confidence + 1, updated_at = unixepoch()
           WHERE domain = ?`
        ).bind(body.correct_value, domain).run();
      } else {
        await env.DB.prepare(
          `INSERT INTO domain_overrides (domain, vertical, confidence, source)
           VALUES (?, ?, 1, 'user')`
        ).bind(domain, body.correct_value).run();
      }

      // 3. Store in Vectorize for similarity learning (if we have a page fingerprint)
      // reported_value carries the page fingerprint text for vertical corrections
      if (body.reported_value) {
        try {
          const embedding = await env.AI.run('@cf/baai/bge-small-en-v1.5', {
            text: body.reported_value,
          } as Parameters<typeof env.AI.run>[1]) as { data: number[][] };

          if (embedding?.data?.[0]) {
            const vectorId = `${domain}-${Date.now()}`;
            await (env.VECTORS as any).upsert([{
              id: vectorId,
              values: embedding.data[0],
              metadata: { domain, vertical: body.correct_value },
            }]);
          }
        } catch { /* Vectorize is best-effort */ }
      }

      // 4. Clear the audit cache so next visit gets fresh results with the override applied
      await env.AUDIT_KV.delete(cacheKey(domain));
    }

    // 5. Update accuracy_metrics
    const now = new Date();
    const weekNum = Math.ceil(now.getDate() / 7);
    const week = `${now.toISOString().slice(0, 7)}-W${weekNum}`;
    await env.DB.prepare(
      `INSERT INTO accuracy_metrics (week, module, total, corrections) VALUES (?, ?, 0, 1)
       ON CONFLICT(week, module) DO UPDATE SET corrections = corrections + 1`
    ).bind(week, body.module).run();

    return new Response(
      JSON.stringify({ ok: true, cache_cleared: body.field === 'vertical' }),
      { headers: CORS }
    );

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS });
  }
}

export async function handleLearningAdmin(env: Env): Promise<Response> {
  const [overrides, topFeedback, accuracy] = await Promise.all([
    env.DB.prepare(
      `SELECT domain, vertical, location, confidence, source, updated_at
       FROM domain_overrides ORDER BY confidence DESC, updated_at DESC LIMIT 50`
    ).all(),
    env.DB.prepare(
      `SELECT domain, module, field, reported_value, correct_value, COUNT(*) as cnt
       FROM feedback GROUP BY domain, module, field, correct_value
       ORDER BY cnt DESC LIMIT 20`
    ).all(),
    env.DB.prepare(
      `SELECT week, module, total, corrections,
              ROUND((1.0 - CAST(corrections AS REAL) / MAX(total, 1)) * 100, 1) as accuracy_pct
       FROM accuracy_metrics ORDER BY week DESC, corrections DESC LIMIT 40`
    ).all(),
  ]);

  return new Response(JSON.stringify({
    overrides: overrides.results,
    top_corrections: topFeedback.results,
    accuracy_metrics: accuracy.results,
  }), { headers: CORS });
}
