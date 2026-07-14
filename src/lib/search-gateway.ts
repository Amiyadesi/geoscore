import type { Env } from './types';
import { fetchWithTimeout, isValidHttpUrl } from './http';

export interface SearchGatewayResult {
  title: string;
  url: string;
  snippet: string;
}

interface SearchGatewayResponse {
  success?: boolean;
  provider?: string;
  results?: Array<{
    title?: unknown;
    url?: unknown;
    snippet?: unknown;
    content?: unknown;
  }>;
}

export async function searchGateway(
  env: Env,
  query: string,
  options: { provider?: string; maxResults?: number; timeoutMs?: number } = {},
): Promise<SearchGatewayResult[]> {
  const base = (env.SEARCH_GATEWAY_URL || env.SEARXNG_URL || '').trim().replace(/\/+$/, '');
  const apiKey = (env.SEARCH_GATEWAY_API_KEY || '').trim();
  const q = query.trim();
  if (!base || !apiKey || q.length < 2) return [];
  if (!isValidHttpUrl(base)) return [];

  const url = new URL('/search', base);
  url.searchParams.set('q', q.slice(0, 500));
  url.searchParams.set('provider', options.provider || 'auto');
  url.searchParams.set('max_results', String(Math.min(10, Math.max(1, options.maxResults ?? 3))));

  try {
    const response = await fetchWithTimeout(url.toString(), {
      timeoutMs: options.timeoutMs ?? 9000,
      headers: {
        Accept: 'application/json',
        'X-API-Key': apiKey,
      },
    });
    if (!response.ok) return [];

    const data = (await response.json().catch(() => null)) as SearchGatewayResponse | null;
    if (!data?.success || !Array.isArray(data.results)) return [];

    return data.results
      .map((item) => ({
        title: String(item.title || '').trim(),
        url: String(item.url || '').trim(),
        snippet: String(item.snippet || item.content || '').trim(),
      }))
      .filter((item) => item.title || item.snippet)
      .slice(0, Math.min(10, Math.max(1, options.maxResults ?? 3)));
  } catch {
    return [];
  }
}

export async function buildSearchEvidence(
  env: Env,
  queries: string[],
  maxChars = 1200,
  options: { timeoutMs?: number } = {},
): Promise<string> {
  // Search evidence refines keyword suggestions. It must not hold the audit open.
  const lookups = await Promise.allSettled(
    queries.slice(0, 3).map(query => searchGateway(env, query, {
      maxResults: 3,
      timeoutMs: options.timeoutMs ?? 2500,
    }).then(results => ({ query, results })))
  );
  const chunks: string[] = [];
  for (const lookup of lookups) {
    if (lookup.status !== 'fulfilled') continue;
    const { query, results } = lookup.value;
    if (!results.length) continue;
    const lines = results.map((result, index) => {
      const title = result.title || 'Untitled';
      const snippet = result.snippet || result.url;
      return `${index + 1}. ${title}: ${snippet}`.slice(0, 300);
    });
    chunks.push(`Query: ${query}\n${lines.join('\n')}`);
  }
  return chunks.join('\n\n').slice(0, maxChars);
}
