export interface MobileAuditResult {
  has_viewport_meta: boolean;
  viewport_content: string | null;
  has_touch_icons: boolean;
  has_responsive_images: boolean; // any img with srcset or sizes attr
  tap_target_issues: number;      // approximate count of very small linked elements
  font_size_ok: boolean;          // no inline style with font-size < 12px on body/p
  issues: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Extracts the value of a named attribute from a tag's attribute string
function extractAttr(attrs: string, name: string): string | null {
  const re = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]*))`,
    'i',
  );
  const m = attrs.match(re);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? '';
}

// Returns true if the attribute string contains an attribute name (presence check)
function hasAttr(attrs: string, name: string): boolean {
  return new RegExp(`(?:^|\\s)${name}(?:\\s*=|\\s|$)`, 'i').test(attrs);
}

// Extracts font-size px value from an inline style string; returns null if not found
function parseFontSizePx(style: string): number | null {
  const m = style.match(/font-size\s*:\s*([0-9]+(?:\.[0-9]+)?)px/i);
  if (!m) return null;
  return parseFloat(m[1]);
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function runMobileAudit(_domain: string, html: string): MobileAuditResult {
  // ── 1. Viewport meta ───────────────────────────────────────────────────────
  // <meta name="viewport" content="...">
  const viewportMetaRe = /<meta([^>]*?)>/gi;
  let has_viewport_meta = false;
  let viewport_content: string | null = null;

  for (const match of html.matchAll(viewportMetaRe)) {
    const attrs = match[1] ?? '';
    const nameVal = extractAttr(attrs, 'name');
    if (nameVal?.toLowerCase() === 'viewport') {
      has_viewport_meta = true;
      viewport_content = extractAttr(attrs, 'content');
      break;
    }
  }

  // ── 2. Touch icons ─────────────────────────────────────────────────────────
  // <link rel="apple-touch-icon"> or <link rel="icon">
  const LINK_RE = /<link([^>]*?)>/gi;
  let has_touch_icons = false;

  for (const match of html.matchAll(LINK_RE)) {
    const attrs = match[1] ?? '';
    const relVal = (extractAttr(attrs, 'rel') ?? '').toLowerCase();
    if (relVal === 'apple-touch-icon' || relVal === 'icon') {
      has_touch_icons = true;
      break;
    }
  }

  // ── 3. Responsive images ───────────────────────────────────────────────────
  // Check imgs for srcset/sizes, but skip tiny images (icons, logos, avatars < 150px)
  // that don't need responsive variants — flagging them is a false positive.
  const IMG_RE = /<img([^>]*?)(?:\/?>|>)/gi;
  let has_responsive_images = false;
  let meaningfulImgCount = 0;  // imgs large enough that srcset would matter

  for (const match of html.matchAll(IMG_RE)) {
    const attrs = match[1] ?? '';
    if (hasAttr(attrs, 'srcset') || hasAttr(attrs, 'sizes')) {
      has_responsive_images = true;
      break;
    }
    // Count images that are wide enough to benefit from srcset
    const widthStr = extractAttr(attrs, 'width');
    const widthPx = widthStr ? parseInt(widthStr, 10) : NaN;
    // If explicit width < 150 it's a logo/icon — skip
    if (!isNaN(widthPx) && widthPx < 150) continue;
    // If src contains logo/icon/avatar/favicon patterns, skip
    const src = extractAttr(attrs, 'src') ?? '';
    if (/logo|icon|avatar|favicon|sprite/i.test(src)) continue;
    meaningfulImgCount++;
  }

  // ── 4. Tap target issues ───────────────────────────────────────────────────
  // Count <a tags with inline style containing font-size < 12px
  // Regex matches opening <a ...> tags (not </a>)
  const ANCHOR_OPEN_RE = /<a(?:\s[^>]*)?\s+style\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]*))[^>]*>/gi;
  let tap_target_issues = 0;

  for (const match of html.matchAll(ANCHOR_OPEN_RE)) {
    const styleVal = match[1] ?? match[2] ?? match[3] ?? '';
    const fontSize = parseFontSizePx(styleVal);
    if (fontSize !== null && fontSize < 12) {
      tap_target_issues++;
    }
  }

  // ── 5. Font size check on body/p ──────────────────────────────────────────
  // True if no <p or <body tag has inline font-size < 12px
  const BODY_P_RE = /<(?:body|p)(?:\s[^>]*)?\s+style\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]*))[^>]*>/gi;
  let font_size_ok = true;

  for (const match of html.matchAll(BODY_P_RE)) {
    const styleVal = match[1] ?? match[2] ?? match[3] ?? '';
    const fontSize = parseFontSizePx(styleVal);
    if (fontSize !== null && fontSize < 12) {
      font_size_ok = false;
      break;
    }
  }

  // ── 6. Issues ──────────────────────────────────────────────────────────────
  const issues: string[] = [];

  if (!has_viewport_meta) {
    issues.push(
      'Missing viewport meta tag — page will not render correctly on mobile devices',
    );
  } else if (viewport_content !== null && !viewport_content.includes('width=device-width')) {
    issues.push(
      'Viewport meta does not set width=device-width — may cause mobile zoom issues',
    );
  }

  // Only flag srcset if there are meaningful (non-logo) images that would benefit
  if (!has_responsive_images && meaningfulImgCount >= 2) {
    issues.push(
      'No responsive images (srcset) detected — images may be oversized on mobile',
    );
  }

  if (tap_target_issues > 0) {
    issues.push(
      `${tap_target_issues} link(s) may have tap targets that are too small for mobile users`,
    );
  }

  if (!font_size_ok) {
    issues.push(
      'Very small inline font sizes detected — may be unreadable on mobile',
    );
  }

  return {
    has_viewport_meta,
    viewport_content,
    has_touch_icons,
    has_responsive_images,
    tap_target_issues,
    font_size_ok,
    issues,
  };
}
