/**
 * Lighthouse / PageSpeed Insights module.
 * Provider failures stay explicit: missing data is never converted into score 0.
 */

export type LighthouseStrategy = 'mobile' | 'desktop';
export type LighthouseStrategyStatus = 'complete' | 'error';
export type LighthouseStatus = 'complete' | 'partial';

export interface LighthouseProviderError {
  code: string;
  message: string;
  retryable: boolean;
  upstream_status: number;
}

export interface LighthouseStrategyResult {
  strategy: LighthouseStrategy;
  status: LighthouseStrategyStatus;
  score: number | null;
  lcp_ms: number | null;
  cls: number | null;
  fcp_ms: number | null;
  tbt_ms: number | null;
  si_ms: number | null;
  opportunities: number;
  error?: LighthouseProviderError;
}

export interface LighthouseResult {
  status: LighthouseStatus;
  source: 'Google PageSpeed Insights API';
  url: string;
  mobile: LighthouseStrategyResult;
  desktop: LighthouseStrategyResult;
  mobile_score: number | null;
  desktop_score: number | null;
  lcp_ms: number | null;
  cls: number | null;
  fcp_ms: number | null;
  tbt_ms: number | null;
  si_ms: number | null;
  desktop_lcp_ms: number | null;
  desktop_cls: number | null;
  desktop_fcp_ms: number | null;
  opportunities: number;
  score: number | null;
  issues: string[];
}

interface PsiFetchResult {
  data: unknown;
  status: number;
  error?: LighthouseProviderError;
}

export class LighthouseUpstreamError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly httpStatus: number;
  readonly strategies: LighthouseStrategyResult[];

  constructor(error: LighthouseProviderError, strategies: LighthouseStrategyResult[]) {
    super(error.message);
    this.name = 'LighthouseUpstreamError';
    this.code = error.code;
    this.retryable = error.retryable;
    this.httpStatus = error.code === 'PAGESPEED_AUTH_ERROR' ? 503
      : error.code === 'PAGESPEED_QUOTA_EXCEEDED' ? 503
      : 502;
    this.strategies = strategies;
  }
}

const PSI_BASE = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

function getPsiErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message : null;
}

