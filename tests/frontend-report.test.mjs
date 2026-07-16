import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'frontend', 'report-ui.js'), 'utf8');
const reportExportSource = fs.readFileSync(path.join(here, '..', 'frontend', 'report-export.js'), 'utf8');
const appSource = fs.readFileSync(path.join(here, '..', 'frontend', 'app.js'), 'utf8');
const assistantSource = fs.readFileSync(path.join(here, '..', 'frontend', 'assistant-ui.js'), 'utf8');
const monitoringSource = fs.readFileSync(path.join(here, '..', 'frontend', 'monitoring.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(here, '..', 'frontend', 'index.html'), 'utf8');
const printCss = fs.readFileSync(path.join(here, '..', 'frontend', 'print.css'), 'utf8');
const context = { URL, URLSearchParams };
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'report-ui.js' });
const report = context.GeoScoreReport;

const reportExportContext = { Blob, URL };
reportExportContext.globalThis = reportExportContext;
vm.runInNewContext(reportExportSource, reportExportContext, { filename: 'report-export.js' });
const reportExport = reportExportContext.GeoScoreReportExport;

test('evidence summary and report adapter load before legacy score rendering', () => {
  assert.ok(indexHtml.indexOf('id="evidence-summary"') < indexHtml.indexOf('id="scores"'));
  assert.ok(indexHtml.indexOf('src="report-ui.js"') < indexHtml.indexOf('src="app.js"'));
  assert.ok(indexHtml.indexOf('src="report-ui.js"') < indexHtml.indexOf('src="report-export.js"'));
  assert.ok(indexHtml.indexOf('src="report-export.js"') < indexHtml.indexOf('src="app.js"'));
  assert.ok(indexHtml.indexOf('src="evidence-map.js"') < indexHtml.indexOf('src="app.js"'));
  assert.ok(indexHtml.indexOf('src="monitoring.js"') < indexHtml.indexOf('src="app.js"'));
  assert.ok(indexHtml.indexOf('src="assistant-ui.js"') < indexHtml.indexOf('src="app.js"'));
});

test('audit header stacks and wraps actions on a 390px viewport', () => {
  assert.match(indexHtml, /class="flex flex-col items-stretch gap-3 px-5 py-4 border-b border-slate-100 sm:flex-row sm:items-center sm:justify-between"/);
  assert.match(indexHtml, /id="business-card" class="flex w-full min-w-0 items-center gap-3 sm:w-auto"/);
  assert.match(indexHtml, /class="flex w-full flex-wrap items-center gap-2 print:hidden sm:w-auto sm:shrink-0"/);
});

