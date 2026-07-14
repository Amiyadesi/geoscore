import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'frontend', 'report-ui.js'), 'utf8');
const appSource = fs.readFileSync(path.join(here, '..', 'frontend', 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(here, '..', 'frontend', 'index.html'), 'utf8');
const context = { URL, URLSearchParams };
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'report-ui.js' });
const report = context.GeoScoreReport;

test('evidence summary and report adapter load before legacy score rendering', () => {
  assert.ok(indexHtml.indexOf('id="evidence-summary"') < indexHtml.indexOf('id="scores"'));
  assert.ok(indexHtml.indexOf('src="report-ui.js"') < indexHtml.indexOf('src="app.js"'));
});

test('frontend selects the local Worker only for file and local hosts', () => {
  assert.match(appSource, /const PRODUCTION_API = 'https:\/\/geo-api\.sayori\.org'/);
  assert.match(appSource, /const LOCAL_API = 'http:\/\/127\.0\.0\.1:8787'/);
  assert.match(appSource, /window\.location\.protocol === 'file:'/);
  assert.match(appSource, /\['localhost', '127\.0\.0\.1'\]\.includes\(window\.location\.hostname\)/);
  assert.doesNotMatch(appSource.slice(0, 500), /URLSearchParams|searchParams/);
});

test('audit input preserves a complete target URL and request-local archetype hint', () => {
  const parsed = report.parseAuditInput('https://blog.sayori.org/posts/example/?ref=a');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.mode, 'url');
  assert.equal(parsed.targetUrl, 'https://blog.sayori.org/posts/example/?ref=a');

  const endpoint = report.buildAuditEndpoint('https://geo-api.sayori.org', {
    ...parsed,
    archetypeHint: 'personal_blog',
  });
  const url = new URL(endpoint);
  assert.equal(url.searchParams.get('mode'), 'url');
  assert.equal(url.searchParams.get('url'), parsed.targetUrl);
  assert.equal(url.searchParams.get('archetype_hint'), 'personal_blog');
});

test('site audit endpoint does not opt into URL mode', () => {
  const endpoint = report.buildAuditEndpoint('https://geo-api.sayori.org', report.parseAuditInput('blog.sayori.org'));
  const url = new URL(endpoint);
  assert.equal(url.searchParams.has('mode'), false);
  assert.equal(url.searchParams.has('url'), false);
});

test('score comparisons require the same explicit version', () => {
  assert.equal(report.sameScoreVersion({ scoreVersion: 'evidence-v1' }, { score_version: 'evidence-v1' }), true);
  assert.equal(report.sameScoreVersion({ scoreVersion: 'evidence-v1' }, { score_version: 'legacy-v1' }), false);
  assert.equal(report.sameScoreVersion({}, {}), false);
});

test('site type correction is request-local and uses fixed archetypes', () => {
  const correction = appSource.slice(appSource.indexOf('async function submitArchetypeCorrection'), appSource.indexOf('// Close modal on backdrop click'));
  assert.doesNotMatch(correction, /\/api\/feedback/);
  assert.match(correction, /archetypeHint/);
  for (const value of ['personal_blog', 'editorial', 'news_media', 'documentation', 'saas', 'ecommerce', 'local_business', 'professional_services', 'portfolio', 'community', 'nonprofit', 'other', 'unknown']) {
    assert.match(indexHtml, new RegExp(`value="${value}"`));
  }
});

