import { fetchWithTimeout } from '../lib/http';

export interface SecurityAuditResult {
  grade: string;
  score: number;
  tests_passed: number;
  tests_failed: number;
  tests_quantity: number;
  tests: SecurityTest[];
  issues: string[];
  hsts_preload_status: 'preloaded' | 'pending' | 'unknown' | 'rejected' | 'removed' | null;
  security_txt: {
    present: boolean;
    contact: string | null;
    expires: string | null;
    is_expired: boolean;
  } | null;
  permissions_policy: string | null;
}

export interface SecurityTest {
  key: string;
  name: string;
  passed: boolean;
  score_modifier: number;
  result: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'pass';
  description: string;
  recommendation: string;
  detail: string;
}

const TEST_NAMES: Record<string, string> = {
  antiClickjacking:            'Anti-Clickjacking (X-Frame-Options)',
  contentSecurityPolicy:       'Content Security Policy (CSP)',
  cookies:                     'Secure Cookie Configuration',
  crossOriginResourceSharing:  'CORS Policy',
  httpStrictTransportSecurity: 'HTTP Strict Transport Security (HSTS)',
  redirectionToHttps:          'HTTPS Redirect',
  referrerPolicy:              'Referrer Policy',
  subresourceIntegrity:        'Subresource Integrity (SRI)',
  xContentTypeOptions:         'X-Content-Type-Options',
  crossOriginOpenerPolicy:     'Cross-Origin Opener Policy (COOP)',
  permissionsPolicy:           'Permissions Policy',
};

const TEST_DESCRIPTIONS: Record<string, string> = {
  antiClickjacking:            'Prevents your site from being embedded in iframes on other domains — blocks clickjacking attacks where attackers overlay invisible frames to steal clicks.',
  contentSecurityPolicy:       'Restricts which scripts, styles and resources can load on your page — the primary defence against Cross-Site Scripting (XSS) attacks.',
  cookies:                     'Verifies session cookies carry Secure, HttpOnly and SameSite flags — without these, cookies can be stolen via network interception or malicious scripts.',
  crossOriginResourceSharing:  'Controls which external origins can make requests to your site — a misconfigured CORS policy can expose private data to attacker-controlled sites.',
  httpStrictTransportSecurity: 'Instructs browsers to only connect via HTTPS — prevents SSL stripping attacks and accidental plain-HTTP connections.',
  redirectionToHttps:          'Verifies the site is accessible over HTTPS — without this, users transmit data unencrypted.',
  referrerPolicy:              'Controls how much URL information is sent to third parties — leaking full URLs can expose tokens, user paths or sensitive query parameters.',
  subresourceIntegrity:        'Verifies external scripts and stylesheets have cryptographic hash checks — prevents a compromised CDN from serving malicious code to your users.',
  xContentTypeOptions:         'Prevents browsers from guessing content types (MIME sniffing) — stops certain attacks where uploaded files are executed as scripts.',
  crossOriginOpenerPolicy:     'Isolates your page from cross-origin popups — required for safe high-resolution timers and protection against Spectre-style side-channel attacks.',
};

const TEST_RECOMMENDATIONS: Record<string, string> = {
  antiClickjacking:            'Add response header: X-Frame-Options: SAMEORIGIN — or use CSP frame-ancestors directive for more granular control.',
  contentSecurityPolicy:       "Start with Content-Security-Policy: default-src 'self'; script-src 'self' — then expand per resource type. Use report-only mode first to avoid breaking the site.",
  cookies:                     'Set the Secure, HttpOnly and SameSite=Strict (or Lax) flags on all session cookies. In most frameworks this is a one-line config change.',
  crossOriginResourceSharing:  "Replace wildcard Access-Control-Allow-Origin: * with your specific trusted origins. Never combine * with credentials.",
  httpStrictTransportSecurity: 'Add header: Strict-Transport-Security: max-age=63072000; includeSubDomains; preload — then submit to hstspreload.org.',
  redirectionToHttps:          'Configure your web server or CDN to 301-redirect all http:// requests to https://.',
  referrerPolicy:              'Add header: Referrer-Policy: strict-origin-when-cross-origin — safe default for virtually all sites.',
  subresourceIntegrity:        'For each external <script src="..."> and <link href="...">, add integrity="sha384-..." crossorigin="anonymous". Use srihash.com to generate hashes.',
  xContentTypeOptions:         'Add header: X-Content-Type-Options: nosniff — a single line in your server or CDN config.',
  crossOriginOpenerPolicy:     'Add header: Cross-Origin-Opener-Policy: same-origin — test first as it can break OAuth and payment popups.',
};

