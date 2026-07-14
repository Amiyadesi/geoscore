import type { Env, ModuleResult } from '../lib/types';
import { createSseStream } from '../lib/sse';
import { getCachedAudit, setCachedAudit } from '../lib/cache';
import { detectBotChallenge } from '../lib/bot-detection';
import { SubrequestBudget, budgetedFetcher } from '../lib/subrequest-budget';
import {
  buildAuditContext,
  buildNormalizedChecks,
  buildRecommendations,
  scoreChecks,
  type ScoreSummary,
  type SiteArchetype,
} from '../lib/audit-core';
import {
  discoverSitemapPageUrls,
  classifyAuditPageType,
  extractInternalLinks,
  fetchAuditPage,
  selectAuditPageCandidates,
  summarizeAuditPage,
  type AuditMode,
  type AuditPageCandidate,
  type FetchedAuditPage,
} from '../lib/audit-pages';
import { upsertBusiness } from '../modules/resolver';
import { runTechnicalSeo } from '../modules/technical_seo';
import { runSchemaAudit } from '../modules/schema_audit';
import { runAuthority } from '../modules/authority';
import { runGeoPredicted, detectVertical, detectLocation } from '../modules/geo_predicted';
import { runContentQuality } from '../modules/content_quality';
import { runOnPageSeo } from '../modules/on_page_seo';
import { runAccessibility } from '../modules/accessibility';
import { runCrux } from '../modules/crux';
import { runRobotsSitemap } from '../modules/robots_sitemap';
import { runMobileAudit } from '../modules/mobile_audit';
import { runHtmlValidation } from '../modules/html_validator';
import { runCommonCrawlPresence } from '../modules/common_crawl';

import { monotonicFactory } from 'ulid';

const ulid = monotonicFactory();

export interface AuditRequestOptions {
  mode?: AuditMode;
  targetUrl?: string | null;
  archetypeHint?: SiteArchetype | string | null;
}