test('evidence audits replace legacy modules even when the recommendation list is empty', () => {
  assert.match(appSource, /const evidenceAudit = renderEvidenceReportSections\(data\)/);
  assert.match(appSource, /if \(!evidenceAudit\) \{\s*renderSiteIntro\(data\);\s*renderComputedSections\(data\);/);
  assert.match(source, /Array\.isArray\(data\?\.recommendations_v2\)/);
});

test('normalized checks keep predicted simulations outside factual failure counts', () => {
  const checks = report.normalizeChecks({
    checks: [
      { id: 'seo.title', status: 'fail', weight: 2, evidence: ['missing title'] },
      { id: 'geo.predicted_visibility', status: 'fail', weight: 0, predicted: true, evidence: ['simulation'] },
    ],
  }, 'en');
  assert.equal(checks.length, 2);
  assert.equal(checks[1].predicted, true);
  const summary = report.checkSummary({ checks }, 'en');
  assert.equal(summary.pass, 0);
  assert.equal(summary.fail, 1);
  assert.equal(summary.not_applicable, 0);
  assert.equal(summary.unknown, 0);
  assert.equal(summary.error, 0);
  const html = report.renderNormalizedChecks({ checks }, 'en');
  assert.match(html, /Predicted simulations/);
  assert.match(html, /zero scoring weight/i);
});

test('manual report language selects localized check and recommendation templates', () => {
  const data = {
    checks: [{
      id: 'seo.title',
      title: '页面标题',
      localized_title: { en: 'Page title', zh: '页面标题' },
      status: 'fail',
      weight: 2,
      evidence: ['No title found'],
    }],
    recommendations_v2: [{
      id: 'seo.title',
      title: '为页面添加唯一标题',
      why: '页面缺少标题。',
      fix: '添加标题。',
      verify: '重新审计。',
      localized: {
        en: {
          title: 'Add a unique page title',
          why: 'The page has no title.',
          fix: 'Add a title.',
          verify: 'Re-run the audit.',
        },
        zh: {
          title: '为页面添加唯一标题',
          why: '页面缺少标题。',
          fix: '添加标题。',
          verify: '重新审计。',
        },
      },
    }],
  };

  assert.equal(report.normalizeChecks(data, 'en')[0].title, 'Page title');
  assert.equal(report.normalizeChecks(data, 'zh')[0].title, '页面标题');
  assert.equal(report.normalizeAllActions(data, 'en')[0].title, 'Add a unique page title');
  assert.equal(report.normalizeAllActions(data, 'zh')[0].fix, '添加标题。');
  assert.match(report.renderEvidenceRecommendations(data, 'en'), /The page has no title/);
  assert.match(report.renderEvidenceRecommendations(data, 'zh'), /页面缺少标题/);
});

test('evidence recommendations use the stored-audit fix-pack contract', () => {
  const html = report.renderEvidenceRecommendations({
    recommendations_v2: [{
      id: 'seo.title',
      title: 'Add a factual title',
      page_url: 'https://example.com/',
      evidence: 'title is missing',
      why: 'the page has no title',
      fix: 'add a title element',
      verify: 'fetch the page again',
    }],
  }, 'en');
  assert.match(html, /data-recommendation-id="seo\.title"/);
  assert.match(appSource, /audit_id: currentAuditId/);
  assert.match(appSource, /recommendation_id: recommendationId/);
  assert.match(appSource, /output: 'full'/);
});

test('v2 insufficient evidence remains null instead of using legacy zero projections', () => {
  const summary = report.normalizeScoreSummary({
    overall_score: 0,
    seo_score: 0,
    geo_score: 0,
    score_summary: {
      score_version: 'evidence-v1',
      status: 'insufficient_evidence',
      overall: { score: null, coverage: 0.22, confidence: 0.4 },
      seo: { score: null, coverage: 0.2, confidence: 0.4 },
      geo: { score: null, coverage: 0.24, confidence: 0.4 },
    },
  });

  assert.equal(summary.overall, null);
  assert.equal(summary.seo, null);
  assert.equal(summary.geo, null);
  assert.equal(summary.coverage, 22);
  assert.equal(summary.confidence, 40);
});

test('evidence-first summary renders site context, sampled pages, and top actions', () => {
  const html = report.renderEvidenceSummary({
    domain: 'blog.sayori.org',
    audit_context: {
      site_archetype: 'personal_blog',
      industry_vertical: 'technology',
      business_model: 'independent publishing',
      entity: { name: 'Amiya', type: 'Person', source: 'JSON-LD' },
      locale: 'zh-CN',
      root_domain: 'sayori.org',
      confidence: 0.91,
      evidence: [{ source: 'JSON-LD', page_url: 'https://blog.sayori.org/', value: 'Blog + Person', confidence: 0.95 }],
    },
    pages_audited: [
      {
        url: 'https://blog.sayori.org/',
        page_type: 'home',
        source: 'homepage',
        status: 'complete',
        fetch_source: 'browser_run',
        provider: 'Cloudflare Browser Run',
        browser_ms_used: 1234,
      },
      { url: 'https://blog.sayori.org/about/', page_type: 'about', source: 'navigation', status: 'complete' },
    ],
    score_summary: {
      score_version: 'evidence-v1',
      overall: { score: 72, coverage: 0.8, confidence: 0.86 },
      seo: { score: 75, coverage: 0.84, confidence: 0.9 },
      geo: { score: 68, coverage: 0.76, confidence: 0.82 },
    },
    recommendations_v2: [{
      id: 'canonical',
      category: 'seo',
      priority: 'high',
      title: '修复文章 canonical',
      page_url: 'https://blog.sayori.org/posts/example/',
      evidence: 'canonical 指向首页',
      why: '搜索引擎无法确认首选文章 URL',
      fix: '将 canonical 改为文章自身 URL',
      verify: '重新抓取并检查 link[rel=canonical]',
    }],
  }, 'zh', 'zh');

  assert.match(html, /个人博客/);
  assert.match(html, /Amiya/);
  assert.match(html, /已审查页面/);
  assert.match(html, /Browser Run 渲染/);
  assert.match(html, /1234 ms/);
  assert.match(html, /修复文章 canonical/);
  assert.match(html, /canonical 指向首页/);
  assert.ok(html.indexOf('站点画像') < html.indexOf('证据充分的优先行动'));
  assert.match(appSource, /page\.fetchSource === 'browser_run'/);
  assert.match(appSource, /t\.browserRendered/);
});

test('Lighthouse null scores render as failure with retry and sanitized detail', () => {
  const data = {
    status: 'complete',
    source: 'Google PageSpeed Insights API',
    mobile_score: null,
    desktop_score: null,
    mobile: { strategy: 'mobile', status: 'complete', score: null },
    desktop: { strategy: 'desktop', status: 'complete', score: null },
  };
  const status = report.lighthouseStatus(data, null, [], 'ok');
  const html = report.renderLighthouse({
    data,
    status,
    error: { code: 'PAGESPEED_AUTH_ERROR', message: 'API key not valid: AIza-secret', retryable: false },
    domain: 'blog.sayori.org',
    lang: 'en',
  });

  assert.equal(status, 'failed');
  assert.match(html, /PAGESPEED_AUTH_ERROR/);
  assert.match(html, /Retry PageSpeed/);
  assert.doesNotMatch(html, /AIza-secret/);
  assert.match(html, /\[redacted\]/);
});

test('Lighthouse one-sided numeric result renders as partial', () => {
  const data = {
    status: 'partial',
    source: 'Google PageSpeed Insights API',
    mobile: { strategy: 'mobile', status: 'complete', score: 84, lcp_ms: 2100 },
    desktop: {
      strategy: 'desktop',
      status: 'error',
      score: null,
      error: { code: 'PAGESPEED_QUOTA_EXCEEDED', message: 'Quota exceeded', retryable: true },
    },
    mobile_score: 84,
    desktop_score: null,
  };

  assert.equal(report.lighthouseStatus(data, null, [], 'ok'), 'partial');
  const html = report.renderLighthouse({ data, domain: 'example.com', lang: 'en' });
  assert.match(html, /partial result/i);
  assert.match(html, />84</);
  assert.match(html, /PAGESPEED_QUOTA_EXCEEDED/);
});

test('llms.txt view distinguishes an upstream error from a confirmed missing file', () => {
  const unknown = report.llmsTxtView({ llms_txt_status: 'error', llms_txt_present: false }, 'en');
  assert.equal(unknown.state, 'unknown');
  assert.match(unknown.badge, /could not be verified/i);
  assert.match(unknown.generatorMessage, /could not verify/i);
  assert.doesNotMatch(`${unknown.badge} ${unknown.generatorMessage}`, /No llms\.txt|not found/i);

  const missing = report.llmsTxtView({ llms_txt_status: 'missing', llms_txt_present: false }, 'en');
  assert.equal(missing.state, 'missing');
  assert.match(missing.badge, /No llms\.txt/i);

  const present = report.llmsTxtView({ llms_txt_status: 'complete', llms_txt_present: true }, 'en');
  assert.equal(present.state, 'present');
  assert.match(present.badge, /llms\.txt/);
  assert.equal(present.canViewExisting, true);
  assert.match(appSource, /REPORT_UI\?\.llmsTxtView/);
});

test('CJK readability is not exposed as a zero-valued English Flesch score', () => {
  const cjk = report.readabilityView({
    applicable: false,
    method: 'not_applicable',
    flesch_ease: null,
    grade_level: null,
    grade_label: 'Not applicable for Chinese/CJK content',
    reading_time_min: 3,
  }, 'en');
  assert.equal(cjk.applicable, false);
  assert.equal(cjk.score, null);
  assert.match(cjk.label, /not applicable/i);

  const english = report.readabilityView({
    applicable: true,
    method: 'flesch_en',
    flesch_ease: 68,
    grade_level: 8,
    grade_label: 'Standard',
  }, 'en');
  assert.equal(english.applicable, true);
  assert.equal(english.score, 68);
  assert.match(appSource, /REPORT_UI\?\.readabilityView/);
});