function getSeverity(modifier: number, passed: boolean): 'critical' | 'high' | 'medium' | 'low' | 'pass' {
  if (passed) return 'pass';
  if (modifier <= -20) return 'critical';
  if (modifier <= -10) return 'high';
  if (modifier <= -5)  return 'medium';
  return 'low';
}

// ── Observatory: grade + score only (v2 API does not expose per-test data) ──────
async function fetchObservatoryGrade(domain: string): Promise<{
  grade: string; score: number; tests_passed: number; tests_failed: number; tests_quantity: number;
} | null> {
  try {
    const res = await fetch(
      `https://observatory-api.mdn.mozilla.net/api/v2/scan?host=${encodeURIComponent(domain)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'hidden=true',
        signal: AbortSignal.timeout(20000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json() as {
      grade?: string; score?: number; tests_passed?: number; tests_failed?: number;
      tests_quantity?: number; error?: string | null;
    };
    if (data.error) return null;
    return {
      grade:          data.grade ?? 'F',
      score:          Math.min(100, Math.max(0, data.score ?? 0)),
      tests_passed:   data.tests_passed  ?? 0,
      tests_failed:   data.tests_failed  ?? 0,
      tests_quantity: data.tests_quantity ?? 10,
    };
  } catch {
    return null;
  }
}

// ── Direct header analysis: the actual per-test breakdown ────────────────────
function analyzeHeaders(html: string, headers: Headers): SecurityTest[] {
  const hdrs: Record<string, string> = {};
  const httpsOk = html.length > 0;
  let cookieStr = '';

  headers.forEach((v, k) => { hdrs[k.toLowerCase()] = v; });
  // Use getAll() if available (CF Workers) to avoid joining multiple Set-Cookie headers
  // into one comma-separated string (which breaks parsing of cookies with dates in values)
  const rawCookies: string[] = typeof (headers as any).getAll === 'function'
    ? (headers as any).getAll('set-cookie') as string[]
    : (hdrs['set-cookie'] ? [hdrs['set-cookie']] : []);
  cookieStr = rawCookies.join('\n'); // use newline as safe separator for the split below
  const htmlBody = html.slice(0, 12000);

  const csp  = hdrs['content-security-policy'] ?? '';
  const hsts = hdrs['strict-transport-security'] ?? '';
  const xfo  = hdrs['x-frame-options'] ?? '';
  const xcto = hdrs['x-content-type-options'] ?? '';
  const rp   = hdrs['referrer-policy'] ?? '';
  const coop = hdrs['cross-origin-opener-policy'] ?? '';
  const acao = hdrs['access-control-allow-origin'] ?? '';

  const tests: SecurityTest[] = [];

  // ── 1. CSP ────────────────────────────────────────────────────────────────
  {
    const present      = !!csp;
    const unsafeInline = csp.includes("'unsafe-inline'");
    const unsafeEval   = csp.includes("'unsafe-eval'");
    const passed       = present && !unsafeInline && !unsafeEval;
    const modifier     = !present ? -25 : unsafeEval ? -20 : unsafeInline ? -10 : 0;
    const result       = !present ? 'csp-not-implemented' : unsafeEval ? 'csp-implemented-with-unsafe-eval' : unsafeInline ? 'csp-implemented-with-unsafe-inline' : 'csp-implemented';
    const detail       = present ? `${csp.slice(0, 180)}${csp.length > 180 ? '…' : ''}` : 'Header not present in response';
    tests.push({ key: 'contentSecurityPolicy', name: TEST_NAMES.contentSecurityPolicy, passed, score_modifier: modifier, result, severity: getSeverity(modifier, passed), description: TEST_DESCRIPTIONS.contentSecurityPolicy, recommendation: passed ? '' : TEST_RECOMMENDATIONS.contentSecurityPolicy, detail });
  }

  // ── 2. Anti-Clickjacking ─────────────────────────────────────────────────
  {
    const hasFrameAncestors = csp.includes('frame-ancestors');
    const xfoPassed = !!xfo && !xfo.toLowerCase().startsWith('allow-from') && xfo.toUpperCase() !== 'ALLOWALL';
    const passed    = xfoPassed || hasFrameAncestors;
    const modifier  = passed ? 0 : -20;
    const detail    = xfo ? `X-Frame-Options: ${xfo}` : hasFrameAncestors ? 'Protected via CSP frame-ancestors directive' : 'Neither X-Frame-Options nor CSP frame-ancestors present';
    tests.push({ key: 'antiClickjacking', name: TEST_NAMES.antiClickjacking, passed, score_modifier: modifier, result: passed ? 'x-frame-options-implemented' : 'x-frame-options-not-implemented', severity: getSeverity(modifier, passed), description: TEST_DESCRIPTIONS.antiClickjacking, recommendation: passed ? '' : TEST_RECOMMENDATIONS.antiClickjacking, detail });
  }

  // ── 3. HSTS ──────────────────────────────────────────────────────────────
  {
    const present = !!hsts;
    let passed = false; let modifier = -10; let result = 'hsts-not-implemented'; let detail = 'Header not present';
    if (present) {
      const maxAge = parseInt((hsts.match(/max-age=(\d+)/i) ?? [])[1] ?? '0');
      if (maxAge >= 15768000) {
        passed = true; modifier = 0; result = 'hsts-implemented';
        detail = `max-age=${maxAge}${hsts.includes('includeSubDomains') ? '; includeSubDomains' : ''}${hsts.includes('preload') ? '; preload' : ''}`;
      } else {
        modifier = -5; result = 'hsts-implemented-max-age-less-than-six-months';
        detail = `max-age=${maxAge} — below the required 6-month minimum (15,768,000 s)`;
      }
    }
    tests.push({ key: 'httpStrictTransportSecurity', name: TEST_NAMES.httpStrictTransportSecurity, passed, score_modifier: modifier, result, severity: getSeverity(modifier, passed), description: TEST_DESCRIPTIONS.httpStrictTransportSecurity, recommendation: passed ? '' : TEST_RECOMMENDATIONS.httpStrictTransportSecurity, detail });
  }

  // ── 4. HTTPS redirect ────────────────────────────────────────────────────
  {
    const passed = httpsOk;
    const modifier = passed ? 0 : -20;
    tests.push({ key: 'redirectionToHttps', name: TEST_NAMES.redirectionToHttps, passed, score_modifier: modifier, result: passed ? 'redirection-to-https' : 'hsts-not-implemented-no-https', severity: getSeverity(modifier, passed), description: TEST_DESCRIPTIONS.redirectionToHttps, recommendation: passed ? '' : TEST_RECOMMENDATIONS.redirectionToHttps, detail: passed ? 'Site reachable and responding over HTTPS' : 'HTTPS endpoint not reachable or returned server error' });
  }

  // ── 5. Referrer-Policy ───────────────────────────────────────────────────
  {
    const present = !!rp;
    const unsafe  = ['unsafe-url', 'origin-when-cross-origin', 'no-referrer-when-downgrade'].includes(rp.toLowerCase().trim());
    const passed  = present && !unsafe;
    const modifier = passed ? 0 : -5;
    const detail   = rp ? `Value: ${rp}${unsafe ? ' — leaks full URL cross-origin' : ''}` : 'Header not present';
    tests.push({ key: 'referrerPolicy', name: TEST_NAMES.referrerPolicy, passed, score_modifier: modifier, result: !present ? 'referrer-policy-not-implemented' : unsafe ? 'referrer-policy-unsafe' : 'referrer-policy-safe', severity: getSeverity(modifier, passed), description: TEST_DESCRIPTIONS.referrerPolicy, recommendation: passed ? '' : TEST_RECOMMENDATIONS.referrerPolicy, detail });
  }

  // ── 6. X-Content-Type-Options ────────────────────────────────────────────
  {
    const passed  = xcto.toLowerCase().includes('nosniff');
    const modifier = passed ? 0 : -5;
    tests.push({ key: 'xContentTypeOptions', name: TEST_NAMES.xContentTypeOptions, passed, score_modifier: modifier, result: passed ? 'x-content-type-options-nosniff' : 'x-content-type-options-not-implemented', severity: getSeverity(modifier, passed), description: TEST_DESCRIPTIONS.xContentTypeOptions, recommendation: passed ? '' : TEST_RECOMMENDATIONS.xContentTypeOptions, detail: xcto ? `Value: ${xcto}` : 'Header not present' });
  }

  // ── 7. COOP ──────────────────────────────────────────────────────────────
  {
    const passed   = ['same-origin', 'same-origin-allow-popups'].includes(coop.toLowerCase().trim());
    const modifier = passed ? 0 : -5;
    tests.push({ key: 'crossOriginOpenerPolicy', name: TEST_NAMES.crossOriginOpenerPolicy, passed, score_modifier: modifier, result: passed ? 'cross-origin-opener-policy-implemented' : 'cross-origin-opener-policy-not-implemented', severity: getSeverity(modifier, passed), description: TEST_DESCRIPTIONS.crossOriginOpenerPolicy, recommendation: passed ? '' : TEST_RECOMMENDATIONS.crossOriginOpenerPolicy, detail: coop ? `Value: ${coop}` : 'Header not present' });
  }

  // ── 8. CORS ──────────────────────────────────────────────────────────────
  {
    const wildcard = acao === '*';
    const passed   = !wildcard;
    const modifier = wildcard ? -5 : 0;
    const detail   = acao ? `Access-Control-Allow-Origin: ${acao}${wildcard ? ' — allows any origin' : ''}` : 'No CORS header (default: same-origin only — safe)';
    tests.push({ key: 'crossOriginResourceSharing', name: TEST_NAMES.crossOriginResourceSharing, passed, score_modifier: modifier, result: wildcard ? 'cors-implemented-with-unsafe-wildcard' : 'cors-not-implemented', severity: getSeverity(modifier, passed), description: TEST_DESCRIPTIONS.crossOriginResourceSharing, recommendation: passed ? '' : TEST_RECOMMENDATIONS.crossOriginResourceSharing, detail });
  }

  // ── 9. Cookies ───────────────────────────────────────────────────────────
  {
    let passed = true; let modifier = 0; let result = 'cookies-not-found'; let detail = 'No Set-Cookie headers on homepage (may be set during login)';
    // Split on newlines (from getAll) or fall back to comma-heuristic for concatenated strings
    const cookies = cookieStr ? cookieStr.split(/\n|,(?=[^;]+=[^;]+)/).map(c => c.trim()).filter(Boolean) : [];
    if (cookies.length > 0) {
      const missingSecure   = cookies.some(c => !/;\s*secure/i.test(c));
      const missingHttpOnly = cookies.some(c => !/;\s*httponly/i.test(c));
      const missingSameSite = cookies.some(c => !/;\s*samesite/i.test(c));
      const gaps: string[] = [];
      if (missingSecure)   gaps.push('Secure flag missing');
      if (missingHttpOnly) gaps.push('HttpOnly flag missing');
      if (missingSameSite) gaps.push('SameSite flag missing');
      if (gaps.length > 0) {
        passed = false; modifier = -10; result = 'cookies-anticsrf-without-secure-flag';
        detail = `${cookies.length} cookie(s) found — issues: ${gaps.join(', ')}`;
      } else {
        result = 'cookies-secure-with-httponly-sessions';
        detail = `${cookies.length} cookie(s) checked — all have Secure, HttpOnly and SameSite flags`;
      }
    }
    tests.push({ key: 'cookies', name: TEST_NAMES.cookies, passed, score_modifier: modifier, result, severity: getSeverity(modifier, passed), description: TEST_DESCRIPTIONS.cookies, recommendation: passed ? '' : TEST_RECOMMENDATIONS.cookies, detail });
  }

  // ── 10. Subresource Integrity ─────────────────────────────────────────────
  {
    const extScripts = [...htmlBody.matchAll(/<script[^>]+src=["']https?:\/\//gi)];
    const extLinks   = [...htmlBody.matchAll(/<link[^>]+href=["']https?:\/\//gi)];
    const external   = [...extScripts, ...extLinks];
    const withIntegrity = external.filter(m => /integrity=["']/i.test(m[0]));
    let passed = true; let modifier = 0; let result = 'sri-not-implemented-but-no-scripts-loaded'; let detail = 'No external scripts or stylesheets detected — SRI not required';
    if (external.length > 0) {
      if (withIntegrity.length === external.length) {
        result = 'sri-implemented';
        detail = `All ${external.length} external resource(s) have integrity attributes`;
      } else {
        passed = false; modifier = -5; result = 'sri-not-implemented-but-all-scripts-loaded-from-secure-origin';
        detail = `${external.length - withIntegrity.length} of ${external.length} external resource(s) missing integrity attribute`;
      }
    }
    tests.push({ key: 'subresourceIntegrity', name: TEST_NAMES.subresourceIntegrity, passed, score_modifier: modifier, result, severity: getSeverity(modifier, passed), description: TEST_DESCRIPTIONS.subresourceIntegrity, recommendation: passed ? '' : TEST_RECOMMENDATIONS.subresourceIntegrity, detail });
  }

  // ── 11. Permissions-Policy ────────────────────────────────────────────────
  {
    const permPolicy = hdrs['permissions-policy'] ?? '';
    const passed = !!permPolicy;
    const modifier = passed ? 0 : -3;
    tests.push({
      key: 'permissionsPolicy',
      name: TEST_NAMES.permissionsPolicy,
      passed,
      score_modifier: modifier,
      result: passed ? 'permissions-policy-implemented' : 'permissions-policy-not-implemented',
      severity: getSeverity(modifier, passed),
      description: 'Controls which browser APIs (camera, microphone, geolocation, payment) can be used on this page and in embedded iframes.',
      recommendation: passed ? '' : 'Add header: Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=() — blocks unused browser APIs from being accessed by scripts.',
      detail: passed ? `Value: ${permPolicy.slice(0, 120)}${permPolicy.length > 120 ? '…' : ''}` : 'Header not present',
    });
  }

  // Sort: critical → high → medium → low → pass
  const order = { critical: 0, high: 1, medium: 2, low: 3, pass: 4 };
  tests.sort((a, b) => order[a.severity] - order[b.severity]);

  return tests;
}


// ── HSTS Preload status ───────────────────────────────────────────────────────
async function fetchHstsPreloadStatus(domain: string): Promise<'preloaded' | 'pending' | 'unknown' | 'rejected' | 'removed' | null> {
  try {
    const res = await fetchWithTimeout(
      `https://hstspreload.org/api/v2/status?domain=${encodeURIComponent(domain)}`,
      { timeoutMs: 5000 }
    );
    if (!res.ok) return null;
    const data = await res.json() as { status?: string };
    const s = data.status ?? '';
    if (['preloaded', 'pending', 'unknown', 'rejected', 'removed'].includes(s)) {
      return s as 'preloaded' | 'pending' | 'unknown' | 'rejected' | 'removed';
    }
    return null;
  } catch {
    return null;
  }
}