/** Normalise raw domain input — strip protocol, path, port, query, leading dots */
export function normaliseDomain(raw: string): string {
  let d = raw.trim().toLowerCase();
  d = d.replace(/^https?:\/\//i, '');
  d = d.replace(/[/?#].*$/, '');      // strip path / query / fragment
  d = d.replace(/:\d+$/, '');         // strip port
  d = d.replace(/^\.+|\.+$/g, '');    // strip leading/trailing dots
  return d;
}

export async function runModule(
  name: string,
  fn: () => Promise<unknown>,
  timeoutMs: number
): Promise<ModuleResult> {
  const start = Date.now();
  try {
    const data = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${name} timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
    const evidenceStatus = data && typeof data === 'object'
      ? (data as { status?: unknown }).status
      : null;
    const providerError = data && typeof data === 'object'
      ? (data as { error?: { message?: unknown } }).error?.message
      : null;
    return {
      status: evidenceStatus === 'error' ? 'partial' : 'ok',
      data,
      ...(evidenceStatus === 'error' && typeof providerError === 'string' ? { error: providerError } : {}),
      duration_ms: Date.now() - start,
    };
  } catch (err) {
    return { status: 'failed', error: (err as Error).message, duration_ms: Date.now() - start };
  }
}

export function handleAudit(domain: string, env: Env, options: AuditRequestOptions = {}): Response {
  const cleanDomain = normaliseDomain(domain);
  const mode: AuditMode = options.mode ?? 'site';
  const targetUrl = options.targetUrl ?? null;
  const archetypeHint = options.archetypeHint ?? null;
  const cacheScope = { mode, targetUrl, archetypeHint };

  return createSseStream(async (emit) => {
    emit('progress', { module: 'cache', status: 'checking' });
    const cached = await getCachedAudit(env, cleanDomain, cacheScope);
    if (cached) {
      const parsed = JSON.parse(cached);
      emit('section', { module: 'cache_hit', status: 'ok', data: parsed });
      emit('complete', parsed);
      return;
    }

    const business = { name: cleanDomain, domain: cleanDomain };
    const businessId = await upsertBusiness(business, env);
    const auditId = ulid();

    await env.DB.prepare(
      `INSERT INTO audits (id, business_id, status) VALUES (?, ?, 'running')`
    ).bind(auditId, businessId).run();

    const modules: Record<string, ModuleResult> = {};
    // Workers Free allows 50 subrequests per invocation. Track 36 explicit
    // external/service calls and leave headroom for D1/KV/cache operations.
    const externalBudget = new SubrequestBudget(36, 'audit.external');
    const pageBudget = externalBudget.child('pages', 14);
    const coreBudget = externalBudget.child('core', 15);
    const aiBudget = externalBudget.child('ai', 4);
    const optionalBudget = externalBudget.child('optional', 3);
    const pageFetcher = budgetedFetcher(pageBudget, undefined, 'page');

    // ── Bounded page discovery/fetch ─────────────────────────────────────────
    // The first page remains the module target. Site mode then adds an About page
    // plus deterministic representative pages, capped at five total HTML documents.
    const homeUrl = `https://${cleanDomain}/`;
    const requestedUrl = targetUrl ?? homeUrl;
    const primaryCandidate: AuditPageCandidate = {
      url: requestedUrl,
      page_type: classifyAuditPageType(requestedUrl),
      source: 'requested',
    };
    const browserAttemptState = { attempted: false };
    const primaryPage = await fetchAuditPage(primaryCandidate, pageFetcher, {
      httpFallbackUrl: mode === 'site' && requestedUrl.startsWith('https://')
        ? requestedUrl.replace(/^https:/, 'http:')
        : undefined,
      browserFallback: {
        binding: env.BROWSER,
        budgetKv: env.BUDGET_KV,
        dailyBudgetSeconds: env.DAILY_BROWSER_BUDGET_SECONDS,
        subrequestBudget: pageBudget,
        attemptState: browserAttemptState,
      },
    });

    const auditPages: FetchedAuditPage[] = [primaryPage];
    if (mode === 'url' && primaryPage.page_type !== 'home') {
      const homepage = await fetchAuditPage({ url: homeUrl, page_type: 'home', source: 'homepage' }, pageFetcher);
      if (!auditPages.some(page => page.final_url === homepage.final_url)) auditPages.push(homepage);
    } else if (mode === 'site' && primaryPage.status === 'complete') {
      const internalLinks = extractInternalLinks(primaryPage.final_url, primaryPage.html);
      const sitemapUrls = await discoverSitemapPageUrls(primaryPage.final_url, primaryPage.html, pageFetcher);
      const candidates = selectAuditPageCandidates(primaryPage.final_url, internalLinks, sitemapUrls)
        .filter(candidate => candidate.url !== primaryPage.final_url)
        .slice(0, Math.max(0, 5 - auditPages.length));
      const sampled = await Promise.all(candidates.map(candidate => fetchAuditPage(candidate, pageFetcher)));
      auditPages.push(...sampled);
    }

    const sharedHtml = primaryPage.html;
    const sharedHeaders = primaryPage.headers;
    const sharedFinalUrl = primaryPage.final_url;
    const sharedStatusCode = primaryPage.status_code;
    const sharedResponseMs = primaryPage.response_ms;

    // ── Bot-challenge / WAF interstitial detection ────────────────────────────
    // Some sites detect automated fetches and serve a CAPTCHA or WAF challenge
    // page instead of real content.  Running analysis on a challenge page produces
    // entirely false findings: noindex flagged as critical, zero schema, thin
    // content, missing H1/H2, no contact info — all false positives that erode
    // user trust in the tool.
    //
    // Strategy:
    //   • detectBotChallenge() uses 4 layers: HTTP 403 → URL path → title → body.
    //   • When a challenge is detected we set contentHtml = '' so that every
    //     content-analysis module receives an empty string and returns its
    //     graceful empty-state instead of fabricated findings.
    //   • security_audit is the only module that still receives sharedHtml because
    //     its checks are header-based; the raw HTML is only used for `html.length > 0`
    //     (HTTPS-available check) which remains valid even for challenge pages.
    //   • geo_predicted and keywords also receive sharedHtml — they run their own
    //     bot-challenge fallback internally (domain-only inference), which is the
    //     correct behaviour (we still want keyword/GEO output, just domain-derived).
    const botChallenge = detectBotChallenge(sharedHtml, sharedFinalUrl, sharedStatusCode);
    const sharedHtmlIsBotChallenge = botChallenge.isChallenge || /bot challenge|captcha|waf/i.test(primaryPage.error ?? '');

    // contentHtml: blank when bot-blocked so NO content module analyses challenge-page data.
    const contentHtml = sharedHtmlIsBotChallenge ? '' : sharedHtml;

    if (sharedHtmlIsBotChallenge) {
      const botBlockedData = {
        reason: botChallenge.reason ?? 'Bot-challenge page detected',
        note: 'This site uses bot protection (WAF / CAPTCHA) that blocked automated ' +
              'page analysis. Module scores reflect domain-level signals only — ' +
              'page content, meta tags, headings, schema and contact info could ' +
              'not be read. Visit the site directly in a browser for full results.',
      };
      // Store in modules so recommendations can detect and suppress content-dependent recs
      modules.bot_blocked = { status: 'partial', data: botBlockedData };
      emit('section', { module: 'bot_blocked', status: 'partial', data: botBlockedData });
    }

    // ── Look up any user-submitted override for this domain (Layer 1) ──────
    let verticalOverride: string | null = null;
    let locationOverride: string | null = null;
    try {
      const override = await env.DB.prepare(
        `SELECT vertical, location FROM domain_overrides WHERE domain = ?`
      ).bind(cleanDomain).first<{ vertical: string | null; location: string | null }>();
      if (override) {
        verticalOverride = override.vertical;
        locationOverride = override.location;
      }
    } catch { /* non-critical */ }

    // ── Layer 3: regex detection first (zero subrequests) ────────────────────
    // Run before Vectorize so we can skip the 2-subrequest embed+query for the
    // majority of sites where the regex already returns a specific vertical.
    // Location is only propagated for local-service verticals — global SaaS/tech sites
    // mention cities in blog posts and testimonials, producing false-positive locations.
    // Skip entirely if sharedHtml is a bot-challenge page — content is useless.
    const LOCAL_SERVICE_VERTICALS = new Set(['dental','legal','fitness','real_estate','hotel','restaurant','food_delivery','medical']);
    if (!verticalOverride && sharedHtml && !sharedHtmlIsBotChallenge) {
      try {
        const titleText = (sharedHtml.match(/<title[^>]*>([^<]{0,200})<\/title>/i) ?? [])[1] ?? '';
        const descText  = (sharedHtml.match(/name=["']description["'][^>]*content=["']([^"']{0,300})["']/i) ?? [])[1] ?? '';
        const bodySnip  = sharedHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 3000);
        const fingerprint = `${titleText} ${descText} ${bodySnip}`.trim();
        const detected = detectVertical(fingerprint);
        // Only set if not generic — keeps Vectorize + AI fallback for ambiguous pages
        if (detected !== 'general') verticalOverride = detected;
        // Only detect location for local-service verticals — not for tech/ecommerce/finance/etc.
        // which mention cities in content but have no meaningful single location.
        if (!locationOverride && LOCAL_SERVICE_VERTICALS.has(detected)) {
          const detectedLoc = detectLocation(fingerprint);
          if (detectedLoc !== 'your area') locationOverride = detectedLoc;
        }
      } catch { /* non-critical */ }
    }

    // Vectorize similarity was intentionally removed from the anonymous v2 hot
    // path. Structured data, navigation, sampled page types and deterministic
    // text signals provide auditable evidence without spending two opaque
    // service subrequests on an industry guess.

    const auditContext = buildAuditContext({
      domain: cleanDomain,
      pages: auditPages,
      industryVertical: verticalOverride,
      locality: locationOverride,
      archetypeHint,
    });
    emit('section', { module: 'audit_context', status: 'ok', data: auditContext });
    emit('section', { module: 'pages_audited', status: 'ok', data: auditPages.map(summarizeAuditPage) });

    // ── Predicted GEO simulation ──────────────────────────────────────────────
    // One generated query set plus at most one model-scored query is enough for
    // the explicitly Predicted panel. Remaining queries use local heuristics.
    emit('progress', { module: 'geo_predicted', status: 'running' });
    modules.geo_predicted = await runModule(
      'geo_predicted',
      () => runGeoPredicted(cleanDomain, env, sharedHtml, verticalOverride, locationOverride, {
        budget: aiBudget,
        allowAiClassification: false,
        maxModelPredictions: 1,
      }),
      30000,
    );
    const geoData = modules.geo_predicted.data as { is_reliable?: boolean } | null;
    if (modules.geo_predicted.status === 'ok' && geoData?.is_reliable === false) {
      modules.geo_predicted.status = 'skipped';
      emit('section', { module: 'geo_predicted', status: 'skipped', data: modules.geo_predicted.data });
    } else {
      emit('section', { module: 'geo_predicted', ...modules.geo_predicted });
    }

    const deterministicReason = 'Skipped in evidence-first mode: deterministic checks and recommendations are authoritative';
    modules.keywords = { status: 'skipped', data: { reason: deterministicReason } };
    emit('section', { module: 'keywords', ...modules.keywords });
    modules.ai_content_insights = { status: 'skipped', data: { reason: deterministicReason } };
    emit('section', { module: 'ai_content_insights', ...modules.ai_content_insights });

    // Secondary pages were already fetched by the bounded sampler and are reused
    // across schema/content modules without another round of network requests.
    const innerPagesHtml = auditPages.slice(1)
      .filter(page => page.status === 'complete')
      .map(page => page.html);
    const robotsFetcher = budgetedFetcher(coreBudget.child('robots', 3), undefined, 'robots');
    const earlyRobotsSitemapPromise = runModule(
      'robots_sitemap',
      () => runRobotsSitemap(cleanDomain, sharedHtmlIsBotChallenge, contentHtml, {
        fetcher: robotsFetcher,
        maxRobotsCandidates: 1,
        maxSitemapCandidates: 2,
      }),
      20000,
    );

    // ── All modules in parallel — stream each result as it lands ──────────
    // NOTE: Lighthouse is NOT in this list — it runs via /api/lighthouse (own Worker
    // invocation) to avoid hitting the 50 subrequest/invocation limit on free plan.
    const PROGRESS_MODULES = [
      'technical_seo','schema_audit','content_quality','authority',
      'on_page_seo','accessibility','crux','robots_sitemap','mobile_audit',
      'html_validator','common_crawl',
    ];
    PROGRESS_MODULES.forEach(m => emit('progress', { module: m, status: 'running' }));

    const legacySkipReason = 'Skipped in the v2 anonymous audit to keep the Cloudflare Workers Free request budget deterministic';
    const budgetSkippedModules = [
      'off_page_seo',
      'site_intel',
      'redirect_chain',
      'security_audit',
      'ssl_cert',
      'domain_intel',
      'broken_links',
    ] as const;
    for (const moduleName of budgetSkippedModules) {
      const result: ModuleResult = { status: 'skipped', data: { reason: legacySkipReason } };
      modules[moduleName] = result;
      emit('section', { module: moduleName, ...result });
    }

    const technicalFetcher = budgetedFetcher(coreBudget.child('technical', 4), undefined, 'technical');
    const authorityFetcher = budgetedFetcher(coreBudget.child('authority', 6), undefined, 'authority');
    const cruxFetcher = budgetedFetcher(coreBudget.child('crux', 2), undefined, 'crux');
    const htmlValidatorFetcher = budgetedFetcher(optionalBudget.child('html_validator', 1), undefined, 'w3c');
    const commonCrawlFetcher = budgetedFetcher(optionalBudget.child('common_crawl', 2), undefined, 'common-crawl');

    await Promise.all([
      runModule('technical_seo', () => runTechnicalSeo(
        cleanDomain,
        contentHtml,
        sharedHeaders,
        sharedResponseMs,
        sharedFinalUrl,
        { fetcher: technicalFetcher, includeAdsTxt: false },
      ), 22000).then(r => {
        modules.technical_seo = r;
        emit('section', { module: 'technical_seo', ...r });
      }),
      runModule('schema_audit', () => runSchemaAudit(cleanDomain, contentHtml, innerPagesHtml, auditContext.site_archetype), 15000).then(r => {
        modules.schema_audit = r;
        emit('section', { module: 'schema_audit', ...r });
      }),
      runModule('content_quality', () => runContentQuality(cleanDomain, contentHtml, innerPagesHtml), 15000).then(r => {
        modules.content_quality = r;
        emit('section', { module: 'content_quality', ...r });
      }),
      runModule('authority', () => runAuthority(
        auditContext.root_domain,
        auditContext.entity?.name ?? auditContext.root_domain,
        env.OPENPAGERANK_KEY,
        { fetcher: authorityFetcher, maxKnowledgeCandidates: 1, maxRdapEndpoints: 2 },
      ), 25000).then(r => {
        modules.authority = r;
        emit('section', { module: 'authority', ...r });
      }),
      runModule('on_page_seo', () => runOnPageSeo(cleanDomain, contentHtml), 30000).then(r => {
        modules.on_page_seo = r;
        emit('section', { module: 'on_page_seo', ...r });
      }),
      runModule('accessibility', () => runAccessibility(cleanDomain, contentHtml), 30000).then(r => {
        modules.accessibility = r;
        emit('section', { module: 'accessibility', ...r });
      }),
      runModule('crux', () => runCrux(cleanDomain, env, { fetcher: cruxFetcher }), 15000).then(r => {
        modules.crux = r;
        emit('section', { module: 'crux', ...r });
      }),
      earlyRobotsSitemapPromise.then(r => {
        modules.robots_sitemap = r;
        emit('section', { module: 'robots_sitemap', ...r });
      }),
      runModule('mobile_audit', () => Promise.resolve(runMobileAudit(cleanDomain, contentHtml)), 5000).then(r => {
        modules.mobile_audit = r;
        emit('section', { module: 'mobile_audit', ...r });
      }),
      (primaryPage.status === 'complete'
        ? runModule('html_validator', () => runHtmlValidation(primaryPage.final_url, { fetcher: htmlValidatorFetcher }), 15000)
        : Promise.resolve<ModuleResult>({ status: 'skipped', error: 'Primary HTML page was unavailable' })
      ).then(r => {
        modules.html_validator = r;
        emit('section', { module: 'html_validator', ...r });
      }),
      runModule('common_crawl', () => runCommonCrawlPresence(auditContext.root_domain, { fetcher: commonCrawlFetcher }), 23000).then(r => {
        modules.common_crawl = r;
        emit('section', { module: 'common_crawl', ...r });
      }),
      // Lighthouse intentionally omitted — runs via /api/lighthouse (separate invocation)
      // to stay within Cloudflare's 50-subrequest-per-invocation free-plan limit.
    ]);

    // ── Evidence-first scoring and recommendations ─────────────────────────
    const checks = buildNormalizedChecks(auditContext, auditPages, modules);
    const scoreSummary = scoreChecks(checks);
    const scores = projectLegacyScores(scoreSummary, modules);
    emit('section', { module: 'score_summary', status: 'ok', data: scoreSummary });

    emit('progress', { module: 'recommendations', status: 'running' });
    const recommendationsV2 = buildRecommendations(auditContext, checks);
    modules.recommendations = { status: 'ok', data: recommendationsV2 };
    emit('section', { module: 'recommendations', ...modules.recommendations });

    const fullAudit = {
      audit_id: auditId,
      business_id: businessId,
      domain: cleanDomain,
      mode,
      target_url: requestedUrl,
      score_version: scoreSummary.score_version,
      audit_context: auditContext,
      pages_audited: auditPages.map(summarizeAuditPage),
      checks,
      score_summary: scoreSummary,
      recommendations_v2: recommendationsV2,
      external_request_budget: externalBudget.snapshot(),
      ...scores,
      modules,
      created_at: Date.now(),
    };

    await env.DB.prepare(
      `UPDATE audits SET status='complete', foundation_score=?, weakness_score=?,
       summary_json=?, full_json=?, completed_at=unixepoch() WHERE id=?`
    ).bind(scores.seo_score, scores.geo_score, '', JSON.stringify(fullAudit), auditId).run();

    // 6-hour TTL lets users fix issues and re-audit the same day without seeing stale results.
    // Fall back to 2 hours when AI was unavailable so quota-refresh is caught sooner.
    const finalGeoData = modules.geo_predicted?.data as { is_reliable?: boolean } | null | undefined;
    const cacheTtl = finalGeoData?.is_reliable === false ? 60 * 60 * 2 : 60 * 60 * 6;
    await setCachedAudit(env, cleanDomain, auditId, cacheTtl, cacheScope);
    emit('complete', fullAudit);
  });
}

// ── Normalised 0-100 scoring ──────────────────────────────────────────────

interface Scores {
  seo_score: number | null;
  geo_score: number | null;
  overall_score: number | null;
  aeo_score: number | null;
  // keep legacy fields so existing D1 schema works
  foundation_score: number | null;
  weakness_score: number | null;
}

function projectLegacyScores(summary: ScoreSummary, modules: Record<string, ModuleResult>): Scores {
  const seo_score = summary.seo.score;
  const geo_score = summary.geo.score;
  const overall_score = summary.overall.score;
  const aeo_score = overall_score === null ? null : computeAeoScore(modules);
  // The legacy D1 columns are consumed as SEO/GEO projections by recent/history
  // endpoints despite their historical names. Keep them lossless and nullable.
  const foundation_score = seo_score;
  const weakness_score = geo_score;
  return { seo_score, geo_score, overall_score, aeo_score, foundation_score, weakness_score };
}

// ── AEO Score — Answer Engine Optimisation (0-100, rule-based) ────────────────
// Signals that make content more likely to be cited/surfaced by AI answer engines
// (ChatGPT, Perplexity, Google AI Overviews, Claude, etc.)
function computeAeoScore(modules: Record<string, ModuleResult>): number {
  const schema    = modules.schema_audit?.data   as Record<string, any> | undefined;
  const tech      = modules.technical_seo?.data  as Record<string, any> | undefined;
  const content   = modules.content_quality?.data as Record<string, any> | undefined;
  const authority = modules.authority?.data       as Record<string, any> | undefined;

  let pts = 0;

  // ── Off-site entity authority ──────────────────────────────────────────────
  // Wikipedia/Wikidata = the brand is a known entity in LLM training data.
  // Open PageRank = how widely cited the domain is across the web, which
  // correlates directly with AI training-data inclusion and citation likelihood.
  // Without these, large well-known brands would score unfairly low purely
  // because their homepage lacks FAQ schema.
  if (authority?.wikipedia)       pts += 18; // Wikipedia page = major entity signal
  if (authority?.wikidata_id)     pts += 8;  // Wikidata entry = structured knowledge graph presence
  const pageRank: number = authority?.page_rank ?? 0;
  if (pageRank >= 7)              pts += 14;
  else if (pageRank >= 5)         pts += 10;
  else if (pageRank >= 3)         pts += 6;
  else if (pageRank >= 1)         pts += 3;

  // ── Schema signals ─────────────────────────────────────────────────────────
  const schemaTypes = new Set<string>(schema?.schemas_found ?? []);
  if (schemaTypes.has('FAQPage'))                                          pts += 20; // highest AEO signal
  if (schemaTypes.has('QAPage'))                                           pts += 15;
  if (schemaTypes.has('HowTo'))                                            pts += 14;
  if (schemaTypes.has('Speakable'))                                        pts += 10;
  if (schemaTypes.has('Article') || schemaTypes.has('BlogPosting') ||
      schemaTypes.has('NewsArticle') || schemaTypes.has('TechArticle'))   pts += 8;
  if (schemaTypes.has('BreadcrumbList'))                                   pts += 5;  // navigation clarity

  // ── Question-format headings ───────────────────────────────────────────────
  // AI engines extract Q&A pairs from H2/H3 that contain question marks
  const h2Tags: string[] = tech?.h2_tags ?? [];
  const questionHeadings = h2Tags.filter((h: string) => h.trim().endsWith('?')).length;
  if (questionHeadings >= 5)       pts += 15;
  else if (questionHeadings >= 3)  pts += 10;
  else if (questionHeadings >= 1)  pts += 5;

  // ── Meta description ───────────────────────────────────────────────────────
  // A concise, factual description (50-160 chars) is often used verbatim by AI
  const metaDesc: string = tech?.page_meta?.description ?? '';
  if (metaDesc.length >= 50 && metaDesc.length <= 160) pts += 8;

  // ── Content depth ──────────────────────────────────────────────────────────
  const wordCount: number = content?.word_count ?? 0;
  if (wordCount >= 1500)       pts += 10;
  else if (wordCount >= 800)   pts += 7;
  else if (wordCount >= 400)   pts += 3;

  // ── Content quality ────────────────────────────────────────────────────────
  const contentScore: number = content?.score ?? 0;
  if (contentScore >= 75) pts += 5;

  // ── Schema richness (multiple structured types = well-organised content) ───
  if ((schema?.schemas_found?.length ?? 0) >= 4) pts += 5;

  return Math.min(100, pts);
}
