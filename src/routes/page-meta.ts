import { classifyAuditPageType, fetchAuditPage, validatePublicAuditUrl } from '../lib/audit-pages';
import { jsonError } from '../lib/security';
import { extractPageMeta } from '../modules/technical_seo';

function resolveMetadataUrl(value: string | null, baseUrl: string): string | null {
  if (!value) return null;
  try {
    const resolved = new URL(value, baseUrl);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.toString() : null;
  } catch {
    return null;
  }
}

export async function handlePageMetaPreview(requestUrl: URL): Promise<Response> {
  const targetUrl = validatePublicAuditUrl(requestUrl.searchParams.get('url') ?? '');
  if (!targetUrl) return jsonError('A public HTTP(S) URL is required', 400);

  const page = await fetchAuditPage({
    url: targetUrl,
    page_type: classifyAuditPageType(targetUrl),
    source: 'requested',
  });
  if (page.status !== 'complete') {
    return new Response(JSON.stringify({
      ok: false,
      error: {
        code: page.error_code ?? 'PAGE_META_FETCH_FAILED',
        message: 'The public page could not be read',
        retryable: page.error_code === 'AUDIT_TIMEOUT' || /^AUDIT_HTTP_5/.test(page.error_code ?? ''),
      },
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const meta = extractPageMeta(page.html);
  const finalUrl = page.final_url || targetUrl;
  const missing = [
    ['og:title', meta.og_title],
    ['og:description', meta.og_description],
    ['og:image', meta.og_image],
    ['og:type', meta.og_type],
  ].filter(([, value]) => !value).map(([name]) => name);

  return new Response(JSON.stringify({
    ok: true,
    data: {
      source_url: targetUrl,
      final_url: finalUrl,
      title: meta.og_title ?? meta.twitter_title ?? meta.title,
      description: meta.og_description ?? meta.twitter_description ?? meta.description,
      image: resolveMetadataUrl(meta.og_image ?? meta.twitter_image, finalUrl),
      site_name: meta.og_site_name ?? new URL(finalUrl).hostname,
      type: meta.og_type,
      canonical_url: resolveMetadataUrl(meta.canonical_url, finalUrl),
      twitter_card: meta.twitter_card,
      missing,
      stored: false,
    },
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
