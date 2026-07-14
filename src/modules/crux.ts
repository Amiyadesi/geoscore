import { fetchWithTimeout, type HttpFetcher } from '../lib/http';
import type { Env } from '../lib/types';

export interface CruxMetric {
  p75: number;
  good_rate: number;
  needs_improvement_rate: number;
  poor_rate: number;
}

export interface CruxResult {
  has_data: boolean;
  lcp: CruxMetric | null;
  cls: CruxMetric | null;
  inp: CruxMetric | null;
  fcp: CruxMetric | null;
  ttfb: CruxMetric | null;
  performance_score: number;
  issues: string[];
}

const THRESHOLDS = {
  lcp:  { good: 2500, poor: 4000 },
  cls:  { good: 0.1,  poor: 0.25 },
  inp:  { good: 200,  poor: 500  },
  fcp:  { good: 1800, poor: 3000 },
  ttfb: { good: 800,  poor: 1800 },
};

const EMPTY: CruxResult = {
  has_data: false, lcp: null, cls: null, inp: null, fcp: null, ttfb: null,
  performance_score: 0, issues: [],
};

const CRUX_METRICS = [
  'largest_contentful_paint',
  'cumulative_layout_shift',
  'interaction_to_next_paint',
  'first_contentful_paint',
  'experimental_time_to_first_byte',
];

async function queryCrux(origin: string, keyParam: string, fetcher: HttpFetcher): Promise<Response> {
  return fetcher(
    `https://chromeuxreport.googleapis.com/v1/records:queryRecord${keyParam}`,
    {
      method: 'POST',
      timeoutMs: 10000,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin, formFactor: 'PHONE', metrics: CRUX_METRICS }),
    }
  );
}

export async function runCrux(
  domain: string,
  env: Env,
  options: { fetcher?: HttpFetcher } = {},
): Promise<CruxResult> {
  // API key is optional — keyless requests are allowed with lower rate limits (150 req/min)
  const keyParam = env.GOOGLE_API_KEY ? `?key=${env.GOOGLE_API_KEY}` : '';
  const fetcher = options.fetcher ?? fetchWithTimeout;

  try {
    let res = await queryCrux(`https://${domain}`, keyParam, fetcher);

    // Many sites redirect http://domain → https://www.domain — CrUX stores data under the www origin.
    // If the bare domain returns 404, retry with the www. prefix.
    if (res.status === 404 && !domain.startsWith('www.')) {
      res = await queryCrux(`https://www.${domain}`, keyParam, fetcher);
    }

    if (res.status === 404) {
      return { ...EMPTY, issues: ['No CrUX data — insufficient real-user traffic for this origin'] };
    }
    if (res.status === 401 || res.status === 403) {
      return { ...EMPTY, issues: ['CrUX API: key required or invalid — add GOOGLE_API_KEY to Worker env'] };
    }
    if (!res.ok) {
      return { ...EMPTY, issues: [`CrUX API error: ${res.status}`] };
    }

    const data = await res.json() as {
      record?: {
        metrics?: Record<string, {
          percentiles?: { p75: number };
          histogram?: Array<{ density: number }>;
        }>;
      };
    };

    const metrics = data.record?.metrics ?? {};

    function parseMetric(key: string): CruxMetric | null {
      const m = metrics[key];
      if (!m?.percentiles) return null;
      const hist = m.histogram ?? [];
      return {
        p75: Number(m.percentiles.p75),
        good_rate: Math.round((hist[0]?.density ?? 0) * 100),
        needs_improvement_rate: Math.round((hist[1]?.density ?? 0) * 100),
        poor_rate: Math.round((hist[2]?.density ?? 0) * 100),
      };
    }

    const lcp  = parseMetric('largest_contentful_paint');
    const cls  = parseMetric('cumulative_layout_shift');
    const inp  = parseMetric('interaction_to_next_paint');
    const fcp  = parseMetric('first_contentful_paint');
    const ttfb = parseMetric('experimental_time_to_first_byte');

    const issues: string[] = [];
    let perfScore = 100;

    if (lcp) {
      if (lcp.p75 > THRESHOLDS.lcp.poor)       { perfScore -= 25; issues.push(`LCP ${lcp.p75}ms — poor (>4s)`); }
      else if (lcp.p75 > THRESHOLDS.lcp.good)  { perfScore -= 12; issues.push(`LCP ${lcp.p75}ms — needs improvement`); }
    }
    if (cls) {
      if (cls.p75 > THRESHOLDS.cls.poor)       { perfScore -= 20; issues.push(`CLS ${cls.p75.toFixed(3)} — poor (>0.25)`); }
      else if (cls.p75 > THRESHOLDS.cls.good)  { perfScore -= 10; issues.push(`CLS ${cls.p75.toFixed(3)} — needs improvement`); }
    }
    if (inp) {
      if (inp.p75 > THRESHOLDS.inp.poor)       { perfScore -= 20; issues.push(`INP ${inp.p75}ms — poor (>500ms)`); }
      else if (inp.p75 > THRESHOLDS.inp.good)  { perfScore -= 10; issues.push(`INP ${inp.p75}ms — needs improvement`); }
    }
    if (fcp) {
      if (fcp.p75 > THRESHOLDS.fcp.poor)       { perfScore -= 15; issues.push(`FCP ${fcp.p75}ms — poor (>3s)`); }
      else if (fcp.p75 > THRESHOLDS.fcp.good)  { perfScore -= 7;  issues.push(`FCP ${fcp.p75}ms — needs improvement`); }
    }
    if (ttfb) {
      if (ttfb.p75 > THRESHOLDS.ttfb.poor)     { perfScore -= 20; issues.push(`TTFB ${ttfb.p75}ms — poor (>1.8s)`); }
      else if (ttfb.p75 > THRESHOLDS.ttfb.good){ perfScore -= 8;  issues.push(`TTFB ${ttfb.p75}ms — needs improvement`); }
    }

    return {
      has_data: true,
      lcp, cls, inp, fcp, ttfb,
      performance_score: Math.max(0, perfScore),
      issues,
    };
  } catch (err) {
    const msg = (err as Error).message ?? '';
    // Sanitize internal infrastructure errors — don't expose Cloudflare Worker limits to users
    const userMsg = msg.includes('subrequest') || msg.includes('Worker invocation')
      ? 'Performance data temporarily unavailable — CrUX request limit reached'
      : `CrUX data unavailable: ${msg.slice(0, 80)}`;
    return { ...EMPTY, issues: [userMsg] };
  }
}
