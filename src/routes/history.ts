import type { Env } from '../lib/types';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

interface AuditRow {
  id: string;
  foundation_score: number | null; // stores seo_score
  weakness_score: number | null;   // stores geo_score
  created_at: number;
  completed_at: number | null;
  full_json: string | null;
}

export async function handleHistory(domain: string, env: Env): Promise<Response> {
  try {
    const biz = await env.DB.prepare(
      'SELECT id FROM businesses WHERE domain = ? LIMIT 1'
    ).bind(domain).first<{ id: number }>();

    if (!biz) {
      return new Response(JSON.stringify({ history: [] }), {
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    const rows = await env.DB.prepare(
      `SELECT id, foundation_score, weakness_score, created_at, completed_at, full_json
       FROM audits
       WHERE business_id = ? AND status = 'complete'
       ORDER BY COALESCE(completed_at, created_at) DESC, created_at DESC, id DESC
       LIMIT 20`
    ).bind(biz.id).all<AuditRow>();

    const history = (rows.results ?? [])
      .map(row => {
        const seo = row.foundation_score;
        const geo = row.weakness_score;
        let scoreVersion: string | null = null;
        let storedOverall: number | null | undefined;
        try {
          const parsed = row.full_json ? JSON.parse(row.full_json) : null;
          scoreVersion = parsed?.score_version ?? parsed?.score_summary?.score_version ?? null;
          if (parsed && Object.prototype.hasOwnProperty.call(parsed, 'overall_score')) {
            storedOverall = typeof parsed.overall_score === 'number' ? parsed.overall_score : null;
          } else if (parsed?.score_summary?.overall && Object.prototype.hasOwnProperty.call(parsed.score_summary.overall, 'score')) {
            storedOverall = typeof parsed.score_summary.overall.score === 'number'
              ? parsed.score_summary.overall.score
              : null;
          }
        } catch { /* legacy row with malformed or absent full JSON */ }
        return {
          audit_id: row.id,
          date: (row.completed_at ?? row.created_at) * 1000,
          seo_score: seo,
          geo_score: geo,
          overall_score: storedOverall !== undefined
            ? storedOverall
            : typeof seo === 'number' && typeof geo === 'number'
              ? Math.round(seo * 0.55 + geo * 0.45)
              : null,
          score_version: scoreVersion,
        };
      })
      .reverse(); // oldest first for sparkline

    return new Response(JSON.stringify({ history }), {
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  } catch {
    return new Response(JSON.stringify({ history: [] }), {
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }
}
