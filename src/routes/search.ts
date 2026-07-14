import type { Env } from '../lib/types';
import { resolveBusinessFromQuery } from '../modules/resolver';

export async function handleSearch(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim() ?? '';

  if (q.length < 2) {
    return jsonResponse([]);
  }

  try {
    const results = await resolveBusinessFromQuery(q, env);
    return jsonResponse(results.slice(0, 8));
  } catch (err) {
    return jsonResponse([], 500);
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
