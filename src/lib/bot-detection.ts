/**
 * Centralised bot-challenge / WAF interstitial detection.
 *
 * When a WAF (Cloudflare, Imperva, Akamai, Kasada, Datadome, etc.) blocks an
 * automated request it serves a challenge / CAPTCHA / interstitial page instead
 * of the real homepage.  These pages typically have:
 *   - A `noindex` directive (preventing them from entering search indexes)
 *   - Minimal or zero real business content
 *   - Challenge-specific keywords in the <title> and visible body
 *   - A URL path that contains "captcha", "challenge", "blocked", etc.
 *   - An HTTP 403 status code
 *
 * Running SEO / GEO analysis on a challenge page produces entirely false results:
 * noindex flagged as a critical issue, zero schema, no H1/H2, thin content,
 * missing contact info — all false positives that destroy user trust.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THIS IS THE SINGLE SOURCE OF TRUTH FOR BOT-CHALLENGE DETECTION.
 * Do NOT duplicate these patterns in individual modules.  Import from here.
 * ──────────────────────────────────────────────────────────────────────────────
 */

export interface BotChallengeResult {
  isChallenge: boolean;
  /** Human-readable explanation of why this page was classified as a challenge. */
  reason?: string;
}

// ── Pattern library ────────────────────────────────────────────────────────────

/**
 * URL path segments that WAFs use for their challenge / interstitial pages.
 * Matched against `new URL(finalUrl).pathname` (case-insensitive).
 *
 * Real examples:
 *   /captchaChallenge   — Bayut / DataDome
 *   /challenge          — generic
 *   /bot-check          — generic WAF
 *   /security-check     — generic WAF
 *   /ddos-protection    — old Cloudflare path
 *   /waf-challenge      — generic
 */
const CHALLENGE_URL_RE =
  /\/(?:captcha|captchaChallenge|challenge|bot[-_]check|security[-_]check|blocked|interstitial|human[-_]check|verify[-_]human|ddos[-_]protection|waf[-_]challenge|access[-_]denied|checkpoint)/i;

/**
 * <title> patterns that unambiguously identify WAF challenge pages.
 *
 * Real examples:
 *   "Captcha | Bayut"                          — DataDome / Bayut
 *   "Just a moment..."                         — Cloudflare
 *   "Attention Required!"                      — Cloudflare
 *   "Access Denied"                            — generic WAF
 *   "Security Check"                           — generic
 *   "DDoS protection by Cloudflare"
 *   "Please wait... | Checking..."
 *   "Are You Human?"
 *   "526 Invalid SSL certificate | Cloudflare" — Cloudflare origin SSL error
 *   "520 Web server returns an unknown error"  — Cloudflare 5xx series
 *   "521 Web server is down | Cloudflare"
 */
const CHALLENGE_TITLE_RE =
  /\b(?:captcha|attention required|just a moment|access denied|security check|ddos protection|bot check|are you human|verify you are human|human verification|you(?:'ve| have) been blocked|please wait|checking your browser|ray id|almost there|invalid ssl certificate|ssl handshake failed|web server is down|origin is unreachable|error 52[0-9]|cloudflare error)\b/i;

/**
 * Visible-text keyword patterns present in WAF / bot-challenge page bodies.
 * Scanned against the first 5 000 characters of raw HTML for performance.
 *
 * Uses a non-backtracking pattern (`[^.]{0,40}` instead of `.*?`) to stay
 * efficient on large pages and avoid ReDoS.
 *
 * Cloudflare error pages (520–530) always contain "Ray ID:" in the footer.
 * The 526 page body reads "Invalid SSL certificate" prominently.
 * These patterns catch Cloudflare origin errors that serve no real content.
 */
const CHALLENGE_CONTENT_RE =
  /\b(?:captcha|captcha\s+challenge|security\s+check|enable\s+javascript|javascript[^.]{0,40}disabl|security\s+service|checking\s+your\s+browser|attention\s+required|just\s+a\s+moment|access\s+denied|please\s+enable|ddos\s+protection|human\s+verification|are\s+you[^.]{0,20}human|verify[^.]{0,20}human|verify\s+you\s+are\s+human|blocked[^.]{0,20}request|unsupported\s+client|please\s+update\s+your\s+browser|update\s+your\s+browser|browser\s+not\s+supported|browser\s+is\s+not\s+supported|this\s+browser[^.]{0,20}not\s+supported|your\s+browser[^.]{0,20}not\s+supported|not\s+supported[^.]{0,20}browser|ray\s+id\b|invalid\s+ssl\s+certificate|ssl\s+handshake\s+failed|web\s+server\s+(?:is\s+)?down|origin\s+(?:is\s+)?unreachable|error\s+52[0-9])\b/i;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Detect whether the fetched page is a WAF bot-challenge page rather than the
 * real homepage.
 *
 * Detection runs in order of confidence / cheapness:
 *   1. HTTP 403 — server explicitly refused the request
 *   2. Final URL path — WAFs redirect to a dedicated challenge URL
 *   3. HTML <title> tag — cheap string match, very reliable
 *   4. Body keyword scan — catches inline challenge content (first 5 KB only)
 *
 * @param html        Raw HTML returned by the HTTP fetch (may be empty string)
 * @param finalUrl    The URL after following all redirects (`pageRes.url`)
 * @param statusCode  HTTP response status code
 */
export function detectBotChallenge(
  html: string,
  finalUrl?: string,
  statusCode?: number,
): BotChallengeResult {

  // 1. HTTP 403 — explicit block; no content analysis needed.
  //    Cloudflare 5xx error codes (520–530) are also all-Cloudflare error pages
  //    with no real business content (no schema, no text, no usable signals).
  if (statusCode === 403) {
    return {
      isChallenge: true,
      reason: 'HTTP 403 Forbidden — request blocked by server or WAF',
    };
  }
  if (statusCode !== undefined && statusCode >= 520 && statusCode <= 530) {
    return {
      isChallenge: true,
      reason: `Cloudflare origin error HTTP ${statusCode} — no real content served`,
    };
  }

  // 2. Final URL path — WAFs redirect to a predictable challenge sub-path
  if (finalUrl) {
    try {
      const { pathname } = new URL(finalUrl);
      if (CHALLENGE_URL_RE.test(pathname)) {
        return {
          isChallenge: true,
          reason: `Bot-challenge URL path detected: ${pathname}`,
        };
      }
    } catch { /* malformed URL — skip this layer */ }
  }

  // 3. <title> tag — cheap, high-signal
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '';
  if (title && CHALLENGE_TITLE_RE.test(title)) {
    return {
      isChallenge: true,
      reason: `Bot-challenge page title: "${title.trim()}"`,
    };
  }

  // 4. Body keyword scan — first 5 000 chars only for performance
  if (html && CHALLENGE_CONTENT_RE.test(html.slice(0, 5000))) {
    return {
      isChallenge: true,
      reason: 'Bot-challenge keywords detected in page content',
    };
  }

  return { isChallenge: false };
}

/**
 * Boolean convenience wrapper — use when you only need a true/false answer.
 *
 * All three parameters are optional so existing call sites that only pass
 * the visible page text (stripped HTML) continue to work without changes.
 */
export function isBotChallengePage(
  html: string,
  finalUrl?: string,
  statusCode?: number,
): boolean {
  return detectBotChallenge(html, finalUrl, statusCode).isChallenge;
}
