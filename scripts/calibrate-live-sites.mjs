import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CASES = [
  { domain: 'apnews.com', expected: ['news_media'], group: 'news' },
  { domain: 'bbc.com', expected: ['news_media'], group: 'news' },
  { domain: 'theguardian.com', expected: ['news_media', 'editorial'], group: 'news' },
  { domain: 'npr.org', expected: ['news_media', 'editorial'], group: 'news' },
  { domain: 'arstechnica.com', expected: ['news_media', 'editorial'], group: 'news' },
  { domain: 'blog.sayori.org', expected: ['personal_blog', 'editorial'], group: 'personal_blog' },
  { domain: 'overreacted.io', expected: ['personal_blog', 'editorial'], group: 'personal_blog' },
  { domain: 'simonwillison.net', expected: ['personal_blog', 'editorial'], group: 'personal_blog' },
  { domain: 'jvns.ca', expected: ['personal_blog', 'editorial'], group: 'personal_blog' },
  { domain: 'sayori.org', expected: ['portfolio', 'personal_blog', 'other', 'unknown'], group: 'portfolio' },
  { domain: 'adhamdannaway.com', expected: ['portfolio', 'personal_blog'], group: 'portfolio' },
  { domain: 'www.gov.uk', expected: ['other', 'unknown'], group: 'government' },
  { domain: 'nasa.gov', expected: ['other', 'unknown'], group: 'government' },
  { domain: 'mit.edu', expected: ['other', 'unknown'], group: 'university' },
  { domain: 'harvard.edu', expected: ['other', 'unknown'], group: 'university' },
  { domain: 'docs.python.org', expected: ['documentation'], group: 'documentation' },
  { domain: 'kubernetes.io', expected: ['documentation'], group: 'open_source' },
  { domain: 'vite.dev', expected: ['documentation'], group: 'open_source' },
  { domain: 'developer.mozilla.org', expected: ['documentation'], group: 'documentation' },
  { domain: 'react.dev', expected: ['documentation'], group: 'documentation' },
  { domain: 'docs.github.com', expected: ['documentation'], group: 'documentation' },
  { domain: 'etsy.com', expected: ['ecommerce'], group: 'marketplace' },
  { domain: 'ebay.com', expected: ['ecommerce'], group: 'marketplace' },
  { domain: 'nike.com', expected: ['ecommerce'], group: 'ecommerce' },
  { domain: 'booking.com', expected: ['ecommerce', 'local_business'], group: 'marketplace' },
  { domain: 'reddit.com', expected: ['community'], group: 'community' },
  { domain: 'stackoverflow.com', expected: ['community'], group: 'community' },
  { domain: 'dev.to', expected: ['community', 'editorial'], group: 'community' },
  { domain: 'news.ycombinator.com', expected: ['community'], group: 'community' },
  { domain: 'discourse.org', expected: ['saas'], group: 'saas' },
  { domain: 'cloudflare.com', expected: ['saas'], group: 'saas' },
  { domain: 'stripe.com', expected: ['saas'], group: 'saas' },
  { domain: 'vercel.com', expected: ['saas'], group: 'saas' },
  { domain: 'figma.com', expected: ['saas'], group: 'saas' },
  { domain: 'linear.app', expected: ['saas'], group: 'saas' },
  { domain: 'github.com', expected: ['saas', 'community'], group: 'saas' },
  { domain: 'shopify.com', expected: ['saas', 'ecommerce'], group: 'saas' },
  { domain: 'mckinsey.com', expected: ['professional_services'], group: 'professional_services' },
  { domain: 'pwc.com', expected: ['professional_services'], group: 'professional_services' },
  { domain: 'deloitte.com', expected: ['professional_services'], group: 'professional_services' },
  { domain: 'mayoclinic.org', expected: ['professional_services', 'local_business'], group: 'healthcare' },
  { domain: 'elevenmadisonpark.com', expected: ['local_business'], group: 'local_business' },
  { domain: 'noma.dk', expected: ['local_business'], group: 'local_business' },
  { domain: 'mozilla.org', expected: ['nonprofit'], group: 'nonprofit' },
  { domain: 'unicef.org', expected: ['nonprofit'], group: 'nonprofit' },
  { domain: 'wikipedia.org', expected: ['nonprofit', 'community', 'other', 'unknown'], group: 'multilingual' },
  { domain: 'zhihu.com', expected: ['community'], group: 'multilingual' },
  { domain: 'linux.do', expected: ['community'], group: 'community' },
];

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
}

