(function (global) {
  'use strict';

  const COPY = {
    en: {
      profile: 'Site profile',
      confidence: 'Confidence',
      coverage: 'Coverage',
      entity: 'Entity',
      industry: 'Industry',
      businessModel: 'Business model',
      locality: 'Locality',
      rootDomain: 'Root domain',
      evidence: 'Classification evidence',
      pages: 'Pages audited',
      actions: 'Top evidenced actions',
      observed: 'Observed',
      reason: 'Why it failed',
      fix: 'Fix',
      verify: 'Verify',
      page: 'Page',
      reportLanguage: 'Report language',
      unknown: 'Unknown',
      notProvided: 'Not provided',
      insufficient: 'Insufficient evidence',
      predicted: 'Predicted',
      lighthouseComplete: 'Both PageSpeed strategies completed.',
      lighthousePartial: 'PageSpeed returned a partial result. Available scores are shown; failed strategies are not scored.',
      lighthouseError: 'PageSpeed Insights could not complete this audit.',
      noNumericScore: 'No numeric score returned',
      retry: 'Retry PageSpeed',
      source: 'Source',
      mobile: 'Mobile',
      desktop: 'Desktop',
      complete: 'Complete',
      error: 'Error',
      metrics: 'Lab metrics',
      opportunities: 'performance opportunities',
      scoreEvidence: 'Scores include only known, applicable checks.',
      scoreInsufficient: 'There is not enough known, applicable evidence to publish a defensible overall score.',
      auditedLocale: 'Audited locale',
      correctType: 'Correct type',
      browserRendered: 'Browser Run rendered',
    },
    zh: {
      profile: '站点画像',
      confidence: '识别置信度',
      coverage: '证据覆盖率',
      entity: '实体',
      industry: '行业方向',
      businessModel: '业务模式',
      locality: '地域',
      rootDomain: '根域名',
      evidence: '分类证据',
      pages: '已审查页面',
      actions: '证据充分的优先行动',
      observed: '发现',
      reason: '失败原因',
      fix: '修改方式',
      verify: '复验方式',
      page: '页面',
      reportLanguage: '报告语言',
      unknown: '未知',
      notProvided: '未提供',
      insufficient: '证据不足',
      predicted: '预测结果',
      lighthouseComplete: 'PageSpeed 的移动端和桌面端审查均已完成。',
      lighthousePartial: 'PageSpeed 仅返回了部分结果。这里只展示真实返回的分数，失败端不会计分。',
      lighthouseError: 'PageSpeed Insights 未能完成本次审查。',
      noNumericScore: '未返回数值分数',
      retry: '重试 PageSpeed',
      source: '数据来源',
      mobile: '移动端',
      desktop: '桌面端',
      complete: '完成',
      error: '失败',
      metrics: '实验室指标',
      opportunities: '项性能优化机会',
      scoreEvidence: '分数只计算已知且适用的检查项。',
      scoreInsufficient: '当前缺少足够的已知、适用证据，因此不发布可能误导的总分。',
      auditedLocale: '被测页面语言',
      correctType: '纠正类型',
      browserRendered: 'Browser Run 渲染',
    },
  };

  const ARCHETYPE_LABELS = {
    personal_blog: { en: 'Personal blog', zh: '个人博客' },
    editorial: { en: 'Editorial site', zh: '编辑型内容站' },
    news_media: { en: 'News / media', zh: '新闻媒体' },
    documentation: { en: 'Documentation', zh: '文档站' },
    saas: { en: 'SaaS', zh: 'SaaS' },
    ecommerce: { en: 'E-commerce', zh: '电商' },
    local_business: { en: 'Local business', zh: '本地商家' },
    professional_services: { en: 'Professional services', zh: '专业服务' },
    portfolio: { en: 'Portfolio', zh: '作品集' },
    community: { en: 'Community', zh: '社区' },
    nonprofit: { en: 'Nonprofit', zh: '非营利组织' },
    other: { en: 'Other', zh: '其他' },
    unknown: { en: 'Unknown', zh: '未知' },
  };

  function language(value) {
    return /^zh(?:-|_|$)/i.test(String(value || '')) ? 'zh' : 'en';
  }

  function copy(lang) {
    return COPY[language(lang)];
  }

  function llmsTxtView(data, lang) {
    const status = data?.llms_txt_status;
    const present = data?.llms_txt_present ?? data?.has_llms_txt;
    const state = status === 'error'
      ? 'unknown'
      : present === true
        ? 'present'
        : status === 'missing' || present === false
          ? 'missing'
          : 'unknown';
    const zh = language(lang) === 'zh';

    if (state === 'present') {
      return {
        state,
        badge: '✓ llms.txt',
        generatorMessage: zh ? '✓ 站点已存在 llms.txt' : '✓ llms.txt already exists on your site',
        generateLabel: zh ? '重新生成' : 'Re-generate',
        canViewExisting: true,
      };
    }
    if (state === 'missing') {
      return {
        state,
        badge: zh ? '✗ 未找到 llms.txt' : '✗ No llms.txt',
        generatorMessage: zh ? '⚠ 已确认未找到 llms.txt，可在下方生成草稿' : '⚠ No llms.txt found — generate a draft below',
        generateLabel: zh ? '生成 llms.txt 草稿' : 'Generate llms.txt draft',
        canViewExisting: false,
      };
    }
    return {
      state,
      badge: zh ? '⚠ 无法验证 llms.txt' : '⚠ llms.txt could not be verified',
      generatorMessage: zh
        ? '⚠ 当前无法验证站点是否已有 llms.txt。重试审查或手动检查后再覆盖文件。'
        : '⚠ Could not verify whether llms.txt exists. Retry the audit or check the file before replacing it.',
      generateLabel: zh ? '生成草稿' : 'Generate draft',
      canViewExisting: false,
    };
  }

  function readabilityView(readability, lang) {
    const score = readability?.flesch_ease;
    const applicable = readability?.applicable !== false && Number.isFinite(score);
    if (applicable) {
      return {
        applicable: true,
        score,
        label: String(readability?.grade_label || ''),
      };
    }

    const zh = language(lang) === 'zh';
    const notApplicable = readability?.method === 'not_applicable';
    return {
      applicable: false,
      score: null,
      label: notApplicable
        ? (zh ? '不适用于中文/CJK 内容' : 'Not applicable to Chinese/CJK content')
        : String(readability?.grade_label || (zh ? '无法计算' : 'Unavailable')),
    };
  }

  const PUBLIC_DOMAIN_ERROR = 'Only public domains are supported';

  function isPublicHostname(value) {
    const hostname = String(value || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
    if (!hostname || hostname.includes(':') || hostname.includes('/') || hostname.includes('@')) return false;
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) return false;
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes('[') || hostname.includes(']')) return false;
    const labels = hostname.split('.');
    const tld = labels[labels.length - 1] || '';
    if (labels.length < 2) return false;
    if (['corp', 'example', 'home', 'internal', 'invalid', 'lan', 'local', 'localdomain', 'onion', 'test'].includes(tld)) return false;
    if (hostname === 'home.arpa' || hostname.endsWith('.home.arpa')) return false;
    if (!/^(xn--)?(?=[a-z0-9-]{2,63}$)(?=.*[a-z])[a-z0-9-]+$/.test(tld)) return false;
    return labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  }

  function parseAuditInput(rawInput) {
    const raw = String(rawInput || '').trim();
    if (!raw) return { ok: false, domain: '', mode: 'site', targetUrl: null, reason: '' };

    if (/^https?:\/\//i.test(raw)) {
      try {
        const url = new URL(raw);
        const domain = url.hostname.toLowerCase();
        if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port || !isPublicHostname(domain)) {
          return { ok: false, domain, mode: 'url', targetUrl: null, reason: PUBLIC_DOMAIN_ERROR };
        }
        url.hash = '';
        return { ok: true, domain, mode: 'url', targetUrl: url.toString(), reason: '' };
      } catch {
        return { ok: false, domain: '', mode: 'url', targetUrl: null, reason: PUBLIC_DOMAIN_ERROR };
      }
    }

    const domain = raw.toLowerCase().replace(/^\.+|\.+$/g, '');
    if (!isPublicHostname(domain) || /[/?#@\[\]]/.test(raw)) {
      return { ok: false, domain, mode: 'site', targetUrl: null, reason: PUBLIC_DOMAIN_ERROR };
    }
    return { ok: true, domain, mode: 'site', targetUrl: null, reason: '' };
  }

  function normalizeAuditRequest(request) {
    const parsed = request?.domain
      ? { ok: isPublicHostname(request.domain), domain: String(request.domain).toLowerCase(), mode: request.mode === 'url' ? 'url' : 'site', targetUrl: request.targetUrl ?? null }
      : parseAuditInput(request?.input ?? request);
    const hint = String(request?.archetypeHint ?? request?.archetype_hint ?? '');
    return {
      ok: parsed.ok,
      domain: parsed.domain,
      mode: parsed.mode,
      targetUrl: parsed.mode === 'url' ? parsed.targetUrl : null,
      archetypeHint: Object.prototype.hasOwnProperty.call(ARCHETYPE_LABELS, hint) ? hint : null,
    };
  }

  function buildAuditEndpoint(apiBase, request, options) {
    const normalized = normalizeAuditRequest(request);
    if (!normalized.ok || (normalized.mode === 'url' && !normalized.targetUrl)) return null;
    const params = new URLSearchParams();
    if (normalized.mode === 'url') {
      params.set('mode', 'url');
      params.set('url', normalized.targetUrl);
    }
    if (normalized.archetypeHint) params.set('archetype_hint', normalized.archetypeHint);
    if (options?.fresh) params.set('fresh', '1');
    const query = params.toString();
    return `${String(apiBase || '').replace(/\/$/, '')}/api/audit/${encodeURIComponent(normalized.domain)}${query ? `?${query}` : ''}`;
  }

  function buildAuditPageQuery(request) {
    const normalized = normalizeAuditRequest(request);
    if (!normalized.ok || (normalized.mode === 'url' && !normalized.targetUrl)) return '';
    const params = new URLSearchParams({ d: normalized.domain });
    if (normalized.mode === 'url') {
      params.set('mode', 'url');
      params.set('url', normalized.targetUrl);
    }
    if (normalized.archetypeHint) params.set('archetype_hint', normalized.archetypeHint);
    return `?${params.toString()}`;
  }

  function sameScoreVersion(left, right) {
    const leftVersion = firstDefined(left?.scoreVersion, left?.score_version, left?.score_summary?.score_version);
    const rightVersion = firstDefined(right?.scoreVersion, right?.score_version, right?.score_summary?.score_version);
    return typeof leftVersion === 'string' && leftVersion.length > 0 && leftVersion === rightVersion;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function localized(value, lang) {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (Array.isArray(value)) return value.map(item => localized(item, lang)).filter(Boolean).join('; ');
    if (typeof value === 'object') {
      const key = language(lang);
      const candidate = value[key]
        ?? value[key === 'zh' ? 'zh-CN' : 'en-US']
        ?? value.text
        ?? value.message
        ?? value.detail
        ?? value.value
        ?? value.label;
      if (candidate != null && candidate !== value) return localized(candidate, lang);
    }
    return '';
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function metricValue(value) {
    if (value && typeof value === 'object') {
      return finiteNumber(value.score ?? value.value ?? value.percent ?? value.result);
    }
    return finiteNumber(value);
  }

  function percentValue(value) {
    const n = metricValue(value);
    if (n === null) return null;
    return Math.max(0, Math.min(100, n <= 1 ? n * 100 : n));
  }

  function formatPercent(value) {
    const n = percentValue(value);
    return n === null ? null : `${Math.round(n)}%`;
  }

  function firstDefined() {
    for (const value of arguments) {
      if (value !== undefined && value !== null) return value;
    }
    return null;
  }

  function normalizeScoreSummary(data) {
    const summary = data?.score_summary ?? null;
    const scores = summary?.scores ?? summary?.categories ?? {};
    const overallRaw = summary
      ? firstDefined(summary.overall, scores?.overall, summary.overall_score)
      : data?.overall_score;
    const seoRaw = summary
      ? firstDefined(summary.seo, scores?.seo, summary.seo_score)
      : data?.seo_score;
    const geoRaw = summary
      ? firstDefined(summary.geo, scores?.geo, summary.geo_score)
      : data?.geo_score;
    const aeoRaw = summary
      ? firstDefined(summary.aeo, scores?.aeo, summary.aeo_score)
      : data?.aeo_score;
    const overallObject = overallRaw && typeof overallRaw === 'object' ? overallRaw : {};
    return {
      present: Boolean(summary),
      overall: metricValue(overallRaw),
      seo: metricValue(seoRaw),
      geo: metricValue(geoRaw),
      aeo: metricValue(aeoRaw),
      coverage: percentValue(firstDefined(summary?.coverage?.overall, summary?.coverage, overallObject.coverage, summary?.overall_coverage)),
      confidence: percentValue(firstDefined(summary?.confidence?.overall, summary?.confidence, overallObject.confidence, summary?.overall_confidence)),
      scoreVersion: firstDefined(summary?.score_version, data?.score_version),
    };
  }

  function normalizeContext(data) {
    const context = data?.audit_context ?? null;
    if (!context) return null;
    return {
      archetype: context.site_archetype ?? context.archetype ?? 'unknown',
      industry: context.industry_vertical ?? context.industry ?? null,
      businessModel: context.business_model ?? null,
      entity: localized(context.entity?.name ?? context.entity, context.locale),
      locality: localized(context.locality?.name ?? context.locality, context.locale),
      locale: context.locale ?? data?.locale ?? null,
      rootDomain: context.root_domain ?? context.registrable_domain ?? data?.domain ?? null,
      pageTypes: Array.isArray(context.page_types) ? context.page_types : [],
      confidence: percentValue(context.confidence),
      evidence: Array.isArray(context.evidence) ? context.evidence : [],
    };
  }

  function normalizePages(data) {
    const pages = Array.isArray(data?.pages_audited) ? data.pages_audited : [];
    return pages.slice(0, 5).map((page, index) => {
      if (typeof page === 'string') return { url: page, type: index === 0 ? 'home' : 'page', status: null };
      return {
        url: page?.url ?? page?.page_url ?? page?.canonical ?? '',
        type: page?.page_type ?? page?.type ?? page?.kind ?? (index === 0 ? 'home' : 'page'),
        status: page?.status ?? page?.fetch_status ?? null,
        fetchSource: page?.fetch_source ?? null,
        provider: page?.provider ?? null,
        browserMsUsed: page?.browser_ms_used === null || page?.browser_ms_used === undefined
          ? null
          : (Number.isFinite(Number(page.browser_ms_used)) ? Math.round(Number(page.browser_ms_used)) : null),
      };
    }).filter(page => page.url);
  }

  function normalizeActions(data, lang) {
    const priorityRank = { critical: 0, high: 1, medium: 2, low: 3 };
    const actions = Array.isArray(data?.recommendations_v2) ? [...data.recommendations_v2] : [];
    actions.sort((a, b) => {
      const aRank = priorityRank[String(a?.priority ?? '').toLowerCase()] ?? 99;
      const bRank = priorityRank[String(b?.priority ?? '').toLowerCase()] ?? 99;
      return aRank - bRank;
    });
    return actions.slice(0, 3).map((action, index) => {
      const pages = action?.applicable_pages ?? action?.pages ?? action?.page_urls;
      const page = action?.page_url ?? action?.url ?? (Array.isArray(pages) ? pages[0] : pages);
      return {
        id: action?.id ?? `action-${index + 1}`,
        title: localized(action?.title ?? action?.name, lang),
        page: localized(page, lang),
        observed: localized(action?.observed ?? action?.observation ?? action?.evidence, lang),
        reason: localized(action?.reason ?? action?.why, lang),
        fix: localized(action?.fix ?? action?.how_to_fix ?? action?.recommendation, lang),
        verify: localized(action?.verification ?? action?.verify ?? action?.retest, lang),
        predicted: action?.predicted === true || String(action?.certainty ?? action?.source_type ?? '').toLowerCase() === 'predicted',
      };
    });
  }

  function inferReportLanguage(data, fallback) {
    const locale = data?.audit_context?.locale ?? data?.locale ?? data?.language;
    return locale ? language(locale) : language(fallback);
  }

  function archetypeLabel(value, lang) {
    const key = String(value || 'unknown').toLowerCase();
    return ARCHETYPE_LABELS[key]?.[language(lang)] ?? key.replace(/_/g, ' ');
  }

  function compact(value, maxLength) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value));
      return /^https?:$/.test(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  function pageLabel(value) {
    try {
      const url = new URL(String(value));
      return `${url.pathname || '/'}${url.search}`;
    } catch {
      return String(value || '');
    }
  }

  function evidenceText(item, lang) {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object') return '';
    const source = localized(item.source ?? item.detected_by ?? item.type, lang);
    const detail = localized(item.detail ?? item.value ?? item.text ?? item.evidence ?? item.message, lang);
    return [source, detail].filter(Boolean).join(': ');
  }

  function factRow(label, value) {
    if (!value) return '';
    return `<div class="flex gap-2 text-xs leading-relaxed"><dt class="w-28 shrink-0 text-slate-400">${escapeHtml(label)}</dt><dd class="min-w-0 text-slate-700 break-words">${escapeHtml(value)}</dd></div>`;
  }

  function renderEvidenceSummary(data, lang, uiLang) {
    const context = normalizeContext(data);
    const pages = normalizePages(data);
    const actions = normalizeActions(data, lang);
    const scores = normalizeScoreSummary(data);
    if (!context && pages.length === 0 && actions.length === 0 && !scores.present) return '';

    const t = copy(lang);
    const ui = copy(uiLang);
    const evidence = (context?.evidence ?? []).map(item => evidenceText(item, lang)).filter(Boolean).slice(0, 4);
    const confidence = formatPercent(context?.confidence ?? scores.confidence);
    const coverage = formatPercent(scores.coverage);
    const locale = context?.locale ? String(context.locale) : null;

    const profileFacts = [
      factRow(t.entity, context?.entity),
      factRow(t.industry, localized(context?.industry, lang)),
      factRow(t.businessModel, localized(context?.businessModel, lang)),
      factRow(t.locality, context?.locality),
      factRow(t.rootDomain, context?.rootDomain),
      factRow(t.auditedLocale, locale),
    ].filter(Boolean).join('');

    const pageRows = pages.map(page => {
      const href = safeHttpUrl(page.url);
      const label = compact(pageLabel(page.url), 72);
      const link = href
        ? `<a class="text-blue-600 hover:text-blue-700 break-all" href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`
        : `<span class="text-slate-700 break-all">${escapeHtml(label)}</span>`;
      const browserRendered = page.fetchSource === 'browser_run' || page.provider === 'Cloudflare Browser Run';
      const browserBadge = browserRendered
        ? `<span class="ml-1.5 inline-flex items-center rounded border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 text-[10px] font-medium text-cyan-700">${escapeHtml(t.browserRendered)}${page.browserMsUsed === null ? '' : ` · ${escapeHtml(page.browserMsUsed)} ms`}</span>`
        : '';
      return `<li class="flex items-start gap-2 py-1.5 border-b border-slate-100 last:border-0">
        <span class="mt-0.5 text-[10px] font-semibold uppercase text-slate-400 w-16 shrink-0">${escapeHtml(String(page.type).replace(/_/g, ' '))}</span>
        <span class="min-w-0 text-xs">${link}${page.status ? `<span class="ml-1.5 text-[10px] text-slate-400">${escapeHtml(page.status)}</span>` : ''}${browserBadge}</span>
      </li>`;
    }).join('');

    const actionRows = actions.map((action, index) => {
      const href = safeHttpUrl(action.page);
      const actionPage = action.page ? compact(pageLabel(action.page), 76) : '';
      const pageMarkup = actionPage
        ? `${t.page}: ${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" class="text-blue-600 hover:text-blue-700">${escapeHtml(actionPage)}</a>` : escapeHtml(actionPage)}`
        : '';
      const lines = [
        action.observed ? `<p><span class="font-semibold text-slate-600">${escapeHtml(t.observed)}:</span> ${escapeHtml(compact(action.observed, 220))}</p>` : '',
        action.reason ? `<p><span class="font-semibold text-slate-600">${escapeHtml(t.reason)}:</span> ${escapeHtml(compact(action.reason, 200))}</p>` : '',
        action.fix ? `<p><span class="font-semibold text-slate-600">${escapeHtml(t.fix)}:</span> ${escapeHtml(compact(action.fix, 240))}</p>` : '',
        action.verify ? `<p><span class="font-semibold text-slate-600">${escapeHtml(t.verify)}:</span> ${escapeHtml(compact(action.verify, 180))}</p>` : '',
      ].filter(Boolean).join('');
      return `<li class="grid grid-cols-[24px_minmax(0,1fr)] gap-3 py-3 border-t border-slate-100 first:border-t-0">
        <span class="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">${index + 1}</span>
        <div class="min-w-0">
          <div class="flex items-start gap-2 flex-wrap">
            <h4 class="text-sm font-semibold text-slate-900">${escapeHtml(action.title || `${t.actions} ${index + 1}`)}</h4>
            ${action.predicted ? `<span class="text-[10px] font-semibold uppercase border border-purple-200 bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded">${escapeHtml(t.predicted)}</span>` : ''}
          </div>
          ${pageMarkup ? `<div class="text-[11px] text-slate-400 mt-0.5">${pageMarkup}</div>` : ''}
          <div class="text-xs text-slate-500 leading-relaxed mt-1.5 space-y-1">${lines || `<p>${escapeHtml(t.notProvided)}</p>`}</div>
        </div>
      </li>`;
    }).join('');

    return `<div class="px-5 py-5 bg-slate-50/70">
      <div class="flex items-start justify-between gap-4 mb-4">
        <div>
          <div class="flex items-center gap-2 flex-wrap">
            <h2 class="text-sm font-bold text-slate-900">${escapeHtml(t.profile)}</h2>
            ${context ? `<span class="text-xs font-semibold border border-blue-200 bg-blue-50 text-blue-700 rounded px-2 py-0.5">${escapeHtml(archetypeLabel(context.archetype, lang))}</span><button type="button" data-action="correct-archetype" data-domain="${escapeHtml(data?.domain ?? '')}" data-archetype="${escapeHtml(context.archetype)}" class="text-[10px] text-slate-400 hover:text-orange-600 underline underline-offset-2 print:hidden">${escapeHtml(t.correctType)}</button>` : ''}
            ${confidence ? `<span class="text-xs text-slate-500">${escapeHtml(t.confidence)} ${escapeHtml(confidence)}</span>` : ''}
            ${coverage ? `<span class="text-xs text-slate-500">${escapeHtml(t.coverage)} ${escapeHtml(coverage)}</span>` : ''}
          </div>
          ${scores.scoreVersion ? `<div class="text-[10px] text-slate-400 mt-1">Score version ${escapeHtml(scores.scoreVersion)}</div>` : ''}
        </div>
        <div class="shrink-0 print:hidden" role="group" aria-label="${escapeHtml(ui.reportLanguage)}">
          <div class="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button type="button" data-report-lang="zh" class="report-lang-btn text-xs font-medium px-2.5 py-1 rounded-md ${language(lang) === 'zh' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-800'}">中文</button>
            <button type="button" data-report-lang="en" class="report-lang-btn text-xs font-medium px-2.5 py-1 rounded-md ${language(lang) === 'en' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-800'}">EN</button>
          </div>
        </div>
      </div>
      <div class="grid md:grid-cols-2 gap-x-8 gap-y-5">
        <section class="min-w-0">
          <div class="space-y-1.5">${profileFacts || `<p class="text-xs text-slate-400">${escapeHtml(t.unknown)}</p>`}</div>
          ${evidence.length ? `<div class="mt-3"><div class="text-[10px] font-semibold uppercase text-slate-400 mb-1.5">${escapeHtml(t.evidence)}</div><ul class="space-y-1">${evidence.map(item => `<li class="text-xs text-slate-500 flex gap-2"><span class="text-blue-400">-</span><span>${escapeHtml(compact(item, 180))}</span></li>`).join('')}</ul></div>` : ''}
        </section>
        <section class="min-w-0">
          <h3 class="text-[10px] font-semibold uppercase text-slate-400 mb-1">${escapeHtml(t.pages)}</h3>
          ${pageRows ? `<ul>${pageRows}</ul>` : `<p class="text-xs text-slate-400">${escapeHtml(t.notProvided)}</p>`}
        </section>
      </div>
      ${actions.length ? `<section class="mt-5 pt-4 border-t border-slate-200"><h3 class="text-sm font-bold text-slate-900 mb-1">${escapeHtml(t.actions)}</h3><ol>${actionRows}</ol></section>` : ''}
    </div>`;
  }

  function sanitizeError(error) {
    const source = error && typeof error === 'object' ? error : { message: error };
    const rawMessage = localized(source.message ?? source.detail ?? source.error, 'en') || 'PageSpeed Insights request failed';
    const message = String(rawMessage)
      .replace(/([?&](?:key|api_key|apikey)=)[^&\s]+/gi, '$1[redacted]')
      .replace(/\bAIza[\w-]+\b/g, '[redacted]')
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
      .slice(0, 300);
    return {
      code: String(source.code ?? 'PAGESPEED_UPSTREAM_ERROR').replace(/[^A-Z0-9_-]/gi, '').slice(0, 80),
      message,
      retryable: source.retryable !== false,
    };
  }

  function strategyFrom(data, name, fallbacks) {
    const strategy = data?.[name] ?? null;
    if (strategy && typeof strategy === 'object') return strategy;
    const score = finiteNumber(data?.[`${name}_score`]);
    return {
      strategy: name,
      status: score === null ? 'error' : 'complete',
      score,
      lcp_ms: data?.[fallbacks.lcp],
      cls: data?.[fallbacks.cls],
      fcp_ms: data?.[fallbacks.fcp],
      tbt_ms: name === 'mobile' ? data?.tbt_ms : null,
      si_ms: name === 'mobile' ? data?.si_ms : null,
      error: score === null ? { code: 'PAGESPEED_EMPTY_RESULT', message: 'No numeric score returned', retryable: true } : undefined,
    };
  }

  function lighthouseStatus(data, error, strategies, fallbackStatus) {
    const supplied = Array.isArray(strategies) ? strategies : [];
    const rows = data ? [
      strategyFrom(data, 'mobile', { lcp: 'lcp_ms', cls: 'cls', fcp: 'fcp_ms' }),
      strategyFrom(data, 'desktop', { lcp: 'desktop_lcp_ms', cls: 'desktop_cls', fcp: 'desktop_fcp_ms' }),
    ] : supplied;
    const numeric = rows.filter(row => row?.status === 'complete' && finiteNumber(row?.score) !== null).length;
    if (numeric === 2) return 'ok';
    if (numeric === 1) return 'partial';
    if (error || rows.some(row => row?.status === 'error') || fallbackStatus === 'failed') return 'failed';
    return 'failed';
  }

  function metricPill(label, value, formatter) {
    const n = finiteNumber(value);
    if (n === null) return '';
    return `<span class="text-[10px] text-slate-600 border border-slate-200 bg-white rounded px-1.5 py-0.5">${escapeHtml(label)} ${escapeHtml(formatter(n))}</span>`;
  }

  function renderStrategy(strategy, name, lang) {
    const t = copy(lang);
    const score = finiteNumber(strategy?.score);
    const complete = strategy?.status === 'complete' && score !== null;
    const issue = complete ? null : sanitizeError(strategy?.error ?? { code: 'PAGESPEED_EMPTY_RESULT', message: t.noNumericScore, retryable: true });
    const scoreClass = score === null ? 'text-slate-400' : score >= 90 ? 'text-green-700' : score >= 50 ? 'text-amber-700' : 'text-orange-600';
    const barClass = score === null ? 'bg-slate-200' : score >= 90 ? 'bg-green-400' : score >= 50 ? 'bg-amber-400' : 'bg-orange-400';
    const metrics = [
      metricPill('LCP', strategy?.lcp_ms, value => `${(value / 1000).toFixed(1)}s`),
      metricPill('CLS', strategy?.cls, value => value.toFixed(3)),
      metricPill('FCP', strategy?.fcp_ms, value => `${(value / 1000).toFixed(1)}s`),
      metricPill('TBT', strategy?.tbt_ms, value => `${Math.round(value)}ms`),
      metricPill('SI', strategy?.si_ms, value => `${(value / 1000).toFixed(1)}s`),
    ].filter(Boolean).join('');
    return `<div class="py-3 first:pt-0 last:pb-0">
      <div class="flex items-center gap-3">
        <div class="w-20 shrink-0">
          <div class="text-xs font-semibold text-slate-700">${escapeHtml(name)}</div>
          <div class="text-[10px] ${complete ? 'text-green-600' : 'text-orange-600'}">${escapeHtml(complete ? t.complete : t.error)}</div>
        </div>
        <div class="min-w-0 flex-1">
          ${complete ? `<div class="flex items-center gap-3"><span class="text-xl font-extrabold ${scoreClass}">${score}</span><div class="h-1.5 flex-1 bg-slate-100 rounded-full overflow-hidden"><div class="h-full ${barClass} rounded-full" style="width:${score}%"></div></div></div>` : `<div><span class="text-[10px] font-mono text-orange-700 bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5">${escapeHtml(issue.code)}</span><p class="text-xs text-slate-500 mt-1 break-words">${escapeHtml(issue.message)}</p></div>`}
          ${metrics ? `<div class="flex flex-wrap gap-1.5 mt-2" aria-label="${escapeHtml(t.metrics)}">${metrics}</div>` : ''}
        </div>
      </div>
    </div>`;
  }

  function renderLighthouse(options) {
    const data = options?.data ?? null;
    const lang = language(options?.lang);
    const t = copy(lang);
    const status = lighthouseStatus(data, options?.error, options?.strategies, options?.status);
    const supplied = Array.isArray(options?.strategies) ? options.strategies : [];
    const mobile = data
      ? strategyFrom(data, 'mobile', { lcp: 'lcp_ms', cls: 'cls', fcp: 'fcp_ms' })
      : supplied.find(row => row?.strategy === 'mobile') ?? { strategy: 'mobile', status: 'error', error: options?.error };
    const desktop = data
      ? strategyFrom(data, 'desktop', { lcp: 'desktop_lcp_ms', cls: 'desktop_cls', fcp: 'desktop_fcp_ms' })
      : supplied.find(row => row?.strategy === 'desktop') ?? { strategy: 'desktop', status: 'error', error: options?.error };
    const globalError = options?.error ? sanitizeError(options.error) : null;
    const message = status === 'ok' ? t.lighthouseComplete : status === 'partial' ? t.lighthousePartial : t.lighthouseError;
    const bannerClass = status === 'ok'
      ? 'border-green-200 bg-green-50 text-green-800'
      : status === 'partial'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-orange-200 bg-orange-50 text-orange-800';
    const opportunities = finiteNumber(data?.opportunities);
    return `<div class="mt-3 space-y-3">
      <div class="border rounded-lg px-3 py-2 text-xs ${bannerClass}">${escapeHtml(message)}</div>
      ${globalError ? `<div><span class="text-[10px] font-mono text-orange-700 bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5">${escapeHtml(globalError.code)}</span><p class="text-xs text-slate-500 mt-1 break-words">${escapeHtml(globalError.message)}</p></div>` : ''}
      <div class="divide-y divide-slate-100">
        ${renderStrategy(mobile, t.mobile, lang)}
        ${renderStrategy(desktop, t.desktop, lang)}
      </div>
      ${opportunities > 0 ? `<div class="text-xs text-amber-700">${Math.round(opportunities)} ${escapeHtml(t.opportunities)}</div>` : ''}
      <div class="flex items-center justify-between gap-3 pt-2 border-t border-slate-100">
        <span class="text-[10px] text-slate-400">${escapeHtml(t.source)}: ${escapeHtml(data?.source ?? 'Google PageSpeed Insights API')}</span>
        <button type="button" data-action="retry-lighthouse" data-domain="${escapeHtml(options?.domain ?? '')}" class="text-xs font-semibold text-blue-700 border border-blue-200 hover:bg-blue-50 rounded-lg px-3 py-1.5 print:hidden">${escapeHtml(t.retry)}</button>
      </div>
    </div>`;
  }

  global.GeoScoreReport = {
    archetypeLabel,
    buildAuditEndpoint,
    buildAuditPageQuery,
    copy,
    escapeHtml,
    formatPercent,
    inferReportLanguage,
    language,
    lighthouseStatus,
    llmsTxtView,
    normalizeActions,
    normalizeContext,
    normalizePages,
    normalizeScoreSummary,
    parseAuditInput,
    renderEvidenceSummary,
    renderLighthouse,
    readabilityView,
    sanitizeError,
    sameScoreVersion,
  };
})(typeof window !== 'undefined' ? window : globalThis);