function sanitizeProviderMessage(message: string): string {
  return message
    .replace(/([?&]key=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\bAIza[\w-]+\b/g, '[redacted]')
    .slice(0, 300);
}

function classifyProviderError(status: number, rawMessage: string): LighthouseProviderError {
  const message = sanitizeProviderMessage(rawMessage || (status ? `HTTP ${status}` : 'PageSpeed request failed'));
  const lower = message.toLowerCase();
  if (status === 0 && /timeout|timed out|abort/.test(lower)) {
    return { code: 'PAGESPEED_TIMEOUT', message, retryable: true, upstream_status: status };
  }
  if (status === 400 && /api key|key not valid|invalid key/.test(lower)) {
    return { code: 'PAGESPEED_AUTH_ERROR', message, retryable: false, upstream_status: status };
  }
  if (status === 401 || status === 403) {
    const quota = /quota|rate limit|rate_limit|resource exhausted/.test(lower);
    return {
      code: quota ? 'PAGESPEED_QUOTA_EXCEEDED' : 'PAGESPEED_AUTH_ERROR',
      message,
      retryable: quota,
      upstream_status: status,
    };
  }
  if (status === 429 || /quota|rate limit|rate_limit|resource exhausted/.test(lower)) {
    return { code: 'PAGESPEED_QUOTA_EXCEEDED', message, retryable: true, upstream_status: status };
  }
  return {
    code: status >= 500 ? 'PAGESPEED_UPSTREAM_ERROR' : 'PAGESPEED_UNAVAILABLE',
    message,
    retryable: true,
    upstream_status: status,
  };
}

async function fetchPsi(
  url: string,
  strategy: LighthouseStrategy,
  apiKey: string,
): Promise<PsiFetchResult> {
  const params = new URLSearchParams({
    url,
    strategy,
    key: apiKey,
  });
  for (const category of ['performance', 'accessibility', 'best-practices', 'seo']) {
    params.append('category', category);
  }
  try {
    const res = await fetch(`${PSI_BASE}?${params.toString()}`, { signal: AbortSignal.timeout(28000) });
    let body: unknown = null;
    let malformedJson = false;
    try {
      body = await res.json();
    } catch {
      malformedJson = true;
    }
    if (!res.ok) {
      return {
        data: null,
        status: res.status,
        error: classifyProviderError(res.status, getPsiErrorMessage(body) ?? `HTTP ${res.status}`),
      };
    }
    if (malformedJson || !body || typeof body !== 'object') {
      return {
        data: null,
        status: res.status,
        error: {
          code: 'PAGESPEED_INVALID_RESPONSE',
          message: 'PageSpeed returned malformed JSON',
          retryable: true,
          upstream_status: res.status,
        },
      };
    }
    return { data: body, status: res.status };
  } catch (error: unknown) {
    return {
      data: null,
      status: 0,
      error: classifyProviderError(0, error instanceof Error ? error.message : String(error)),
    };
  }
}

function extractScore(data: unknown, category = 'performance'): number | null {
  const d = data as Record<string, any>;
  const score = d?.lighthouseResult?.categories?.[category]?.score;
  const numeric = Number(score);
  return score != null && Number.isFinite(numeric) && numeric >= 0 && numeric <= 1
    ? Math.round(numeric * 100)
    : null;
}

function numericAudit(data: unknown, id: string): number | null {
  const d = data as Record<string, any>;
  const value = d?.lighthouseResult?.audits?.[id]?.numericValue;
  return value != null ? Number(value) : null;
}

function countOpportunities(data: unknown): number {
  const d = data as Record<string, any>;
  const audits = d?.lighthouseResult?.audits;
  if (!audits) return 0;
  return Object.values(audits as Record<string, any>).filter(
    (audit: any) => audit?.details?.type === 'opportunity' && (audit?.details?.overallSavingsMs ?? 0) > 150,
  ).length;
}

function strategyResult(strategy: LighthouseStrategy, result: PsiFetchResult): LighthouseStrategyResult {
  if (result.error || !result.data) {
    return {
      strategy,
      status: 'error',
      score: null,
      lcp_ms: null,
      cls: null,
      fcp_ms: null,
      tbt_ms: null,
      si_ms: null,
      opportunities: 0,
      error: result.error ?? classifyProviderError(result.status, 'PageSpeed returned no audit data'),
    };
  }
  const score = extractScore(result.data);
  if (score === null) {
    return {
      strategy,
      status: 'error',
      score: null,
      lcp_ms: null,
      cls: null,
      fcp_ms: null,
      tbt_ms: null,
      si_ms: null,
      opportunities: 0,
      error: {
        code: 'PAGESPEED_INVALID_RESPONSE',
        message: 'PageSpeed returned HTTP 200 without a valid performance score',
        retryable: true,
        upstream_status: result.status,
      },
    };
  }
  return {
    strategy,
    status: 'complete',
    score,
    lcp_ms: numericAudit(result.data, 'largest-contentful-paint'),
    cls: numericAudit(result.data, 'cumulative-layout-shift'),
    fcp_ms: numericAudit(result.data, 'first-contentful-paint'),
    tbt_ms: numericAudit(result.data, 'total-blocking-time'),
    si_ms: numericAudit(result.data, 'speed-index'),
    opportunities: countOpportunities(result.data),
  };
}

function primaryError(strategies: LighthouseStrategyResult[]): LighthouseProviderError {
  const errors = strategies.flatMap(strategy => strategy.error ? [strategy.error] : []);
  return errors.find(error => error.code === 'PAGESPEED_AUTH_ERROR')
    ?? errors.find(error => error.code === 'PAGESPEED_QUOTA_EXCEEDED')
    ?? errors[0]
    ?? classifyProviderError(0, 'PageSpeed returned no audit data');
}

export async function runLighthouse(domain: string, apiKey: string): Promise<LighthouseResult> {
  if (!apiKey) {
    throw new LighthouseUpstreamError(
      { code: 'PAGESPEED_NOT_CONFIGURED', message: 'PageSpeed Insights is not configured', retryable: false, upstream_status: 0 },
      [],
    );
  }

  const pageUrl = `https://${domain}`;
  const [mobileFetch, desktopFetch] = await Promise.all([
    fetchPsi(pageUrl, 'mobile', apiKey),
    fetchPsi(pageUrl, 'desktop', apiKey),
  ]);
  const mobile = strategyResult('mobile', mobileFetch);
  const desktop = strategyResult('desktop', desktopFetch);
  const strategies = [mobile, desktop];

  if (strategies.every(strategy => strategy.status === 'error')) {
    throw new LighthouseUpstreamError(primaryError(strategies), strategies);
  }

  const issues = strategies.flatMap(strategy =>
    strategy.error ? [`PSI ${strategy.strategy}: ${strategy.error.message}`] : [],
  );
  if (mobile.lcp_ms != null && mobile.lcp_ms > 2500) {
    issues.push(`LCP ${(mobile.lcp_ms / 1000).toFixed(1)}s mobile - ${mobile.lcp_ms > 4000 ? 'poor' : 'needs improvement'}`);
  }
  if (mobile.cls != null && mobile.cls > 0.1) {
    issues.push(`CLS ${mobile.cls.toFixed(3)} mobile - ${mobile.cls > 0.25 ? 'poor' : 'needs improvement'}`);
  }
  if (mobile.tbt_ms != null && mobile.tbt_ms > 600) {
    issues.push(`Total Blocking Time ${Math.round(mobile.tbt_ms)}ms mobile - high JS blocking`);
  }

  const score = mobile.score !== null && desktop.score !== null
    ? Math.round(mobile.score * 0.6 + desktop.score * 0.4)
    : mobile.score ?? desktop.score;

  return {
    status: strategies.every(strategy => strategy.status === 'complete') ? 'complete' : 'partial',
    source: 'Google PageSpeed Insights API',
    url: pageUrl,
    mobile,
    desktop,
    mobile_score: mobile.score,
    desktop_score: desktop.score,
    lcp_ms: mobile.lcp_ms,
    cls: mobile.cls,
    fcp_ms: mobile.fcp_ms,
    tbt_ms: mobile.tbt_ms,
    si_ms: mobile.si_ms,
    desktop_lcp_ms: desktop.lcp_ms,
    desktop_cls: desktop.cls,
    desktop_fcp_ms: desktop.fcp_ms,
    opportunities: mobile.opportunities + desktop.opportunities,
    score,
    issues,
  };
}