function compileAuditCore() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-live-calibration-'));
  fs.writeFileSync(path.join(output, 'package.json'), '{"type":"commonjs"}\n');
  fs.symlinkSync(path.resolve('node_modules'), path.join(output, 'node_modules'), 'junction');
  execFileSync(process.execPath, [
    path.join('node_modules', 'typescript', 'bin', 'tsc'),
    '--target', 'ES2022',
    '--module', 'CommonJS',
    '--moduleResolution', 'node',
    '--esModuleInterop',
    '--lib', 'ES2022',
    '--types', '@cloudflare/workers-types',
    '--skipLibCheck',
    '--rootDir', 'src',
    '--outDir', output,
    'src/lib/audit-core.ts',
    'src/lib/audit-pages.ts',
    'src/lib/security.ts',
  ], { stdio: 'inherit' });
  return output;
}

async function mapLimit(items, concurrency, callback) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await callback(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function boundedError(value) {
  return String(value?.message || value || 'Unknown error').replace(/\s+/g, ' ').slice(0, 180);
}

const only = new Set((argument('only') || '').split(',').map(value => value.trim()).filter(Boolean));
const selected = only.size ? CASES.filter(item => only.has(item.domain)) : CASES;
const concurrency = Math.max(1, Math.min(6, Number(argument('concurrency')) || 4));
const json = process.argv.includes('--json');
const strict = process.argv.includes('--strict');
const compiled = compileAuditCore();
const require = createRequire(import.meta.url);
const { buildAuditContext } = require(path.join(compiled, 'lib', 'audit-core.js'));
const { fetchAuditPage } = require(path.join(compiled, 'lib', 'audit-pages.js'));

const results = await mapLimit(selected, concurrency, async testCase => {
  const url = `https://${testCase.domain}/`;
  try {
    const page = await fetchAuditPage({ url, page_type: 'home', source: 'requested' });
    if (page.status !== 'complete') {
      return {
        ...testCase,
        result: 'unavailable',
        actual: 'unknown',
        confidence: 0,
        entity: null,
        detail: page.error_code || page.error || `HTTP ${page.status_code}`,
      };
    }
    const context = buildAuditContext({ domain: testCase.domain, pages: [page] });
    return {
      ...testCase,
      result: testCase.expected.includes(context.site_archetype) ? 'match' : 'review',
      actual: context.site_archetype,
      confidence: context.confidence,
      entity: context.entity ? `${context.entity.type}: ${context.entity.name}` : null,
      detail: context.evidence[0]?.value || 'No classification evidence',
    };
  } catch (error) {
    return {
      ...testCase,
      result: 'unavailable',
      actual: 'unknown',
      confidence: 0,
      entity: null,
      detail: boundedError(error),
    };
  }
});

const summary = {
  total: results.length,
  matched: results.filter(item => item.result === 'match').length,
  review: results.filter(item => item.result === 'review').length,
  unavailable: results.filter(item => item.result === 'unavailable').length,
};

if (json) {
  console.log(JSON.stringify({ generated_at: new Date().toISOString(), summary, results }, null, 2));
} else {
  console.table(results.map(item => ({
    result: item.result,
    group: item.group,
    domain: item.domain,
    expected: item.expected.join('|'),
    actual: item.actual,
    confidence: item.confidence,
    entity: item.entity || '-',
    evidence: item.detail,
  })));
  console.log(`Matched ${summary.matched}/${summary.total}; review ${summary.review}; unavailable ${summary.unavailable}`);
}

if (strict && summary.review > 0) process.exitCode = 1;
