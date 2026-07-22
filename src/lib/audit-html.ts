import { detectBotChallenge } from './bot-detection';

export function visiblePageText(html: string): string {
  if (!html) return '';
  // This helper runs before every page audit. Keep it linear and parser-free:
  // a full DOM parse of a 500 KB homepage costs more CPU than the actual checks.
  return html
    .replace(/<(?:script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|template|svg)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Conservative heuristic for an app shell that has scripts but no useful rendered text. */
export function detectJavaScriptShell(html: string): boolean {
  if (!html || !/<script\b/i.test(html)) return false;
  const visibleText = visiblePageText(html);
  const scriptCount = (html.match(/<script\b/gi) ?? []).length;
  const shellMarker = /<(?:div|main|section)\b[^>]*(?:id|data-reactroot)=["'](?:root|app|__next|__nuxt|svelte|gatsby-focus-wrapper)["'][^>]*>\s*<\/(?:div|main|section)>/i.test(html)
    || /<(?:div|main)\b[^>]*id=["'](?:root|app|__next|__nuxt)["'][^>]*>/i.test(html)
    || /\b(?:__NEXT_DATA__|__NUXT__|hydrateRoot|createRoot\s*\(|webpackChunk)\b/.test(html);

  // A consent/navigation shell can contain a surprising amount of text while
  // still exposing no page content. Check the same semantic signals without
  // reparsing the whole document with linkedom.
  const hasMeaningfulStructure = /<(?:main|article)\b/i.test(html)
    && /<h1\b/i.test(html)
    && visibleText.length >= 60;
  if (hasMeaningfulStructure) return false;

  const sparseLargeDocument = visibleText.length < 240
    && scriptCount >= 6
    && html.length >= 256 * 1024
    && !/<(?:main|article)\b/i.test(html);
  return shellMarker || sparseLargeDocument || (visibleText.length < 40 && scriptCount >= 2);
}

export function titleFromHtml(html: string): string | undefined {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return title || undefined;
}

export function challengeReason(html: string, finalUrl: string, statusCode: number): string | undefined {
  const challenge = detectBotChallenge(html, finalUrl, statusCode);
  if (!challenge.isChallenge) return undefined;
  // A rendered SPA can retain a harmless <noscript>Please enable JavaScript</noscript>
  // alongside real content. Do not reject rich rendered pages on that weak body-only signal.
  if (challenge.reason === 'Bot-challenge keywords detected in page content' && visiblePageText(html).length >= 300) {
    return undefined;
  }
  return challenge.reason ?? 'Bot challenge detected';
}

export function pageLocale(html: string): string | undefined {
  const explicit = html.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1]?.trim();
  if (explicit) return explicit;
  const text = html.replace(/<[^>]+>/g, ' ').slice(0, 3000);
  return /[\u3400-\u9fff]/.test(text) ? 'zh-CN' : undefined;
}
