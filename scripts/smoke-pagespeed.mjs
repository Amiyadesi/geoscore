#!/usr/bin/env node

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const apiBase = valueAfter('--api', process.env.GEOSCORE_API_URL || 'https://geo-api.sayori.org');
const domain = valueAfter('--domain', process.env.GEOSCORE_SMOKE_DOMAIN || 'blog.sayori.org');
const requireScore = args.includes('--require-score');
const endpoint = `${apiBase.replace(/\/$/, '')}/api/lighthouse?domain=${encodeURIComponent(domain)}`;

try {
  const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
  const body = await response.json();
  const numeric = body?.ok === true && typeof body?.data?.score === 'number' &&
    ['mobile', 'desktop'].some(strategy => body.data?.[strategy]?.status === 'complete' && typeof body.data?.[strategy]?.score === 'number');
  const structuredFailure = body?.ok === false && typeof body?.error?.code === 'string' &&
    /^PAGESPEED_/.test(body.error.code) && typeof body.error.retryable === 'boolean' && Array.isArray(body.strategies);

  if (numeric) {
    console.log(JSON.stringify({ ok: true, domain, score: body.data.score, status: body.data.status }));
    process.exitCode = 0;
  } else if (structuredFailure && !requireScore) {
    console.log(JSON.stringify({ ok: false, structured_failure: true, domain, code: body.error.code, retryable: body.error.retryable }));
    process.exitCode = 0;
  } else {
    console.error(JSON.stringify({ ok: false, domain, http_status: response.status, body }));
    process.exitCode = 1;
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, domain, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}
