import { parseHTML } from 'linkedom';
import { detectBotChallenge } from './bot-detection';

export function visiblePageText(html: string): string {
  if (!html) return '';
  try {
    const { document } = parseHTML(html);
    for (const element of document.querySelectorAll('script,style,noscript,template,svg')) {
      element.remove();
    }
    return (document.body?.textContent ?? document.documentElement?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return html
      .replace(/<(?:script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|template|svg)>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
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
  // still exposing no page content. Give semantic server-rendered content
  // priority over raw character counts so short, real pages are not rejected.
  let hasMeaningfulStructure = false;
  try {
    const { document } = parseHTML(html);
    const contentRoot = document.querySelector('main, article');
    const heading = contentRoot?.querySelector('h1') ?? document.querySelector('h1');
    const semanticText = (contentRoot?.textContent ?? '').replace(/\s+/g, ' ').trim();
    hasMeaningfulStructure = !!contentRoot && !!heading && semanticText.length >= 60;
  } catch {
    hasMeaningfulStructure = /<(?:main|article)\b[\s\S]*?<h1\b/i.test(html) && visibleText.length >= 60;
  }
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
