import type { Env } from '../lib/types';

interface Row { id: number; name: string; domain: string; city: string; category: string }

export async function handleBusinesses(env: Env): Promise<Response> {
  try {
    const { results } = await env.DB.prepare(
      'SELECT id, name, domain, city, category FROM businesses ORDER BY name LIMIT 300'
    ).all<Row>();
    return new Response(JSON.stringify(results), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch {
    return new Response('[]', {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