test('audit loading state preserves the persistent domain header elements', () => {
  assert.match(appSource, /showAuditShell\(domain\);\s*spinnerCard\(domain\);\s*openAuditStream/);
  assert.doesNotMatch(appSource, /innerHTML\s*=\s*spinnerCard\(domain\)/);
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

test('report language refreshes status totals and performance provenance', () => {
  const data = {
    checks: [
      { id: 'seo.title', status: 'pass', weight: 2 },
      { id: 'seo.canonical', status: 'fail', weight: 2 },
      { id: 'seo.cwv_inp', status: 'unknown', weight: 2 },
      { id: 'seo.pagespeed', status: 'error', weight: 2 },
      { id: 'geo.direct_answer', status: 'not_applicable', weight: 1 },
    ],
    modules: { lighthouse: { data: { mobile_score: 82 } } },
  };
  assert.match(report.renderCheckSummaryBar(data, 'en'), /1 Pass/);
  assert.match(report.renderCheckSummaryBar(data, 'zh'), /1 通过/);
  assert.match(report.renderCheckSummaryBar(data, 'zh'), /1 失败/);
  assert.match(report.renderCheckSummaryBar(data, 'zh'), /1 未知/);
  assert.match(report.renderCheckSummaryBar(data, 'zh'), /1 错误/);
  assert.match(report.renderCheckSummaryBar(data, 'zh'), /1 不适用/);
  assert.equal(report.performanceSourceLabel(data, 'en'), 'Lighthouse mobile');
  assert.equal(report.performanceSourceLabel(data, 'zh'), 'Lighthouse 移动端');

  const languageHandler = appSource.slice(
    appSource.indexOf("const languageButton = e.target.closest('[data-report-lang]')"),
    appSource.indexOf("const lighthouseRetry = e.target.closest('[data-action=\"retry-lighthouse\"]')"),
  );
  assert.match(languageHandler, /renderEvidenceCheckSummaryBar\(currentAuditData\)/);
  assert.match(languageHandler, /updatePerformanceContext\(currentAuditData\)/);
});

test('full Markdown export includes every failure, score caps, unavailable checks and one handoff prompt', () => {
  const checks = Array.from({ length: 5 }, (_, index) => ({
    id: `seo.failure_${index + 1}`,
    category: 'seo',
    title: `Failure ${index + 1}`,
    status: 'fail',
    severity: index === 0 ? 'major' : 'minor',
    weight: 1,
    confidence: 0.9,
    source: 'fixture',
    page_url: `https://example.com/page-${index + 1}`,
    evidence: [`evidence ${index + 1}`],
  }));
  checks.push(
    { id: 'seo.provider_unknown', category: 'seo', title: 'Provider unknown', status: 'unknown', severity: 'major', weight: 1, source: 'provider', evidence: ['quota'] },
    { id: 'geo.not_applicable', category: 'geo', title: 'Not applicable', status: 'not_applicable', severity: 'minor', weight: 1, source: 'fixture', evidence: [] },
    { id: 'geo.info', category: 'geo', title: 'Information only', status: 'fail', severity: 'info', weight: 0, source: 'fixture', evidence: ['optional'] },
  );
  const recommendations = checks.filter(item => item.status === 'fail' && item.weight > 0).map(item => ({
    id: item.id,
    title: `Repair ${item.title}`,
    severity: item.severity,
    page_url: item.page_url,
    evidence: item.evidence[0],
    why: `Why ${item.id} failed`,
    fix: `Fix ${item.id}`,
    verify: `Verify ${item.id}`,
  }));
  const data = {
    domain: 'example.com',
    mode: 'site',
    audit_context: {
      site_archetype: 'saas',
      industry_vertical: 'software',
      business_model: 'software',
      entity: { name: 'Example', type: 'Organization' },
      locale: 'en',
      root_domain: 'example.com',
      evidence: [{ source: 'JSON-LD', page_url: 'https://example.com/', value: 'Organization: Example' }],
    },
    pages_audited: [{ url: 'https://example.com/', page_type: 'home', status: 'complete' }],
    checks,
    recommendations_v2: recommendations,
    modules: { broken_links: { status: 'skipped', data: { reason: 'optional in anonymous audits' } } },
    score_summary: {
      score_version: '2.2.0',
      status: 'complete',
      overall: { score: 79, raw_score: 95, coverage: 0.86, confidence: 0.9, cap: 79, cap_reasons: [{ code: 'MAJOR_FAILURE', cap: 79, check_ids: ['seo.failure_1'] }] },
      seo: { score: 79, raw_score: 95, coverage: 0.84, confidence: 0.9, cap: 79, cap_reasons: [{ code: 'MAJOR_FAILURE', cap: 79, check_ids: ['seo.failure_1'] }] },
      geo: { score: 100, raw_score: 100, coverage: 1, confidence: 1, cap: 100, cap_reasons: [] },
    },
  };

  const markdown = report.generateFullRepairMarkdown(data, 'en');
  for (let index = 1; index <= 5; index += 1) assert.match(markdown, new RegExp(`seo\\.failure_${index}`));
  assert.match(markdown, /Raw weighted score: 95\/100/);
  assert.match(markdown, /major failure cap 79\/100/);
  assert.match(markdown, /Unknown and error checks/);
  assert.match(markdown, /seo\.provider_unknown/);
  assert.match(markdown, /Not-applicable and informational checks/);
  assert.match(markdown, /geo\.not_applicable/);
  assert.match(markdown, /geo\.info/);
  assert.match(markdown, /Optional capabilities not run/);
  assert.match(markdown, /broken_links/);
  assert.equal((markdown.match(/Unified handoff prompt/g) ?? []).length, 1);
  assert.match(markdown, /Do not invent prices, plans, services/);
  assert.doesNotMatch(markdown, /\/api\/fix/);

  const chinese = report.generateFullRepairMarkdown(data, 'zh');
  assert.match(chinese, /GeoScore 完整修复报告/);
  assert.match(chinese, /全部失败项与修复方案/);
});

test('primary Markdown download is deterministic while per-item fix packs remain optional', () => {
  const evidenceGenerator = reportExportSource.slice(
    reportExportSource.indexOf('function generateEvidenceAgentMarkdown'),
    reportExportSource.indexOf('function generateAgentMarkdown'),
  );
  const downloader = reportExportSource.slice(
    reportExportSource.indexOf('function downloadAgentMarkdown'),
    reportExportSource.indexOf('// ── Formatted PDF Report Window'),
  );
  assert.match(evidenceGenerator, /generateFullRepairMarkdown/);
  assert.doesNotMatch(evidenceGenerator, /normalizeActions|\/api\/fix/);
  assert.match(downloader, /GEOSCORE-REPAIR-\$\{domain\}\.md/);
  assert.doesNotMatch(downloader, /\/api\/fix/);
  assert.match(report.renderEvidenceRecommendations({ recommendations_v2: [{ id: 'seo.title', title: 'Title' }] }, 'en'), /Advanced fix details/);
});

test('formatted report export writes and closes the opened document', () => {
  let html = '';
  let closed = false;
  const opened = {
    document: {
      write(value) { html = value; },
      close() { closed = true; },
    },
  };
  const exporter = reportExport.create({
    reportUi: report,
    getReportLanguage: () => 'en',
    document: {},
    window: { open: () => opened },
    Blob,
    URL,
  });

  exporter.open({
    domain: 'example.com',
    score_summary: {
      overall: { score: 70 },
      seo: { score: 72 },
      geo: { score: 68 },
    },
    modules: {},
  });

  assert.match(html, /SEO Audit Report — example\.com/);
  assert.equal(closed, true);
});

test('frontend merges audit-bound Lighthouse evidence back into the active report', () => {
  assert.match(appSource, /lighthouseParams\.set\('audit_id', currentAuditId\)/);
  assert.match(appSource, /json\.audit_update/);
  assert.match(appSource, /renderFullAudit\(currentAuditData\)/);
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
  assert.match(assistantSource, /audit_id: auditId/);
  assert.match(assistantSource, /recommendation_id: recommendationId/);
  assert.match(assistantSource, /output: 'full'/);
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
  assert.match(source, /page\.fetchSource === 'browser_run'/);
  assert.match(source, /t\.browserRendered/);
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

test('evidence report uses native progressive disclosure while keeping the top three action identity visible', () => {
  const data = {
    domain: 'example.com',
    audit_context: {
      site_archetype: 'personal_blog',
      confidence: 0.9,
      locale: 'en',
      evidence: [{ source: 'JSON-LD', value: 'Blog + Person' }],
    },
    pages_audited: [{ url: 'https://example.com/', page_type: 'home', status: 'complete' }],
    score_summary: {
      score_version: '2.2.0',
      overall: { score: 79, raw_score: 95, coverage: 0.9, confidence: 0.9, cap: 79, cap_reasons: [{ code: 'MAJOR_FAILURE', cap: 79, check_ids: ['seo.title'] }] },
      seo: { score: 79, raw_score: 95, coverage: 0.9, confidence: 0.9, cap: 79, cap_reasons: [{ code: 'MAJOR_FAILURE', cap: 79, check_ids: ['seo.title'] }] },
      geo: { score: 100, raw_score: 100, coverage: 1, confidence: 1, cap: 100, cap_reasons: [] },
    },
    recommendations_v2: [{
      id: 'seo.title',
      title: 'Add a page title',
      severity: 'major',
      page_url: 'https://example.com/post',
      evidence: 'title missing',
      why: 'A title is required.',
      fix: 'Add title.',
      verify: 'Re-audit.',
    }],
    checks: [{ id: 'seo.title', title: 'Page title', status: 'fail', weight: 2, evidence: ['title missing'] }],
  };
  const summary = report.renderEvidenceSummary(data, 'en', 'en');
  assert.match(summary, /<details[^>]+data-disclosure="score-limits"/);
  assert.match(summary, /<details[^>]+data-disclosure="profile-pages"/);
  assert.match(summary, /<details[^>]+data-disclosure="top-action-details"/);
  assert.doesNotMatch(summary, /<details[^>]+open/);
  assert.ok(summary.indexOf('Add a page title') < summary.indexOf('Evidence and verification'));
  assert.ok(summary.indexOf('major') < summary.indexOf('title missing'));

  const checks = report.renderNormalizedChecks(data, 'en');
  const repairs = report.renderEvidenceRecommendations(data, 'en');
  assert.match(checks, /data-disclosure="normalized-checks"/);
  assert.match(repairs, /data-disclosure="full-repair-plan"/);
  assert.match(repairs, /data-disclosure="repair-action-details"/);
  assert.match(printCss, /details\s*>\s*:not\(summary\)\s*\{\s*display:\s*block\s*!important/);
});

test('Evidence Map keeps source provenance and provider runs in a closed native details region', () => {
  const data = { audit_id: '01JGEOSCORE23EVIDENCEMAP', domain: 'example.com' };
  const snapshot = {
    status: 'complete',
    observed_at: '2026-07-15T00:00:00Z',
    affects_score: false,
    target: { appearances: 1, observed_queries: ['Example docs'] },
    query_plan: { queries: [{ query: 'Example docs', intent: 'branded' }] },
    opportunities: [{ query: 'Example tutorial', intent: 'informational', reason: 'target_not_observed' }],
    diagnosis: [{ stage: 'discovery', status: 'pass', evidence: ['Target observed.'] }],
    sources: [{ title: 'Example docs', canonical_url: 'https://example.com/docs', provider: 'search-api-a', provider_rank: 2, source_type: 'audited_site', domain: 'example.com', retrieved_at: '2026-07-15T00:00:00Z' }],
    search_snapshot: { provider_runs: [{ provider: 'search-api-a', status: 'complete', result_count: 1, latency_ms: 120, cache_hit: false }] },
    limitations: ['Search results do not prove consumer answer citations.'],
  };
  const html = report.renderEvidenceMap(data, 'en', { snapshot, busy: false });
  assert.match(html, /Query Evidence Map/);
  assert.match(html, /Search snapshots never change the factual score/);
  assert.match(html, /data-action="run-evidence-map"/);
  assert.match(html, /data-disclosure="evidence-provenance"/);
  assert.doesNotMatch(html, /<details[^>]+open/);
  assert.ok(html.indexOf('data-disclosure="evidence-provenance"') < html.indexOf('search-api-a'));
});

test('monitoring UI shows the management token once, folds history and never re-renders a BYOK value', () => {
  const html = report.renderMonitoring({ audit_id: '01JGEOSCORE23MONITOR', domain: 'example.com' }, 'en', {
    project: {
      id: 'mon_01JGEOSCORE23MONITORING',
      root_domain: 'example.com',
      schedule: 'weekly',
      queries: [{ query: 'Example docs', intent: 'branded' }],
    },
    managementToken: 'gmt_one_time_management_token',
    showToken: true,
    runs: [{ id: 'mrun_1', status: 'complete', run_type: 'default', factual_score: 78, score_delta: null, baseline_action: 'established', created_at: 1784073600 }],
  });
  assert.match(html, /gmt_one_time_management_token/);
  assert.match(html, /Shown once/);
  assert.match(html, /data-disclosure="monitoring-history"/);
  assert.match(html, /type="password" name="api_key"/);
  assert.doesNotMatch(html, /name="api_key"[^>]+value=/);
  assert.doesNotMatch(html, /<details[^>]+open/);

  const byokHandler = monitoringSource.slice(
    monitoringSource.indexOf("if (form.dataset.monitorForm === 'byok')"),
    monitoringSource.indexOf('function handleClick', monitoringSource.indexOf("if (form.dataset.monitorForm === 'byok')")),
  );
  assert.match(byokHandler, /input\.value = ''/);
  assert.ok(byokHandler.indexOf("input.value = ''") < byokHandler.indexOf('run({ apiKey })'));
  assert.match(monitoringSource, /X-API-Key/);
  assert.doesNotMatch(`${appSource}\n${monitoringSource}`, /localStorage\.(?:setItem|getItem)\([^\n]*api[_-]?key/i);
});

test('monitoring email verification consumes and removes the URL token before reporting status', () => {
  const handler = monitoringSource.slice(
    monitoringSource.indexOf('async function verifyEmailFromUrl'),
    monitoringSource.indexOf('async function loadHistory'),
  );
  assert.match(handler, /searchParams\.delete\('monitor_project'\)/);
  assert.match(handler, /searchParams\.delete\('verify'\)/);
  assert.ok(handler.indexOf('history.replaceState') < handler.indexOf('await fetchJson'));
  assert.match(handler, /\/email\/verify/);
  assert.match(handler, /auxiliaryError\?\.\(error, verificationToken\)/);
});

test('full Markdown download includes Evidence Map, limitations, monitoring history and grouped repairs without per-item generation', () => {
  const data = {
    audit_id: '01JGEOSCORE23REPORT',
    domain: 'example.com',
    audit_context: { site_archetype: 'documentation', root_domain: 'example.com', locale: 'en', evidence: [] },
    score_summary: {
      score_version: '2.2.0',
      overall: { score: 70, raw_score: 70, coverage: 1, confidence: 1, cap: 100, cap_reasons: [] },
      seo: { score: 70, raw_score: 70, coverage: 1, confidence: 1, cap: 100, cap_reasons: [] },
      geo: { score: 70, raw_score: 70, coverage: 1, confidence: 1, cap: 100, cap_reasons: [] },
    },
    checks: [{ id: 'seo.title', title: 'Title', status: 'fail', severity: 'major', weight: 2, source: 'html', evidence: ['missing title'] }],
    recommendations_v2: [{ id: 'seo.title', title: 'Add title', severity: 'major', evidence: 'missing title', why: 'missing', fix: 'add title', verify: 're-audit' }],
    repair_groups: [{ id: 'repair-parse-a', stage: 'parse', severity: 'major', check_ids: ['seo.title'], evidence_items: [{ check_id: 'seo.title', observed: ['missing title'] }], tasks: [{ check_id: 'seo.title', title: 'Add title', fix: 'add title', verify: 're-audit' }], verification_steps: ['re-audit'] }],
    evidence_map: { status: 'complete', observed_at: '2026-07-15T00:00:00Z', affects_score: false, target: { appearances: 1 }, query_plan: { queries: [{ query: 'Example docs', intent: 'branded' }] }, opportunities: [], diagnosis: [], sources: [{ title: 'Example', canonical_url: 'https://example.com/', provider: 'search-api-a', provider_rank: 1 }], search_snapshot: { provider_runs: [{ provider: 'search-api-a', status: 'complete', result_count: 1, latency_ms: 10 }] }, limitations: ['Search is a dated snapshot.'] },
    monitoring_history: [{ created_at: 1784073600, run_type: 'default', status: 'complete', factual_score: 70, score_delta: null, baseline_action: 'established' }],
  };
  const markdown = report.generateFullRepairMarkdown(data, 'en');
  assert.match(markdown, /Repair groups by page and root cause/);
  assert.match(markdown, /repair-parse-a/);
  assert.match(markdown, /Query Evidence Map/);
  assert.match(markdown, /search-api-a/);
  assert.match(markdown, /Monitoring history/);
  assert.match(markdown, /Search is a dated snapshot/);
  assert.doesNotMatch(markdown, /\/api\/fix/);
  assert.match(appSource, /reportExportController\.download\(currentAuditData \|\| data\)/);
});
