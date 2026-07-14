export interface AccessibilityResult {
  wcag_checks: WcagCheck[];
  score: number;
  issues: string[];
  desktop_cwv: DesktopCwv | null;
  images_missing_alt: number;
  inputs_missing_label: number;
  links_generic_text: number;
  has_skip_link: boolean;
  has_aria_landmarks: boolean;
  color_scheme: string | null;
}

export interface WcagCheck {
  rule: string;
  passed: boolean;
  detail?: string;
  level: 'A' | 'AA';
}

export interface DesktopCwv {
  performance: number;
  accessibility_score: number;
  lcp_s: number | null;
  cls: number | null;
  fcp_s: number | null;
  ttfb_s: number | null;
  tbt_ms: number | null;
}

export async function runAccessibility(domain: string, html: string): Promise<AccessibilityResult> {
  // Empty HTML means the page could not be fetched (bot protection, timeout, etc.).
  // Return a neutral empty state rather than running checks against '' and producing
  // a false-perfect score (all regex tests would pass vacuously on an empty string).
  if (!html) {
    return {
      wcag_checks: [],
      score: 0,
      issues: ['Page content unavailable — accessibility checks skipped (bot protection or fetch failure)'],
      desktop_cwv: null,
      images_missing_alt: 0,
      inputs_missing_label: 0,
      links_generic_text: 0,
      has_skip_link: false,
      has_aria_landmarks: false,
      color_scheme: null,
    };
  }

  const issues: string[] = [];
  const checks: WcagCheck[] = [];

  // All findings are surfaced via wcag_checks[] which renders as a ✓/✗ checklist in the UI.
  // issues[] is intentionally NOT populated for individual check failures to avoid showing
  // the same information twice (once in the checklist, once as a bullet list below it).

  // 1.1.1 Images must have alt text
  const imgTags = [...html.matchAll(/<img[^>]+>/gi)];
  const imgsMissingAlt = imgTags.filter(m => !/alt=["'][^"']*["']/i.test(m[0])).length;
  checks.push({
    rule: 'Images have alt text (WCAG 1.1.1)',
    passed: imgsMissingAlt === 0,
    detail: imgsMissingAlt > 0 ? `${imgsMissingAlt} image(s) missing alt` : undefined,
    level: 'A',
  });

  // 1.3.1 Form inputs have labels
  const textInputs = [...html.matchAll(/<input[^>]+type=["'](?:text|email|tel|password|search|url|number)[^"']*["'][^>]*>/gi)];
  const inputsNoLabel = textInputs.filter(m => {
    const inputTag = m[0];
    // Accept ARIA labels: aria-label or aria-labelledby on the input itself
    if (/aria-label(?:ledby)?=/i.test(inputTag)) return false;
    const id = inputTag.match(/\bid=["']([^"']+)["']/i)?.[1];
    if (!id) return true;  // no id and no ARIA label → unlabelled
    return !new RegExp(`for=["']${id}["']`, 'i').test(html);
  }).length;
  checks.push({
    rule: 'Form inputs have labels (WCAG 1.3.1)',
    passed: inputsNoLabel === 0,
    detail: inputsNoLabel > 0 ? `${inputsNoLabel} input(s) missing label` : undefined,
    level: 'A',
  });

  // 2.4.1 Skip navigation link
  const hasSkipLink =
    /<a[^>]+href=["']#(?:main|content|maincontent|skip|primary)[^"']*["'][^>]*>/i.test(html) ||
    /<a[^>]+class=["'][^"']*skip[^"']*["'][^>]*>/i.test(html);
  checks.push({ rule: 'Skip navigation link (WCAG 2.4.1)', passed: hasSkipLink, level: 'A' });

  // 2.4.2 Page has a title
  const hasTitle = /<title[^>]*>[^<]+<\/title>/i.test(html);
  checks.push({ rule: 'Page has a <title> (WCAG 2.4.2)', passed: hasTitle, level: 'A' });

  // 3.1.1 Language of page
  const hasLang = /<html[^>]+lang=["'][a-z]{2}/i.test(html);
  checks.push({ rule: 'HTML lang attribute (WCAG 3.1.1)', passed: hasLang, level: 'A' });

  // ARIA landmarks
  const hasMain = /<main[\s>]|role=["']main["']/i.test(html);
  const hasNav = /<nav[\s>]|role=["']navigation["']/i.test(html);
  checks.push({
    rule: 'ARIA landmarks present (main, nav)',
    passed: hasMain && hasNav,
    detail: !hasMain ? 'Missing <main>' : (!hasNav ? 'Missing <nav>' : undefined),
    level: 'AA',
  });

  // 2.4.4 Links with generic text
  const genericLinkPattern = /<a\b[^>]*>\s*(?:click here|read more|here|learn more|more|link|this)\s*<\/a>/gi;
  const genericLinks = (html.match(genericLinkPattern) ?? []).length;
  checks.push({
    rule: 'Links have descriptive text (WCAG 2.4.4)',
    passed: genericLinks === 0,
    detail: genericLinks > 0 ? `${genericLinks} generic link(s)` : undefined,
    level: 'AA',
  });

  // Heading hierarchy — no skipped levels
  const hLevels = [...html.matchAll(/<h([1-6])[\s>]/gi)].map(m => Number(m[1]));
  let skippedHeading = false;
  let skippedDetail: string | undefined;
  for (let i = 1; i < hLevels.length; i++) {
    if (hLevels[i] - hLevels[i - 1] > 1) {
      skippedHeading = true;
      skippedDetail = `H${hLevels[i - 1]} → H${hLevels[i]} (skips H${hLevels[i - 1] + 1})`;
      break;
    }
  }
  checks.push({
    rule: 'Heading hierarchy (no skipped levels)',
    passed: !skippedHeading,
    detail: skippedDetail,
    level: 'AA',
  });

  // Color scheme / dark mode
  const colorSchemeVal = html.match(/color-scheme:\s*([^;'"]+)/i)?.[1]?.trim() ?? null;
  const hasDarkMode = colorSchemeVal !== null ||
    /<meta[^>]+name=["']color-scheme["'][^>]*content=["']([^"']+)["']/i.test(html);
  checks.push({ rule: 'Dark mode / color-scheme support', passed: hasDarkMode, level: 'AA' });

  const desktop_cwv: DesktopCwv | null = null;

  const passed = checks.filter(c => c.passed).length;
  const score = Math.round((passed / checks.length) * 100);

  return {
    wcag_checks: checks,
    score,
    issues: issues.slice(0, 6),
    desktop_cwv,
    images_missing_alt: imgsMissingAlt,
    inputs_missing_label: inputsNoLabel,
    links_generic_text: genericLinks,
    has_skip_link: hasSkipLink,
    has_aria_landmarks: hasMain && hasNav,
    color_scheme: colorSchemeVal,
  };
}
