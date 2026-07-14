interface Env {
  UPSTREAM_ORIGIN: string;
}

const DEFAULT_UPSTREAM = 'https://sayori-geoscore.pages.dev';
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD', ...SECURITY_HEADERS },
      });
    }

    const upstreamOrigin = normalizeUpstream(env.UPSTREAM_ORIGIN);
    const upstreamUrl = buildUpstreamUrl(upstreamOrigin, url);
    let response = await fetch(upstreamUrl, proxyRequest(request));

    if (response.status === 404 && acceptsHtml(request)) {
      const fallbackUrl = new URL('/index.html', upstreamOrigin);
      fallbackUrl.search = url.search;
      response = await fetch(fallbackUrl, proxyRequest(request));
    }

    return withHeaders(response);
  },
};

function normalizeUpstream(value: string | undefined): string {
  const trimmed = value?.trim() || DEFAULT_UPSTREAM;
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'https:') throw new Error('UPSTREAM_ORIGIN must be https');
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function buildUpstreamUrl(origin: string, requestUrl: URL): URL {
  const upstreamUrl = new URL(requestUrl.pathname, origin);
  if (requestUrl.pathname === '/tools') upstreamUrl.pathname = '/tools.html';
  upstreamUrl.search = requestUrl.search;
  return upstreamUrl;
}

function proxyRequest(request: Request): RequestInit {
  const headers = new Headers(request.headers);
  headers.delete('Host');
  headers.delete('CF-Connecting-IP');
  headers.delete('CF-IPCountry');
  headers.delete('CF-Ray');
  headers.delete('X-Forwarded-For');
  return {
    method: request.method,
    headers,
    redirect: 'follow',
  };
}

function acceptsHtml(request: Request): boolean {
  const accept = request.headers.get('Accept') || '';
  return accept.includes('text/html') || accept.includes('*/*');
}

function withHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  headers.set('X-GeoScore-UI-Proxy', 'sayori-geoscore-ui');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