// ── security.txt ──────────────────────────────────────────────────────────────
async function fetchSecurityTxt(domain: string): Promise<SecurityAuditResult['security_txt']> {
  try {
    const res = await fetchWithTimeout(
      `https://${domain}/.well-known/security.txt`,
      { timeoutMs: 4000 }
    );
    if (!res.ok) return null;
    const text = await res.text();
    const contactMatch = text.match(/^Contact:\s*(.+)$/im);
    const expiresMatch = text.match(/^Expires:\s*(.+)$/im);
    const contact = contactMatch?.[1]?.trim() ?? null;
    const expiresStr = expiresMatch?.[1]?.trim() ?? null;
    let is_expired = false;
    if (expiresStr) {
      try {
        is_expired = new Date(expiresStr).getTime() < Date.now();
      } catch { /* ignore invalid date */ }
    }
    return { present: true, contact, expires: expiresStr, is_expired };
  } catch {
    return null;
  }
}

// ── Main entry ────────────────────────────────────────────────────────────────
export async function runSecurityAudit(domain: string, html: string, headers: Headers): Promise<SecurityAuditResult> {
  const issues: string[] = [];

  const [obs, allTests, hstsPreloadStatus, securityTxt] = await Promise.all([
    fetchObservatoryGrade(domain).catch(() => null),
    Promise.resolve(analyzeHeaders(html, headers)).catch(() => [] as SecurityTest[]),
    fetchHstsPreloadStatus(domain).catch(() => null),
    fetchSecurityTxt(domain).catch(() => null),
  ]);

  const permissionsPolicy = headers.get('permissions-policy') ?? null;

  const passed    = allTests.filter(t =>  t.passed).length;
  const failed    = allTests.filter(t => !t.passed).length;

  // Prefer Observatory grade/score (third-party validated); fall back to our own tally
  const grade     = obs?.grade ?? (failed === 0 ? 'A+' : failed <= 2 ? 'B' : failed <= 4 ? 'C' : 'D');
  const rawScore  = obs?.score ?? Math.max(0, 100 - allTests.filter(t => !t.passed).reduce((s, t) => s + Math.abs(t.score_modifier), 0));
  const score     = Math.min(100, Math.max(0, rawScore));

  // Build issues list
  const gradeRank = ['A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','F'].indexOf(grade);
  if (gradeRank >= 6)      issues.push(`Security grade ${grade} (${score}/100) — multiple header vulnerabilities detected`);
  else if (gradeRank >= 3) issues.push(`Security grade ${grade} (${score}/100) — some security controls need attention`);

  const RESULT_HUMAN: Record<string, string> = {
    'csp-not-implemented':                                       'CSP not implemented — XSS attacks unmitigated',
    'csp-implemented-with-unsafe-eval':                          'CSP allows unsafe-eval — weakens script-execution restrictions',
    'csp-implemented-with-unsafe-inline':                        'CSP allows unsafe-inline — XSS protection partially bypassed',
    'hsts-not-implemented':                                      'HSTS not set — SSL stripping attacks possible',
    'hsts-not-implemented-no-https':                             'HTTPS not enabled — traffic is unencrypted',
    'hsts-implemented-max-age-less-than-six-months':             'HSTS max-age too short — should be ≥ 6 months (15,768,000 s)',
    'referrer-policy-not-implemented':                           'Referrer-Policy header missing',
    'referrer-policy-unsafe':                                    'Referrer-Policy leaks full URLs to third parties',
    'cross-origin-opener-policy-not-implemented':                'COOP not set — cross-origin popup isolation missing',
    'sri-not-implemented-but-all-scripts-loaded-from-secure-origin': 'No SRI on external scripts — unverified third-party code',
    'x-frame-options-not-implemented':                           'X-Frame-Options missing — clickjacking risk',
    'cors-implemented-with-unsafe-wildcard':                     'CORS uses wildcard (*) — any origin can read responses',
    'cookies-anticsrf-without-secure-flag':                      'Cookies missing Secure / HttpOnly / SameSite flags',
  };
  for (const t of allTests.filter(t => !t.passed).slice(0, 5)) {
    issues.push(RESULT_HUMAN[t.result] ?? t.result.replace(/-/g, ' '));
  }

  return {
    grade,
    score,
    tests_passed:   passed,
    tests_failed:   failed,
    tests_quantity: allTests.length,
    tests: allTests,
    issues,
    hsts_preload_status: hstsPreloadStatus,
    security_txt: securityTxt,
    permissions_policy: permissionsPolicy,
  };
}
