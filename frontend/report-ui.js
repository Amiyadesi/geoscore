(function (global) {
  'use strict';

  // The report keeps evidence-specific copy here, while the shared catalog owns
  // browser/report language detection and any product-wide fallback labels.
  const SHARED_I18N = global.GeoScoreI18n;

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
      scoreVersion: 'Score version',
      scoreLimits: 'Scoring limits',
      overallScore: 'Overall',
      rawScore: 'Raw',
      finalScore: 'Final',
      capCritical: 'critical failure cap',
      capMajor: 'major failure cap',
      capMinor: 'minor failure cap',
      capCoverage: 'evidence coverage cap',
      capConfidence: 'evidence confidence cap',
      factualChecks: 'Factual checks',
      predictedChecks: 'Predicted simulations',
      predictedNote: 'Predicted simulations are informational and have zero scoring weight.',
      allActions: 'Evidence-linked repair plan',
      noActions: 'No applicable failed checks produced a recommendation.',
      pass: 'Pass',
      fail: 'Fail',
      notApplicable: 'Not applicable',
      unknownStatus: 'Unknown',
      checkError: 'Error',
      howToFix: 'Advanced fix details',
      pageTypeHome: 'Home',
      pageTypeAbout: 'About',
      pageTypeArticle: 'Article',
      pageTypePage: 'Page',
      pageStatusComplete: 'Complete',
      pageStatusError: 'Error',
      lighthouseMobile: 'Lighthouse mobile',
      lighthouseDesktop: 'Lighthouse desktop',
      pageSpeedFallback: 'PageSpeed fallback',
      cruxRealUser: 'CrUX real-user data',
      expandDetails: 'Show details',
      profileDetails: 'Profile, classification evidence and audited pages',
      actionDetails: 'Evidence and verification',
      evidenceMap: 'Query Evidence Map',
      evidenceMapBody: 'A dated search snapshot that maps supported queries to observed sources and audited pages.',
      evidenceMapRun: 'Run Evidence Map',
      evidenceMapRefresh: 'Refresh snapshot',
      evidenceMapRunning: 'Building search snapshot…',
      evidenceMapEmpty: 'No search snapshot has been generated for this audit.',
      evidenceMapZeroWeight: 'Search snapshots never change the factual score.',
      appearances: 'Audited-root appearances',
      observedQueries: 'Observed queries',
      contentOpportunities: 'Content opportunities',
      diagnosis: 'Pipeline diagnosis',
      provenance: 'Source provenance and provider runs',
      providerRuns: 'Provider runs',
      limitations: 'Limitations',
      latestAnswer: 'Latest API answer',
      otherAnswers: 'Other API answers',
      fullAnswer: 'Full answer and citations',
      answerQuery: 'Query',
      answerModel: 'Model',
      answerLatency: 'Latency',
      answerCitations: 'Citations',
      noAnswer: 'No API answer snapshot is available.',
      answerUnavailable: 'API answer unavailable',
      monitoring: 'Weekly evidence monitoring',
      monitoringBody: 'Keep up to twelve dated search/API snapshots. They do not prove consumer AI citations and remain separate from the factual readiness score.',
      createMonitor: 'Create monitoring project',
      connectMonitor: 'Connect existing project',
      projectId: 'Project ID',
      projectToken: 'Management token',
      connect: 'Connect',
      optionalEmail: 'Email for weekly change alerts (optional)',
      managementToken: 'Management token',
      tokenWarning: 'Shown once. Save it now; GeoScore cannot recover it.',
      tokenSaved: 'I saved the token',
      saveOnDevice: 'Save on this device',
      forgetDevice: 'Forget this device',
      rotateToken: 'Rotate token',
      savedOnDevice: 'Saved on this device',
      querySettings: 'Queries',
      saveQueries: 'Save queries',
      runDefault: 'Run with hosted API',
      runByok: 'Run once with API key',
      apiKey: 'API key',
      apiBaseUrl: 'Base URL',
      apiModel: 'Model',
      fetchModels: 'Fetch models',
      apiKeyPrivacy: 'Used only for this request. It is cleared immediately and is never stored.',
      monitorHistory: 'Monitoring history',
      noHistory: 'No monitoring runs yet.',
      baseline: 'Baseline',
      scoreDelta: 'Score change',
      status: 'Status',
      created: 'Created',
      saving: 'Saving…',
      running: 'Running…',
      historyRetention: 'The free project retains the latest 12 snapshots.',
      queryIntent: 'Intent',
      intentBranded: 'Branded',
      intentInformational: 'Informational',
      intentTask: 'Task',
      intentComparison: 'Comparison',
      intentLocal: 'Local',
      intentNavigational: 'Navigational',
      requestFailed: 'Request failed',
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
      scoreVersion: '评分版本',
      scoreLimits: '评分限制',
      overallScore: '总分',
      rawScore: '原始分',
      finalScore: '最终分',
      capCritical: 'critical 失败上限',
      capMajor: 'major 失败上限',
      capMinor: 'minor 失败上限',
      capCoverage: '证据覆盖率上限',
      capConfidence: '证据置信度上限',
      factualChecks: '事实检查',
      predictedChecks: '预测模拟',
      predictedNote: '预测模拟仅供参考，评分权重固定为 0。',
      allActions: '证据关联修复计划',
      noActions: '当前没有由适用失败项生成的建议。',
      pass: '通过',
      fail: '失败',
      notApplicable: '不适用',
      unknownStatus: '未知',
      checkError: '错误',
      howToFix: '高级修复详情',
      pageTypeHome: '首页',
      pageTypeAbout: '关于页',
      pageTypeArticle: '文章页',
      pageTypePage: '页面',
      pageStatusComplete: '完成',
      pageStatusError: '错误',
      lighthouseMobile: 'Lighthouse 移动端',
      lighthouseDesktop: 'Lighthouse 桌面端',
      pageSpeedFallback: 'PageSpeed 备用数据',
      cruxRealUser: 'CrUX 真实用户数据',
      expandDetails: '展开详情',
      profileDetails: '画像字段、分类证据与审查页面',
      actionDetails: '证据与复验详情',
      evidenceMap: '查询证据地图',
      evidenceMapBody: '按时间保存搜索快照，把有依据的查询映射到已观察来源与被审查页面。',
      evidenceMapRun: '生成证据地图',
      evidenceMapRefresh: '刷新快照',
      evidenceMapRunning: '正在生成搜索快照…',
      evidenceMapEmpty: '本次审查尚未生成搜索快照。',
      evidenceMapZeroWeight: '搜索快照绝不会改变事实评分。',
      appearances: '根域名出现次数',
      observedQueries: '已观察查询',
      contentOpportunities: '内容机会',
      diagnosis: '流程诊断',
      provenance: '来源溯源与 API 运行明细',
      providerRuns: 'API 运行记录',
      limitations: '限制说明',
      latestAnswer: '最新 API 回答',
      otherAnswers: '其他 API 回答',
      fullAnswer: '完整回答与引用',
      answerQuery: '查询',
      answerModel: '模型',
      answerLatency: '耗时',
      answerCitations: '引用',
      noAnswer: '当前没有可用的 API 回答快照。',
      answerUnavailable: 'API 回答未生成',
      monitoring: '每周证据监控',
      monitoringBody: '最多保留十二次带日期的搜索/API 快照；它们不能证明消费端 AI 引用，并始终与事实就绪度评分分离。',
      createMonitor: '创建监控项目',
      connectMonitor: '连接已有监控项目',
      projectId: '项目 ID',
      projectToken: '管理 Token',
      connect: '连接',
      optionalEmail: '接收每周变化提醒的邮箱（可选）',
      managementToken: '管理 Token',
      tokenWarning: '只展示一次。请立即保存，GeoScore 无法找回。',
      tokenSaved: '我已保存 Token',
      saveOnDevice: '保存到本设备',
      forgetDevice: '忘记本设备',
      rotateToken: '轮换 Token',
      savedOnDevice: '已保存到本设备',
      querySettings: '查询设置',
      saveQueries: '保存查询',
      runDefault: '使用托管 API 运行',
      runByok: '使用 API Key 单次运行',
      apiKey: 'API Key',
      apiBaseUrl: 'Base URL',
      apiModel: '模型',
      fetchModels: '拉取模型',
      apiKeyPrivacy: '仅用于本次请求；提交后立即清空，绝不存储。',
      monitorHistory: '监控历史',
      noHistory: '尚无监控运行记录。',
      baseline: '基线',
      scoreDelta: '分数变化',
      status: '状态',
      created: '创建时间',
      saving: '正在保存…',
      running: '正在运行…',
      historyRetention: '免费项目只保留最近 12 次快照。',
      queryIntent: '意图',
      intentBranded: '品牌',
      intentInformational: '信息',
      intentTask: '任务',
      intentComparison: '对比',
      intentLocal: '本地',
      intentNavigational: '导航',
      requestFailed: '请求失败',
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
    return SHARED_I18N?.language?.(value) ?? (/^zh(?:-|_|$)/i.test(String(value || '')) ? 'zh' : 'en');
  }

  function copy(lang) {
    const selected = language(lang);
    const base = COPY[selected];
    if (!SHARED_I18N?.t) return base;
    return new Proxy(base, {
      get(target, key) {
        if (key in target) return target[key];
        const sharedKey = `report.${String(key)}`;
        const translated = SHARED_I18N.t(sharedKey, {}, selected);
        return translated === sharedKey ? undefined : translated;
      },
    });
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
    const categoryDetail = raw => {
      const object = raw && typeof raw === 'object' ? raw : {};
      const capReasons = Array.isArray(object.cap_reasons) ? object.cap_reasons.map(reason => ({
        code: String(reason?.code ?? 'SCORE_CAP'),
        cap: finiteNumber(reason?.cap),
        checkIds: Array.isArray(reason?.check_ids) ? reason.check_ids.map(String) : [],
      })) : [];
      return {
        score: metricValue(raw),
        rawScore: metricValue(firstDefined(object.raw_score, object.rawScore, raw)),
        coverage: percentValue(object.coverage),
        confidence: percentValue(object.confidence),
        cap: finiteNumber(object.cap),
        capReasons,
      };
    };
    const overallDetail = categoryDetail(overallRaw);
    const seoDetail = categoryDetail(seoRaw);
    const geoDetail = categoryDetail(geoRaw);
    return {
      present: Boolean(summary),
      overall: overallDetail.score,
      seo: seoDetail.score,
      geo: geoDetail.score,
      aeo: metricValue(aeoRaw),
      coverage: percentValue(firstDefined(summary?.coverage?.overall, summary?.coverage, overallDetail.coverage, summary?.overall_coverage)),
      confidence: percentValue(firstDefined(summary?.confidence?.overall, summary?.confidence, overallDetail.confidence, summary?.overall_confidence)),
      scoreVersion: firstDefined(summary?.score_version, data?.score_version),
      status: firstDefined(summary?.status, overallDetail.score === null ? 'insufficient_evidence' : 'complete'),
      overallDetail,
      seoDetail,
      geoDetail,
    };
  }

  function capReasonText(reason, lang) {
    const t = copy(lang);
    const labels = {
      CRITICAL_FAILURE: t.capCritical,
      MAJOR_FAILURE: t.capMajor,
      MINOR_FAILURE: t.capMinor,
      LOW_COVERAGE: t.capCoverage,
      LOW_CONFIDENCE: t.capConfidence,
    };
    const cap = finiteNumber(reason?.cap);
    const checkIds = Array.isArray(reason?.checkIds) ? reason.checkIds : [];
    return `${labels[reason?.code] ?? reason?.code ?? 'Score cap'}${cap === null ? '' : ` ${cap}/100`}${checkIds.length ? ` (${checkIds.join(', ')})` : ''}`;
  }

  function scoreLimitRows(scores, lang) {
    const t = copy(lang);
    return [
      { label: t.overallScore, detail: scores.overallDetail },
      { label: 'SEO', detail: scores.seoDetail },
      { label: 'GEO', detail: scores.geoDetail },
    ].filter(item => item.detail?.capReasons?.length).map(item => {
      const raw = item.detail.rawScore === null ? t.insufficient : `${Math.round(item.detail.rawScore)}/100`;
      const final = item.detail.score === null ? t.insufficient : `${Math.round(item.detail.score)}/100`;
      return `<li class="text-xs text-amber-800 leading-relaxed"><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(t.rawScore)} ${escapeHtml(raw)} -> ${escapeHtml(t.finalScore)} ${escapeHtml(final)} · ${escapeHtml(item.detail.capReasons.map(reason => capReasonText(reason, lang)).join('; '))}</li>`;
    });
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
    return normalizeAllActions(data, lang).slice(0, 3);
  }

  function normalizeAllActions(data, lang) {
    const priorityRank = { critical: 4, high: 3, major: 3, medium: 2, minor: 1, low: 1, info: 0 };
    const actions = Array.isArray(data?.recommendations_v2) ? [...data.recommendations_v2] : [];
    actions.sort((a, b) => {
      const aNumber = finiteNumber(a?.priority);
      const bNumber = finiteNumber(b?.priority);
      if (aNumber !== null || bNumber !== null) return (bNumber ?? -1) - (aNumber ?? -1);
      const aRank = priorityRank[String(a?.severity ?? a?.priority ?? '').toLowerCase()] ?? -1;
      const bRank = priorityRank[String(b?.severity ?? b?.priority ?? '').toLowerCase()] ?? -1;
      return bRank - aRank;
    });
    return actions.map((action, index) => {
      const actionLanguage = language(lang);
      const actionCopy = action?.localized?.[actionLanguage]
        && typeof action.localized[actionLanguage] === 'object'
        ? action.localized[actionLanguage]
        : {};
      const pages = action?.applicable_pages ?? action?.pages ?? action?.page_urls;
      const page = action?.page_url ?? action?.url ?? (Array.isArray(pages) ? pages[0] : pages);
      return {
        id: action?.id ?? `action-${index + 1}`,
        title: localized(actionCopy.title ?? action?.title ?? action?.name, lang),
        page: localized(page, lang),
        observed: localized(action?.observed ?? action?.observation ?? action?.evidence, lang),
        reason: localized(actionCopy.why ?? action?.reason ?? action?.why, lang),
        fix: localized(actionCopy.fix ?? action?.fix ?? action?.how_to_fix ?? action?.recommendation, lang),
        verify: localized(actionCopy.verify ?? action?.verification ?? action?.verify ?? action?.retest, lang),
        priority: String(action?.priority ?? '').toLowerCase(),
        severity: String(action?.severity ?? '').toLowerCase(),
        source: localized(action?.source ?? action?.detected_by, lang),
        confidence: percentValue(action?.confidence),
        code: localized(action?.technical_code ?? action?.code_snippet ?? action?.code, lang),
        predicted: action?.predicted === true || String(action?.certainty ?? action?.source_type ?? '').toLowerCase() === 'predicted',
      };
    });
  }

  function isEvidenceAudit(data) {
    return Array.isArray(data?.normalized_checks)
      || Array.isArray(data?.checks)
      || Array.isArray(data?.recommendations_v2)
      || Boolean(data?.score_summary?.score_version);
  }

  function normalizeChecks(data, lang) {
    const checks = Array.isArray(data?.normalized_checks)
      ? data.normalized_checks
      : Array.isArray(data?.checks)
        ? data.checks
        : [];
    return checks.map((check, index) => {
      const rawStatus = String(check?.status ?? (check?.passed === true ? 'pass' : check?.passed === false ? 'fail' : 'unknown')).toLowerCase();
      const status = ['pass', 'fail', 'not_applicable', 'unknown', 'error'].includes(rawStatus)
        ? rawStatus
        : rawStatus === 'ok' ? 'pass' : rawStatus === 'failed' ? 'fail' : 'unknown';
      const pages = check?.applicable_pages ?? check?.pages ?? check?.page_urls;
      const page = check?.page_url ?? check?.url ?? (Array.isArray(pages) ? pages[0] : pages);
      const evidence = Array.isArray(check?.evidence)
        ? check.evidence.map(item => evidenceText(item, lang)).filter(Boolean)
        : [evidenceText(check?.evidence ?? check?.detail ?? check?.observed, lang)].filter(Boolean);
      const predicted = check?.predicted === true
        || /predicted/i.test(String(check?.category ?? check?.source_type ?? check?.id ?? ''));
      return {
        id: String(check?.id ?? `check-${index + 1}`),
        title: localized(check?.localized_title ?? check?.title ?? check?.name ?? check?.label ?? check?.id, lang),
        category: String(check?.category ?? check?.group ?? 'other'),
        status,
        source: localized(check?.source ?? check?.detected_by, lang),
        page: localized(page, lang),
        evidence,
        confidence: percentValue(check?.confidence),
        severity: String(check?.severity ?? (predicted ? 'info' : 'minor')).toLowerCase(),
        predicted,
        weight: finiteNumber(check?.weight),
      };
    });
  }

  function checkSummary(data, lang) {
    const factual = normalizeChecks(data, lang).filter(check => !check.predicted);
    return factual.reduce((summary, check) => {
      summary[check.status] = (summary[check.status] ?? 0) + 1;
      return summary;
    }, { pass: 0, fail: 0, not_applicable: 0, unknown: 0, error: 0 });
  }

  function renderCheckSummaryBar(data, lang) {
    const summary = checkSummary(data, lang);
    const t = copy(lang);
    return [
      summary.pass ? `<span class="text-green-700 font-medium">✓ ${summary.pass} ${escapeHtml(t.pass)}</span>` : '',
      summary.fail ? `<span class="text-orange-700 font-medium">✕ ${summary.fail} ${escapeHtml(t.fail)}</span>` : '',
      summary.unknown ? `<span class="text-slate-500 font-medium">? ${summary.unknown} ${escapeHtml(t.unknownStatus)}</span>` : '',
      summary.error ? `<span class="text-red-600 font-medium">! ${summary.error} ${escapeHtml(t.checkError)}</span>` : '',
      summary.not_applicable ? `<span class="text-slate-400 font-medium">– ${summary.not_applicable} ${escapeHtml(t.notApplicable)}</span>` : '',
    ].filter(Boolean).join('<span class="text-slate-300">·</span>');
  }

  function performanceSourceLabel(data, lang) {
    const t = copy(lang);
    const lighthouse = data?.modules?.lighthouse?.data;
    const pageSpeed = data?.modules?.on_page_seo?.data?.page_speed;
    const crux = data?.modules?.crux?.data;
    if (lighthouse?.mobile_score != null) return t.lighthouseMobile;
    if (lighthouse?.desktop_score != null) return t.lighthouseDesktop;
    if (pageSpeed?.performance != null) return t.pageSpeedFallback;
    if (crux?.has_data) return t.cruxRealUser;
    return '';
  }

  // Gateway errors are stable product states. Prefer their code over provider
  // wording so the UI and exported report stay bilingual and never echo
  // private upstream details.
  const ANSWER_ERROR_COPY = {
    ANSWER_API_AUTH_ERROR: {
      en: 'The custom API rejected the submitted key.',
      zh: '自定义 API 拒绝了这次提交的 API Key。',
    },
    ANSWER_API_RATE_LIMITED: {
      en: 'The custom API is temporarily rate limited.',
      zh: '自定义 API 暂时触发了限流。',
    },
    ANSWER_API_TIMEOUT: {
      en: 'The custom API request timed out.',
      zh: '自定义 API 请求超时。',
    },
    ANSWER_API_INVALID_REQUEST: {
      en: 'The custom API configuration was rejected.',
      zh: '自定义 API 配置未被接受。',
    },
    ANSWER_API_CONFIG_INVALID: {
      en: 'The custom API configuration was rejected.',
      zh: '自定义 API 配置未被接受。',
    },
    ANSWER_API_KEY_REQUIRED: {
      en: 'A request-scoped API key is required.',
      zh: '这次请求需要提供一次性 API Key。',
    },
    ANSWER_API_MALFORMED_RESPONSE: {
      en: 'The custom API returned an invalid response.',
      zh: '自定义 API 返回了无法解析的响应。',
    },
    ANSWER_API_NO_FINAL_CONTENT: {
      en: 'The custom API used its output budget without producing a final answer. Retry or choose another model.',
      zh: '自定义 API 已用尽输出预算，但没有生成最终回答。请重试或更换模型。',
    },
    ANSWER_API_REDIRECT_BLOCKED: {
      en: 'The custom API redirected to an endpoint that could not be verified.',
      zh: '自定义 API 重定向到了无法验证的地址。',
    },
    ANSWER_API_NETWORK_ERROR: {
      en: 'The custom API could not be reached.',
      zh: '无法连接到自定义 API。',
    },
    ANSWER_API_UPSTREAM_ERROR: {
      en: 'The custom API returned a temporary upstream error.',
      zh: '自定义 API 返回了临时上游错误。',
    },
    ANSWER_API_UNAVAILABLE: {
      en: 'The custom API is temporarily unavailable.',
      zh: '自定义 API 暂时不可用。',
    },
  };

  function answerErrorMessage(error, lang) {
    const code = String(error?.code ?? '');
    const copy = ANSWER_ERROR_COPY[code];
    if (copy) return copy[language(lang)];
    return localized(error?.message, lang);
  }

  function generateFullRepairMarkdown(data, lang) {
    const selected = language(lang);
    const zh = selected === 'zh';
    const scores = normalizeScoreSummary(data);
    const context = normalizeContext(data);
    const pages = normalizePages(data);
    const checks = normalizeChecks(data, selected).filter(item => !item.predicted);
    const actions = normalizeAllActions(data, selected).filter(item => !item.predicted);
    const actionById = new Map(actions.map(item => [item.id, item]));
    const severityRank = { critical: 4, major: 3, minor: 2, info: 1 };
    const failures = checks
      .filter(item => item.status === 'fail' && item.weight !== 0 && item.severity !== 'info')
      .sort((a, b) => (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0) || a.id.localeCompare(b.id));
    const unavailable = checks.filter(item => item.status === 'unknown' || item.status === 'error');
    const secondaryChecks = checks.filter(item =>
      item.status === 'not_applicable' ||
      ((item.weight === 0 || item.severity === 'info') && item.status !== 'unknown' && item.status !== 'error'),
    );
    const skippedModules = Object.entries(data?.modules ?? {})
      .filter(([, result]) => result?.status === 'skipped')
      .map(([name, result]) => ({
        name,
        reason: localized(result?.data?.reason ?? result?.error, selected),
      }));
    const repairGroups = Array.isArray(data?.repair_groups) ? data.repair_groups : [];
    const evidenceMap = data?.evidence_map && typeof data.evidence_map === 'object' ? data.evidence_map : null;
    const monitoringHistory = Array.isArray(data?.monitoring_history) ? data.monitoring_history : [];
    const limitations = [
      ...(Array.isArray(data?.limitations) ? data.limitations : []),
      ...(Array.isArray(data?.predicted_visibility?.limitations) ? data.predicted_visibility.limitations : []),
      ...(Array.isArray(evidenceMap?.limitations) ? evidenceMap.limitations : []),
    ].map(item => localized(item, selected)).filter(Boolean);

    const labels = zh ? {
      title: 'GeoScore 完整修复报告', audit: '审计信息', generated: '生成时间', version: '评分版本', mode: '审计模式', target: '目标',
      profile: '站点画像', archetype: '站点类型', entity: '实体', industry: '行业方向', business: '业务模式', locale: '页面语言', root: '根域名', classification: '分类证据',
      scores: '分数与评分限制', final: '最终分', raw: '原始加权分', coverage: '覆盖率', confidence: '置信度', cap: '最高分上限', limits: '限制原因', insufficient: '证据不足',
      pages: '抽样页面', failures: '全部失败项与修复方案', noFailures: '没有已知且适用的计分失败项。', page: '页面', source: '检测来源', evidence: '原始证据', why: '失败原因', fix: '修改方法', verify: '复验步骤', snippet: '技术片段',
      unavailable: '未知与错误检查', unavailableNote: '这些项目没有计为失败，也没有按 0 分处理；它们只影响证据覆盖率。',
      notApplicable: '不适用与信息项', optional: '匿名审计未运行的可选能力', handoff: '交给开发 AI 的统一 Handoff Prompt',
      noInvent: '不得虚构价格、套餐、服务、地址、实体、作者、统计来源或站点未公开的业务事实。不得自动发布。',
      severity: '严重度', status: '状态', check: '检查', recommendation: '修复任务', unknown: '未知', none: '无',
      repairGroups: '按页面与根因聚合的修复组', stage: '阶段', checks: '检查项', evidenceMap: '查询证据地图', observedAt: '观察时间', affectsScore: '影响评分', appearances: '根域名出现次数', queries: '查询', opportunities: '内容机会', diagnosis: '流程诊断', provenance: '来源溯源与 API 运行', answerSnapshots: 'API 回答快照', answerError: 'API 回答错误', answer: '回答', model: '模型', latency: '耗时', citations: '引用', limitations: '限制说明', monitoring: '监控历史', runType: '运行类型', delta: '分数变化', baseline: '基线行为', noSnapshot: '尚未生成快照', noHistory: '尚无监控历史',
    } : {
      title: 'GeoScore full repair report', audit: 'Audit identity', generated: 'Generated', version: 'Score version', mode: 'Audit mode', target: 'Target',
      profile: 'Site profile', archetype: 'Site archetype', entity: 'Entity', industry: 'Industry vertical', business: 'Business model', locale: 'Page locale', root: 'Root domain', classification: 'Classification evidence',
      scores: 'Scores and scoring limits', final: 'Final score', raw: 'Raw weighted score', coverage: 'Coverage', confidence: 'Confidence', cap: 'Maximum score cap', limits: 'Cap reasons', insufficient: 'Insufficient evidence',
      pages: 'Audited page sample', failures: 'All failed checks and repair actions', noFailures: 'No known, applicable scoring checks failed.', page: 'Page', source: 'Detection source', evidence: 'Raw evidence', why: 'Why it failed', fix: 'How to change it', verify: 'How to verify', snippet: 'Technical snippet',
      unavailable: 'Unknown and error checks', unavailableNote: 'These checks are not failures and were not converted to zero; they affect evidence coverage only.',
      notApplicable: 'Not-applicable and informational checks', optional: 'Optional capabilities not run in the anonymous audit', handoff: 'Unified handoff prompt for a developer AI',
      noInvent: 'Do not invent prices, plans, services, addresses, entities, authors, statistical sources, or business facts not published by the site. Do not publish automatically.',
      severity: 'Severity', status: 'Status', check: 'Check', recommendation: 'Repair task', unknown: 'Unknown', none: 'None',
      repairGroups: 'Repair groups by page and root cause', stage: 'Stage', checks: 'Checks', evidenceMap: 'Query Evidence Map', observedAt: 'Observed at', affectsScore: 'Affects score', appearances: 'Audited-root appearances', queries: 'Queries', opportunities: 'Content opportunities', diagnosis: 'Pipeline diagnosis', provenance: 'Source provenance and API runs', answerSnapshots: 'API answer snapshots', answerError: 'API answer error', answer: 'Answer', model: 'Model', latency: 'Latency', citations: 'Citations', limitations: 'Limitations', monitoring: 'Monitoring history', runType: 'Run type', delta: 'Score change', baseline: 'Baseline action', noSnapshot: 'No snapshot has been generated', noHistory: 'No monitoring history is available',
    };
    const oneLine = value => String(value ?? '').replace(/\s+/g, ' ').trim();
    const percent = value => value === null || value === undefined ? labels.unknown : `${Math.round(value)}%`;
    const scoreValue = value => value === null || value === undefined ? labels.insufficient : `${Math.round(value)}/100`;
    const scoreLine = (name, detail) => {
      const reasons = detail.capReasons?.length
        ? detail.capReasons.map(reason => capReasonText(reason, selected)).join('; ')
        : labels.none;
      return [
        `### ${name}`,
        `- ${labels.final}: ${scoreValue(detail.score)}`,
        `- ${labels.raw}: ${scoreValue(detail.rawScore)}`,
        `- ${labels.coverage}: ${percent(detail.coverage)}`,
        `- ${labels.confidence}: ${percent(detail.confidence)}`,
        `- ${labels.cap}: ${detail.cap == null ? labels.unknown : `${detail.cap}/100`}`,
        `- ${labels.limits}: ${reasons}`,
      ].join('\n');
    };
    const evidenceLines = (context?.evidence ?? []).map(item => {
      const source = localized(item?.source, selected);
      const detail = evidenceText(item, selected);
      const page = localized(item?.page_url, selected);
      return `- ${[source && `[${source}]`, page, detail].filter(Boolean).map(oneLine).join(' - ')}`;
    });
    const pageLines = pages.length ? pages.map(page =>
      `- **${pageTypeLabel(page.type, selected)}** - ${page.url} - ${pageStatusLabel(page.status, selected) || labels.unknown}${page.fetchSource ? ` - ${page.fetchSource}` : ''}`,
    ) : [`- ${labels.none}`];
    const failureBlocks = failures.map((item, index) => {
      const action = actionById.get(item.id);
      const evidence = item.evidence.length ? item.evidence.map(value => `  - ${oneLine(value)}`).join('\n') : `  - ${labels.none}`;
      const lines = [
        `### ${index + 1}. [${item.severity.toUpperCase()}] ${item.title} (\`${item.id}\`)`,
        `- ${labels.page}: ${action?.page || item.page || data?.target_url || `https://${data?.domain ?? ''}/`}`,
        `- ${labels.source}: ${action?.source || item.source || labels.unknown}`,
        `- ${labels.confidence}: ${percent(action?.confidence ?? item.confidence)}`,
        `- ${labels.evidence}:`,
        evidence,
        `- ${labels.why}: ${oneLine(action?.reason || (zh ? '该检查基于上述可验证证据失败。' : 'This check failed on the verifiable evidence above.'))}`,
        `- ${labels.fix}: ${oneLine(action?.fix || (zh ? '根据证据修复对应页面，不扩展未验证的业务事实。' : 'Correct the evidenced page without adding unsupported business facts.'))}`,
        `- ${labels.verify}: ${oneLine(action?.verify || (zh ? '重新审计该 URL，确认状态变为 pass。' : 'Re-audit the URL and confirm the status becomes pass.'))}`,
      ];
      if (action?.code) lines.push(`- ${labels.snippet}:\n\n\`\`\`\n${String(action.code).replace(/\`\`\`/g, "'''")}\n\`\`\``);
      return lines.join('\n');
    });
    const statusLines = items => items.length ? items.map(item =>
      `- [${item.status}] \`${item.id}\` - ${oneLine(item.title)}${item.source ? ` - ${oneLine(item.source)}` : ''}${item.evidence[0] ? ` - ${oneLine(item.evidence[0])}` : ''}`,
    ) : [`- ${labels.none}`];
    const optionalLines = skippedModules.length ? skippedModules.map(item =>
      `- \`${item.name}\`${item.reason ? ` - ${oneLine(item.reason)}` : ''}`,
    ) : [`- ${labels.none}`];
    const repairGroupBlocks = repairGroups.map((group, index) => {
      const tasks = Array.isArray(group?.tasks) ? group.tasks : [];
      const evidenceItems = Array.isArray(group?.evidence_items) ? group.evidence_items : [];
      const verificationSteps = Array.isArray(group?.verification_steps) ? group.verification_steps : [];
      const taskLines = tasks.map(task => {
        const taskCopy = task?.localized?.[selected] && typeof task.localized[selected] === 'object'
          ? task.localized[selected]
          : task;
        return `  - **${oneLine(taskCopy?.title ?? task?.title ?? task?.check_id)}** — ${oneLine(taskCopy?.fix ?? task?.fix)} — ${labels.verify}: ${oneLine(taskCopy?.verify ?? task?.verify)}`;
      });
      const evidenceLines = evidenceItems.flatMap(item => (Array.isArray(item?.observed) ? item.observed : []).map(observed =>
        `  - \`${item?.check_id ?? 'check'}\`${item?.page_url ? ` @ ${oneLine(item.page_url)}` : ''}: ${oneLine(observed)}`,
      ));
      return [
        `### ${index + 1}. ${oneLine(group?.id ?? `${labels.repairGroups} ${index + 1}`)}`,
        `- ${labels.stage}: ${oneLine(group?.stage ?? labels.unknown)}`,
        `- ${labels.page}: ${oneLine(group?.page_url ?? labels.none)}`,
        `- ${labels.severity}: ${oneLine(group?.severity ?? labels.unknown)}`,
        `- ${labels.checks}: ${(Array.isArray(group?.check_ids) ? group.check_ids : []).map(id => `\`${oneLine(id)}\``).join(', ') || labels.none}`,
        `- ${labels.evidence}:`,
        ...(evidenceLines.length ? evidenceLines : [`  - ${labels.none}`]),
        `- ${labels.recommendation}:`,
        ...(taskLines.length ? taskLines : [`  - ${labels.none}`]),
        `- ${labels.verify}:`,
        ...(verificationSteps.length ? verificationSteps.map(item => `  - ${oneLine(item)}`) : [`  - ${labels.none}`]),
      ].join('\n');
    });
    const evidenceMapLines = evidenceMap ? (() => {
      const queries = Array.isArray(evidenceMap?.query_plan?.queries) ? evidenceMap.query_plan.queries : [];
      const opportunities = Array.isArray(evidenceMap?.opportunities) ? evidenceMap.opportunities : [];
      const diagnosis = Array.isArray(evidenceMap?.diagnosis) ? evidenceMap.diagnosis : [];
      const sources = Array.isArray(evidenceMap?.sources) ? evidenceMap.sources : [];
      const providerRuns = Array.isArray(evidenceMap?.search_snapshot?.provider_runs) ? evidenceMap.search_snapshot.provider_runs : [];
      const answerError = evidenceMap?.answer_gateway_error;
      return [
        `- ${labels.status}: ${oneLine(evidenceMap.status ?? labels.unknown)}`,
        `- ${labels.observedAt}: ${oneLine(evidenceMap.observed_at ?? labels.unknown)}`,
        `- ${labels.affectsScore}: ${evidenceMap.affects_score === false ? 'false' : oneLine(evidenceMap.affects_score ?? labels.unknown)}`,
        `- ${labels.appearances}: ${oneLine(evidenceMap?.target?.appearances ?? 0)}`,
        ...(answerError ? [`- ${labels.answerError}: ${oneLine(answerError.code ?? labels.unknown)} — ${oneLine(answerErrorMessage(answerError, selected) || labels.unknown)}`] : []),
        `### ${labels.queries}`,
        ...(queries.length ? queries.map(item => `- ${oneLine(item?.query ?? item)}${item?.intent ? ` — ${oneLine(item.intent)}` : ''}`) : [`- ${labels.none}`]),
        `### ${labels.opportunities}`,
        ...(opportunities.length ? opportunities.map(item => `- ${oneLine(item?.query)} — ${oneLine(item?.intent ?? '')} — ${oneLine(item?.reason ?? '')}`) : [`- ${labels.none}`]),
        `### ${labels.diagnosis}`,
        ...(diagnosis.length ? diagnosis.map(item => `- ${oneLine(item?.stage)} — ${oneLine(item?.status)} — ${oneLine((Array.isArray(item?.evidence) ? item.evidence : []).join('; '))}`) : [`- ${labels.none}`]),
        `### ${labels.provenance}`,
        ...(sources.length ? sources.map(item => `- #${oneLine(item?.provider_rank ?? '?')} ${oneLine(item?.title ?? item?.canonical_url ?? item?.url)} — ${oneLine(item?.provider ?? 'API')} — ${oneLine(item?.canonical_url ?? item?.url)} — ${oneLine(item?.retrieved_at ?? '')}`) : [`- ${labels.none}`]),
        ...(providerRuns.length ? providerRuns.map(item => `- API run: ${oneLine(item?.provider ?? 'API')} — ${oneLine(item?.status)} — ${oneLine(item?.result_count ?? 0)} results — ${oneLine(item?.latency_ms ?? 0)}ms`) : []),
      ];
    })() : [`- ${labels.noSnapshot}`];
    const answerSnapshotEntries = [
      { source: labels.evidenceMap, snapshot: answerSnapshotValue(evidenceMap?.answer_snapshot) },
      ...monitoringHistory.map((run, index) => ({
        source: `${labels.monitoring} ${index + 1}`,
        snapshot: answerSnapshotValue(run?.answer),
      })),
    ].filter(item => Array.isArray(item.snapshot?.observations) && item.snapshot.observations.length);
    const answerSnapshotLines = answerSnapshotEntries.length ? answerSnapshotEntries.flatMap(entry => {
      const observationLines = entry.snapshot.observations.flatMap((observation, index) => {
        const citations = Array.isArray(observation?.citations) ? observation.citations : [];
        return [
          `### ${oneLine(entry.source)} ${index + 1}`,
          `- ${labels.queries}: ${oneLine(localized(observation?.query, selected) || labels.unknown)}`,
          `- ${labels.model}: ${oneLine(observation?.model ?? labels.unknown)}`,
          `- ${labels.status}: ${oneLine(observation?.status ?? labels.unknown)}`,
          `- ${labels.observedAt}: ${oneLine(observation?.observed_at ?? labels.unknown)}`,
          `- ${labels.latency}: ${observation?.latency_ms == null ? labels.unknown : `${Math.round(Number(observation.latency_ms))}ms`}`,
          `- ${labels.answer}: ${oneLine(localized(observation?.answer, selected) || labels.none)}`,
          `- ${labels.citations}: ${citations.length}`,
          ...(citations.length ? citations.map(citation => `  - ${oneLine(localized(citation?.title, selected) || citation?.url || labels.unknown)}${citation?.url ? ` - ${oneLine(citation.url)}` : ''}`) : []),
        ];
      });
      const snapshotLimitations = Array.isArray(entry.snapshot?.limitations) ? entry.snapshot.limitations : [];
      if (snapshotLimitations.length) {
        observationLines.push(`- ${labels.limitations}:`);
        observationLines.push(...snapshotLimitations.map(item => `  - ${oneLine(localized(item, selected))}`));
      }
      return observationLines;
    }) : [`- ${labels.noSnapshot}`];
    const monitoringLines = monitoringHistory.length ? monitoringHistory.map(run =>
      `- ${formatTimestamp(run?.created_at, selected)} — ${labels.runType}: ${oneLine(run?.run_type ?? labels.unknown)} — ${labels.status}: ${oneLine(run?.status ?? labels.unknown)} — ${labels.final}: ${run?.factual_score == null ? labels.insufficient : `${Math.round(Number(run.factual_score))}/100`} — ${labels.delta}: ${run?.score_delta == null ? labels.none : oneLine(run.score_delta)} — ${labels.baseline}: ${oneLine(run?.baseline_action ?? labels.unknown)}`,
    ) : [`- ${labels.noHistory}`];
    const limitationLines = [...new Set(limitations.map(oneLine))].length
      ? [...new Set(limitations.map(oneLine))].map(item => `- ${item}`)
      : [`- ${labels.none}`];
    const handoffTasks = failures.length ? failures.map((item, index) => {
      const action = actionById.get(item.id);
      return `${index + 1}. ${item.id} on ${action?.page || item.page || data?.domain}: ${oneLine(action?.fix || item.evidence.join('; '))}. Verify: ${oneLine(action?.verify || 're-run the audit and require pass')}`;
    }).join('\n') : (zh ? '当前没有需要实施的计分失败项。' : 'There are no scoring failures to implement.');
    const handoffPrompt = zh
      ? `请在网站代码库中一次性处理以下 GeoScore ${scores.scoreVersion ?? ''} 失败项。先定位生成对应 URL 的源文件，保留现有框架和内容风格，只修改证据支持的部分。\n\n${handoffTasks}\n\n${labels.noInvent}\n完成后运行项目现有测试/构建，并逐项说明修改文件、证据对应关系与复验结果。`
      : `Apply the following GeoScore ${scores.scoreVersion ?? ''} failures in one batch. First locate the source files that generate each URL, preserve the existing framework and content style, and change only what the evidence supports.\n\n${handoffTasks}\n\n${labels.noInvent}\nAfter implementation, run the project's existing tests/build and report the changed files, evidence mapping, and verification result for every item.`;

    return `# ${labels.title}: ${data?.domain ?? labels.unknown}

## ${labels.audit}

- ${labels.generated}: ${new Date(data?.created_at ?? Date.now()).toISOString()}
- ${labels.version}: ${scores.scoreVersion ?? 'legacy'}
- ${labels.mode}: ${data?.mode ?? 'site'}
- ${labels.target}: ${data?.target_url ?? `https://${data?.domain ?? ''}/`}

## ${labels.profile}

- ${labels.archetype}: ${context ? archetypeLabel(context.archetype, selected) : labels.unknown}
- ${labels.entity}: ${context?.entity || labels.unknown}
- ${labels.industry}: ${localized(context?.industry, selected) || labels.unknown}
- ${labels.business}: ${localized(context?.businessModel, selected) || labels.unknown}
- ${labels.locale}: ${context?.locale || labels.unknown}
- ${labels.root}: ${context?.rootDomain || data?.domain || labels.unknown}

### ${labels.classification}

${evidenceLines.length ? evidenceLines.join('\n') : `- ${labels.none}`}

## ${labels.scores}

${scoreLine(zh ? '总分' : 'Overall', scores.overallDetail)}

${scoreLine('SEO', scores.seoDetail)}

${scoreLine('GEO', scores.geoDetail)}

## ${labels.pages}

${pageLines.join('\n')}

## ${labels.repairGroups}

${repairGroupBlocks.length ? repairGroupBlocks.join('\n\n') : `- ${labels.none}`}

## ${labels.failures}

${failureBlocks.length ? failureBlocks.join('\n\n') : labels.noFailures}

## ${labels.unavailable}

${labels.unavailableNote}

${statusLines(unavailable).join('\n')}

## ${labels.notApplicable}

${statusLines(secondaryChecks).join('\n')}

## ${labels.optional}

${optionalLines.join('\n')}

## ${labels.evidenceMap}

${evidenceMapLines.join('\n')}

## ${labels.answerSnapshots}

${answerSnapshotLines.join('\n')}

## ${labels.monitoring}

${monitoringLines.join('\n')}

## ${labels.limitations}

${limitationLines.join('\n')}

## ${labels.handoff}

\`\`\`text
${handoffPrompt.replace(/\`\`\`/g, "'''")}
\`\`\`
`;
  }

  function pageTypeLabel(value, lang) {
    const t = copy(lang);
    const labels = { home: t.pageTypeHome, about: t.pageTypeAbout, article: t.pageTypeArticle, page: t.pageTypePage };
    return labels[String(value ?? '').toLowerCase()] ?? String(value || t.pageTypePage).replace(/_/g, ' ');
  }

  function pageStatusLabel(value, lang) {
    const t = copy(lang);
    const labels = { complete: t.pageStatusComplete, ok: t.pageStatusComplete, error: t.pageStatusError, failed: t.pageStatusError };
    return labels[String(value ?? '').toLowerCase()] ?? String(value || '');
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
    const limitRows = scoreLimitRows(scores, lang);

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
        <span class="mt-0.5 text-[10px] font-semibold uppercase text-slate-400 w-16 shrink-0">${escapeHtml(pageTypeLabel(page.type, lang))}</span>
        <span class="min-w-0 text-xs">${link}${page.status ? `<span class="ml-1.5 text-[10px] text-slate-400">${escapeHtml(pageStatusLabel(page.status, lang))}</span>` : ''}${browserBadge}</span>
      </li>`;
    }).join('');

    const actionRows = actions.map((action, index) => {
      const href = safeHttpUrl(action.page);
      const actionPage = action.page ? compact(pageLabel(action.page), 76) : '';
      const pageMarkup = actionPage
        ? `${t.page}: ${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" class="text-blue-600 hover:text-blue-700">${escapeHtml(actionPage)}</a>` : escapeHtml(actionPage)}`
        : '';
      const severity = action.severity || action.priority || t.unknown;
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
            <span class="text-[10px] font-semibold uppercase border border-slate-200 bg-white text-slate-500 px-1.5 py-0.5 rounded">${escapeHtml(severity)}</span>
            ${action.predicted ? `<span class="text-[10px] font-semibold uppercase border border-purple-200 bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded">${escapeHtml(t.predicted)}</span>` : ''}
          </div>
          <div class="text-[11px] text-slate-400 mt-0.5">${pageMarkup || `${escapeHtml(t.page)}: ${escapeHtml(t.notProvided)}`}</div>
          <details class="group mt-2 rounded-lg border border-slate-200 bg-white/70 print:border-0" data-disclosure="top-action-details">
            <summary class="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900">${escapeHtml(t.actionDetails)}</summary>
            <div class="px-3 pb-3 text-xs text-slate-500 leading-relaxed space-y-1">${lines || `<p>${escapeHtml(t.notProvided)}</p>`}</div>
          </details>
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
          ${scores.scoreVersion ? `<div class="text-[10px] text-slate-400 mt-1">${escapeHtml(t.scoreVersion)} ${escapeHtml(scores.scoreVersion)}</div>` : ''}
          ${limitRows.length ? `<details class="mt-3 rounded-lg border border-amber-200 bg-amber-50" data-disclosure="score-limits"><summary class="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-amber-800">${escapeHtml(t.scoreLimits)}</summary><ul class="space-y-1 px-3 pb-3">${limitRows.join('')}</ul></details>` : ''}
        </div>
        <div class="shrink-0 print:hidden" role="group" aria-label="${escapeHtml(ui.reportLanguage)}">
          <div class="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button type="button" data-report-lang="zh" class="report-lang-btn text-xs font-medium px-2.5 py-1 rounded-md ${language(lang) === 'zh' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-800'}">中文</button>
            <button type="button" data-report-lang="en" class="report-lang-btn text-xs font-medium px-2.5 py-1 rounded-md ${language(lang) === 'en' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-800'}">EN</button>
          </div>
        </div>
      </div>
      <details class="rounded-xl border border-slate-200 bg-white" data-disclosure="profile-pages">
        <summary class="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-slate-700 hover:text-slate-900">${escapeHtml(t.profileDetails)}</summary>
        <div class="grid md:grid-cols-2 gap-x-8 gap-y-5 px-4 pb-4">
          <section class="min-w-0">
            <div class="space-y-1.5">${profileFacts || `<p class="text-xs text-slate-400">${escapeHtml(t.unknown)}</p>`}</div>
            ${evidence.length ? `<div class="mt-3"><div class="text-[10px] font-semibold uppercase text-slate-400 mb-1.5">${escapeHtml(t.evidence)}</div><ul class="space-y-1">${evidence.map(item => `<li class="text-xs text-slate-500 flex gap-2"><span class="text-blue-400">-</span><span>${escapeHtml(compact(item, 180))}</span></li>`).join('')}</ul></div>` : ''}
          </section>
          <section class="min-w-0">
            <h3 class="text-[10px] font-semibold uppercase text-slate-400 mb-1">${escapeHtml(t.pages)}</h3>
            ${pageRows ? `<ul>${pageRows}</ul>` : `<p class="text-xs text-slate-400">${escapeHtml(t.notProvided)}</p>`}
          </section>
        </div>
      </details>
      ${actions.length ? `<section class="mt-5 pt-4 border-t border-slate-200"><h3 class="text-sm font-bold text-slate-900 mb-1">${escapeHtml(t.actions)}</h3><ol>${actionRows}</ol></section>` : ''}
    </div>`;
  }

  function statusView(status, lang) {
    const t = copy(lang);
    const views = {
      pass: { label: t.pass, cls: 'border-green-200 bg-green-50 text-green-700', icon: '✓' },
      fail: { label: t.fail, cls: 'border-orange-200 bg-orange-50 text-orange-700', icon: '✕' },
      not_applicable: { label: t.notApplicable, cls: 'border-slate-200 bg-slate-50 text-slate-500', icon: '–' },
      error: { label: t.checkError, cls: 'border-red-200 bg-red-50 text-red-700', icon: '!' },
      unknown: { label: t.unknownStatus, cls: 'border-slate-200 bg-slate-50 text-slate-500', icon: '?' },
    };
    return views[status] ?? views.unknown;
  }

  function renderCheckRows(checks, lang) {
    const t = copy(lang);
    return checks.map(check => {
      const view = check.predicted
        ? { label: t.predicted, cls: 'border-purple-200 bg-purple-50 text-purple-700', icon: '◇' }
        : statusView(check.status, lang);
      const href = safeHttpUrl(check.page);
      const page = check.page ? compact(pageLabel(check.page), 84) : '';
      const source = check.source ? `${t.source}: ${check.source}` : '';
      const confidence = formatPercent(check.confidence);
      return `<li class="py-3 border-t border-slate-100 first:border-t-0">
        <div class="flex items-start gap-3">
          <span class="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-semibold ${view.cls}"><span>${view.icon}</span>${escapeHtml(view.label)}</span>
          <div class="min-w-0 flex-1">
            <div class="flex items-start justify-between gap-3">
              <h4 class="text-sm font-semibold text-slate-800 break-words">${escapeHtml(check.title || check.id)}</h4>
              <code class="text-[10px] text-slate-400 break-all">${escapeHtml(check.id)}</code>
            </div>
            ${page ? `<div class="text-[11px] text-slate-400 mt-1">${escapeHtml(t.page)}: ${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" class="text-blue-600 hover:text-blue-700">${escapeHtml(page)}</a>` : escapeHtml(page)}</div>` : ''}
            ${check.evidence.length ? `<ul class="mt-1.5 space-y-1">${check.evidence.slice(0, 5).map(item => `<li class="text-xs text-slate-500 flex gap-2"><span class="text-slate-300">•</span><span class="break-words">${escapeHtml(compact(item, 420))}</span></li>`).join('')}</ul>` : ''}
            ${(source || confidence) ? `<div class="text-[10px] text-slate-400 mt-1.5">${escapeHtml([source, confidence ? `${t.confidence} ${confidence}` : ''].filter(Boolean).join(' · '))}</div>` : ''}
          </div>
        </div>
      </li>`;
    }).join('');
  }

  function renderNormalizedChecks(data, lang) {
    const checks = normalizeChecks(data, lang);
    if (!checks.length) return '';
    const t = copy(lang);
    const factual = checks.filter(check => !check.predicted);
    const predicted = checks.filter(check => check.predicted);
    const summary = checkSummary(data, lang);
    return `<section id="card-evidence-checks" class="bg-white rounded-xl border border-slate-200 fade-in" data-category="all">
      <details data-disclosure="normalized-checks">
        <summary class="cursor-pointer select-none px-4 py-3.5">
          <span class="block font-bold text-sm text-slate-900">${escapeHtml(t.factualChecks)}</span>
          <span class="block text-[11px] text-slate-400 mt-0.5">${escapeHtml(`${summary.pass} ${t.pass} · ${summary.fail} ${t.fail} · ${summary.unknown} ${t.unknownStatus} · ${summary.error} ${t.checkError} · ${summary.not_applicable} ${t.notApplicable}`)}</span>
        </summary>
        <div class="px-4 pb-4 border-t border-slate-100">
          <ul>${renderCheckRows(factual, lang)}</ul>
          ${predicted.length ? `<details class="mt-4 border-t border-purple-100" data-disclosure="predicted-checks"><summary class="cursor-pointer select-none pt-4 text-sm font-semibold text-purple-800">${escapeHtml(t.predictedChecks)}</summary><p class="text-xs text-purple-600 mt-1">${escapeHtml(t.predictedNote)}</p><ul class="mt-2">${renderCheckRows(predicted, lang)}</ul></details>` : ''}
        </div>
      </details>
    </section>`;
  }

  function renderEvidenceRecommendations(data, lang) {
    const actions = normalizeAllActions(data, lang).filter(action => !action.predicted);
    const t = copy(lang);
    if (!Array.isArray(data?.recommendations_v2)) return '';
    return `<section id="recs-section" class="bg-white rounded-xl border border-blue-200 fade-in" data-category="all">
      <details data-disclosure="full-repair-plan">
        <summary class="cursor-pointer select-none px-4 py-3.5"><span class="block font-bold text-sm text-slate-900">${escapeHtml(t.allActions)}</span><span class="block text-[11px] text-slate-400 mt-0.5">${escapeHtml(t.scoreEvidence)}</span></summary>
        <div class="px-4 pb-4 border-t border-blue-100">
      ${actions.length ? `<ol class="space-y-3 pt-3">${actions.map((action, index) => {
        const href = safeHttpUrl(action.page);
        const page = action.page ? compact(pageLabel(action.page), 84) : '';
        return `<li class="border border-slate-100 rounded-xl p-3.5" data-recommendation-id="${escapeHtml(action.id)}">
          <div class="flex items-start gap-3"><span class="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0">${index + 1}</span><div class="min-w-0 flex-1">
            <div class="flex items-start gap-2 flex-wrap"><h3 class="font-semibold text-sm text-slate-900">${escapeHtml(action.title || action.id)}</h3>${action.priority ? `<span class="text-[10px] uppercase border border-slate-200 rounded px-1.5 py-0.5 text-slate-500">${escapeHtml(action.priority)}</span>` : ''}</div>
            <div class="text-[11px] text-slate-400 mt-1">${escapeHtml(t.page)}: ${page ? (href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" class="text-blue-600 hover:text-blue-700">${escapeHtml(page)}</a>` : escapeHtml(page)) : escapeHtml(t.notProvided)}</div>
            <details class="mt-2 rounded-lg border border-slate-200 bg-slate-50/60" data-disclosure="repair-action-details">
              <summary class="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-slate-600">${escapeHtml(t.actionDetails)}</summary>
              <div class="px-3 pb-3 text-xs text-slate-500 leading-relaxed space-y-1">
                ${action.observed ? `<p><strong class="text-slate-600">${escapeHtml(t.observed)}:</strong> ${escapeHtml(action.observed)}</p>` : ''}
                ${action.reason ? `<p><strong class="text-slate-600">${escapeHtml(t.reason)}:</strong> ${escapeHtml(action.reason)}</p>` : ''}
                ${action.fix ? `<p><strong class="text-slate-600">${escapeHtml(t.fix)}:</strong> ${escapeHtml(action.fix)}</p>` : ''}
                ${action.verify ? `<p><strong class="text-slate-600">${escapeHtml(t.verify)}:</strong> ${escapeHtml(action.verify)}</p>` : ''}
                <button type="button" data-action="toggle-fix" data-recommendation-id="${escapeHtml(action.id)}" class="mt-2 text-xs font-semibold text-blue-700 border border-blue-200 hover:bg-blue-50 rounded-lg px-3 py-1.5 print:hidden">${escapeHtml(t.howToFix)} ▾</button>
                <div class="hidden mt-3 what-to-do"></div>
              </div>
            </details>
          </div></div>
        </li>`;
      }).join('')}</ol>` : `<p class="text-xs text-slate-500 pt-3">${escapeHtml(t.noActions)}</p>`}
        </div>
      </details>
    </section>`;
  }

  function formatTimestamp(value, lang) {
    const raw = finiteNumber(value);
    const date = raw !== null
      ? new Date(raw > 10_000_000_000 ? raw : raw * 1000)
      : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value ?? '');
    try {
      return new Intl.DateTimeFormat(language(lang) === 'zh' ? 'zh-CN' : 'en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
    } catch {
      return date.toISOString();
    }
  }

  function evidenceStatusBadge(status, lang) {
    const t = copy(lang);
    const value = String(status || 'unknown').toLowerCase();
    const views = {
      complete: { label: t.complete, cls: 'border-green-200 bg-green-50 text-green-700' },
      partial: { label: language(lang) === 'zh' ? '部分完成' : 'Partial', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
      unavailable: { label: t.unknownStatus, cls: 'border-slate-200 bg-slate-50 text-slate-500' },
      error: { label: t.checkError, cls: 'border-orange-200 bg-orange-50 text-orange-700' },
      running: { label: t.running, cls: 'border-blue-200 bg-blue-50 text-blue-700' },
    };
    const view = views[value] ?? { label: value || t.unknownStatus, cls: 'border-slate-200 bg-slate-50 text-slate-500' };
    return `<span class="inline-flex rounded border px-2 py-0.5 text-[10px] font-semibold ${view.cls}">${escapeHtml(view.label)}</span>`;
  }

  function answerSnapshotValue(value) {
    if (Array.isArray(value?.observations)) return value;
    if (Array.isArray(value?.snapshot?.observations)) return value.snapshot;
    return null;
  }

  function renderAnswerObservation(observation, lang, expanded = false) {
    const t = copy(lang);
    const answer = localized(observation?.answer, lang);
    const query = localized(observation?.query, lang);
    const model = localized(observation?.model, lang) || t.unknown;
    const citations = Array.isArray(observation?.citations) ? observation.citations : [];
    const meta = [
      `${t.answerModel}: ${model}`,
      `${t.status}: ${observation?.status || t.unknownStatus}`,
      observation?.observed_at ? formatTimestamp(observation.observed_at, lang) : '',
      observation?.latency_ms == null ? '' : `${t.answerLatency}: ${Math.round(Number(observation.latency_ms))}ms`,
      `${t.answerCitations}: ${citations.length}`,
    ].filter(Boolean).join(' · ');
    const citationRows = citations.map((citation, index) => {
      const href = safeHttpUrl(citation?.url);
      const title = localized(citation?.title, lang) || href || `${t.source} ${index + 1}`;
      return `<li class="break-words">${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" class="font-medium text-blue-700 hover:text-blue-800">${escapeHtml(title)}</a>` : escapeHtml(title)}</li>`;
    }).join('');
    return `<div class="border-l-2 border-cyan-200 pl-3 py-1">
      <div class="flex flex-wrap items-center gap-2">${evidenceStatusBadge(observation?.status, lang)}<span class="text-[10px] text-slate-400 break-words">${escapeHtml(meta)}</span></div>
      ${query ? `<p class="mt-1 text-xs font-semibold text-slate-700 break-words">${escapeHtml(t.answerQuery)}: ${escapeHtml(query)}</p>` : ''}
      ${answer ? `<p class="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-600">${escapeHtml(compact(answer, expanded ? 20_000 : 520))}</p>` : ''}
      ${(answer || citationRows) ? `<details class="mt-2" data-disclosure="api-answer-full"><summary class="cursor-pointer text-[11px] font-medium text-cyan-700">${escapeHtml(t.fullAnswer)}</summary><div class="mt-2 space-y-2">${answer ? `<div class="whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-600">${escapeHtml(answer)}</div>` : ''}${citationRows ? `<ol class="list-decimal space-y-1 pl-4 text-[11px] text-slate-500">${citationRows}</ol>` : ''}</div></details>` : ''}
    </div>`;
  }

  function renderAnswerSnapshot(value, lang, heading = null) {
    const t = copy(lang);
    const snapshot = answerSnapshotValue(value);
    const observations = Array.isArray(snapshot?.observations) ? snapshot.observations : [];
    if (!observations.length) return '';
    const first = renderAnswerObservation(observations[0], lang);
    const rest = observations.slice(1).map(item => renderAnswerObservation(item, lang, true)).join('');
    return `<div class="space-y-3" data-answer-snapshot>
      <div class="flex flex-wrap items-center justify-between gap-2"><h3 class="text-xs font-bold text-slate-800">${escapeHtml(heading || t.latestAnswer)}</h3><span class="text-[10px] font-medium text-cyan-700">${escapeHtml(t.evidenceMapZeroWeight)}</span></div>
      ${first}
      ${rest ? `<details data-disclosure="other-api-answers"><summary class="cursor-pointer text-[11px] font-semibold text-slate-600">${escapeHtml(t.otherAnswers)} · ${observations.length - 1}</summary><div class="mt-2 space-y-3">${rest}</div></details>` : ''}
      ${Array.isArray(snapshot?.limitations) && snapshot.limitations.length ? `<details data-disclosure="api-answer-limitations"><summary class="cursor-pointer text-[11px] font-medium text-slate-500">${escapeHtml(t.limitations)}</summary><ul class="mt-1 list-disc space-y-1 pl-4 text-[11px] text-slate-500">${snapshot.limitations.map(item => `<li>${escapeHtml(localized(item, lang))}</li>`).join('')}</ul></details>` : ''}
    </div>`;
  }

  function renderEvidenceMap(data, lang, state) {
    if (!data?.audit_id) return '';
    const t = copy(lang);
    const snapshot = state?.snapshot ?? data?.evidence_map ?? null;
    const busy = state?.busy === true;
    const error = state?.error ? localized(state.error.message ?? state.error, lang) : '';
    const target = snapshot?.target ?? {};
    const queryPlan = Array.isArray(snapshot?.query_plan?.queries) ? snapshot.query_plan.queries : [];
    const opportunities = Array.isArray(snapshot?.opportunities) ? snapshot.opportunities : [];
    const diagnosis = Array.isArray(snapshot?.diagnosis) ? snapshot.diagnosis : [];
    const sources = Array.isArray(snapshot?.sources) ? snapshot.sources : [];
    const runs = Array.isArray(snapshot?.search_snapshot?.provider_runs) ? snapshot.search_snapshot.provider_runs : [];
    const limitations = Array.isArray(snapshot?.limitations) ? snapshot.limitations : [];
    const observedQueries = Array.isArray(target?.observed_queries) ? target.observed_queries : [];
    const runLabel = snapshot ? t.evidenceMapRefresh : t.evidenceMapRun;
    const answerPanel = renderAnswerSnapshot(snapshot?.answer_snapshot, lang);
    const answerError = !answerPanel && snapshot?.answer_gateway_error
      ? `<div role="alert" data-answer-error class="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
          <div class="font-semibold">${escapeHtml(t.answerUnavailable)}</div>
          <div class="mt-1 font-mono text-[10px]">${escapeHtml(snapshot.answer_gateway_error.code ?? t.unknown)}</div>
          <p class="mt-1 leading-relaxed">${escapeHtml(answerErrorMessage(snapshot.answer_gateway_error, lang) || t.noAnswer)}</p>
        </div>`
      : '';
    const metrics = snapshot ? `<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <div class="rounded-lg bg-slate-50 px-3 py-2"><div class="text-lg font-bold text-slate-800">${escapeHtml(target.appearances ?? 0)}</div><div class="text-[10px] text-slate-500">${escapeHtml(t.appearances)}</div></div>
      <div class="rounded-lg bg-slate-50 px-3 py-2"><div class="text-lg font-bold text-slate-800">${escapeHtml(observedQueries.length)}</div><div class="text-[10px] text-slate-500">${escapeHtml(t.observedQueries)}</div></div>
      <div class="col-span-2 rounded-lg bg-slate-50 px-3 py-2 sm:col-span-1"><div class="text-lg font-bold text-slate-800">${escapeHtml(opportunities.length)}</div><div class="text-[10px] text-slate-500">${escapeHtml(t.contentOpportunities)}</div></div>
    </div>` : '';
    const opportunityRows = opportunities.slice(0, 3).map(item => `<li class="flex gap-2 text-xs text-slate-600"><span class="text-amber-500">•</span><span class="min-w-0 break-words"><strong>${escapeHtml(localized(item?.query, lang))}</strong>${item?.intent ? ` · ${escapeHtml(item.intent)}` : ''}</span></li>`).join('');
    const sourceRows = sources.map(source => {
      const href = safeHttpUrl(source?.canonical_url ?? source?.url);
      const label = localized(source?.title, lang) || localized(source?.canonical_url ?? source?.url, lang);
      return `<li class="py-2 border-t border-slate-100 first:border-t-0 text-xs">
        <div class="flex items-start justify-between gap-3"><span class="min-w-0 break-words">${href ? `<a class="font-medium text-blue-700 hover:text-blue-800" href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>` : escapeHtml(label)}</span><span class="shrink-0 text-slate-400">#${escapeHtml(source?.provider_rank ?? '?')}</span></div>
        <div class="mt-1 text-[10px] text-slate-400 break-words">${escapeHtml([source?.source_type, source?.provider, source?.domain, source?.retrieved_at].filter(Boolean).join(' · '))}</div>
      </li>`;
    }).join('');
    const runRows = runs.map(run => `<li class="py-2 border-t border-slate-100 first:border-t-0 text-xs text-slate-600"><span class="font-medium">${escapeHtml(run?.provider ?? 'API')}</span> · ${escapeHtml(run?.status ?? t.unknownStatus)} · ${escapeHtml(run?.result_count ?? 0)} · ${escapeHtml(run?.latency_ms ?? 0)}ms${run?.cache_hit ? ' · cache' : ''}</li>`).join('');
    const diagnosisRows = diagnosis.map(item => `<li class="py-1.5 text-xs text-slate-600"><span class="font-semibold">${escapeHtml(item?.stage ?? t.unknownStatus)}</span> · ${escapeHtml(item?.status ?? t.unknownStatus)}${Array.isArray(item?.evidence) && item.evidence[0] ? ` · ${escapeHtml(compact(item.evidence[0], 240))}` : ''}</li>`).join('');
    const queryRows = queryPlan.map(item => `<li class="text-xs text-slate-600">${escapeHtml(localized(item?.query ?? item, lang))}${item?.intent ? ` · ${escapeHtml(item.intent)}` : ''}</li>`).join('');

    return `<section id="evidence-map-section" class="bg-white rounded-xl border border-cyan-200 p-4 fade-in" data-category="all">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0"><div class="flex items-center gap-2 flex-wrap"><h2 class="font-bold text-sm text-slate-900">${escapeHtml(t.evidenceMap)}</h2>${snapshot ? evidenceStatusBadge(snapshot.status, lang) : ''}</div><p class="text-xs text-slate-500 mt-1 leading-relaxed">${escapeHtml(t.evidenceMapBody)}</p><p class="text-[11px] font-medium text-cyan-700 mt-1">${escapeHtml(t.evidenceMapZeroWeight)}</p></div>
        <button type="button" data-action="run-evidence-map" ${busy ? 'disabled' : ''} class="shrink-0 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-semibold text-cyan-800 hover:bg-cyan-100 disabled:cursor-wait disabled:opacity-60 print:hidden">${escapeHtml(busy ? t.evidenceMapRunning : runLabel)}</button>
      </div>
      ${error ? `<div role="alert" class="mt-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-700">${escapeHtml(error)}</div>` : ''}
      ${snapshot ? `<div class="mt-4 space-y-4">${answerPanel}${answerError}${metrics}${opportunityRows ? `<div><h3 class="text-xs font-semibold text-slate-700 mb-1.5">${escapeHtml(t.contentOpportunities)}</h3><ul class="space-y-1.5">${opportunityRows}</ul></div>` : ''}
        <details class="rounded-lg border border-slate-200" data-disclosure="evidence-provenance"><summary class="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-slate-700">${escapeHtml(t.provenance)}</summary><div class="px-3 pb-3 space-y-3">
          ${queryRows ? `<div><div class="text-[10px] font-semibold uppercase text-slate-400 mb-1">${escapeHtml(t.querySettings)}</div><ul class="space-y-1">${queryRows}</ul></div>` : ''}
          ${diagnosisRows ? `<div><div class="text-[10px] font-semibold uppercase text-slate-400 mb-1">${escapeHtml(t.diagnosis)}</div><ul>${diagnosisRows}</ul></div>` : ''}
          ${sourceRows ? `<div><div class="text-[10px] font-semibold uppercase text-slate-400 mb-1">${escapeHtml(t.source)}</div><ul>${sourceRows}</ul></div>` : ''}
          ${runRows ? `<div><div class="text-[10px] font-semibold uppercase text-slate-400 mb-1">${escapeHtml(t.providerRuns)}</div><ul>${runRows}</ul></div>` : ''}
          ${limitations.length ? `<div><div class="text-[10px] font-semibold uppercase text-slate-400 mb-1">${escapeHtml(t.limitations)}</div><ul class="list-disc pl-4 space-y-1 text-xs text-slate-500">${limitations.map(item => `<li>${escapeHtml(localized(item, lang))}</li>`).join('')}</ul></div>` : ''}
        </div></details>
      </div>` : `<p class="mt-3 text-xs text-slate-400">${escapeHtml(t.evidenceMapEmpty)}</p>`}
    </section>`;
  }

  function monitorIntentOptions(selected, lang) {
    const t = copy(lang);
    const labels = {
      branded: t.intentBranded,
      informational: t.intentInformational,
      task: t.intentTask,
      comparison: t.intentComparison,
      local: t.intentLocal,
      navigational: t.intentNavigational,
    };
    return Object.entries(labels).map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
  }

  function renderMonitoring(data, lang, state) {
    if (!data?.audit_id) return '';
    const t = copy(lang);
    const project = state?.project ?? null;
    const runs = Array.isArray(state?.runs) ? state.runs : [];
    const busy = state?.busy === true;
    const error = state?.error ? localized(state.error.message ?? state.error, lang) : '';
    const message = localized(state?.message, lang);
    const token = state?.showToken ? state?.managementToken : '';
    const modelOptions = Array.isArray(state?.modelOptions) ? state.modelOptions : [];
    const queryRows = Array.isArray(project?.queries) ? project.queries.map((query, index) => `<div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
      <label class="min-w-0"><span class="sr-only">${escapeHtml(`${t.querySettings} ${index + 1}`)}</span><input type="text" name="query" maxlength="240" required value="${escapeHtml(query?.query ?? '')}" class="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700 focus:border-blue-400 focus:outline-none"></label>
      <label><span class="sr-only">${escapeHtml(t.queryIntent)}</span><select name="intent" class="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700 focus:border-blue-400 focus:outline-none">${monitorIntentOptions(query?.intent ?? 'informational', lang)}</select></label>
    </div>`).join('') : '';
    const historyRows = runs.map(run => {
      const score = run?.factual_score == null ? t.insufficient : `${Math.round(Number(run.factual_score))}/100`;
      const delta = run?.score_delta == null ? '—' : `${Number(run.score_delta) > 0 ? '+' : ''}${run.score_delta}`;
      const evidenceRuns = Array.isArray(run?.evidence?.snapshot?.provider_runs) ? run.evidence.snapshot.provider_runs : [];
      const provenanceRows = evidenceRuns.map(item => `<li>${escapeHtml([item?.provider ?? 'API', item?.status, item?.result_count == null ? '' : `${item.result_count} results`, item?.latency_ms == null ? '' : `${item.latency_ms}ms`].filter(Boolean).join(' · '))}</li>`).join('');
      const runAnswer = renderAnswerSnapshot(run?.answer, lang, t.latestAnswer);
      return `<li class="py-3 border-t border-slate-100 first:border-t-0">
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs"><span class="font-semibold text-slate-700">${escapeHtml(formatTimestamp(run?.created_at, lang))}</span>${evidenceStatusBadge(run?.status, lang)}</div>
        <div class="mt-1 text-[11px] text-slate-500">${escapeHtml(score)} · ${escapeHtml(t.scoreDelta)} ${escapeHtml(delta)} · ${escapeHtml(run?.run_type ?? '')} · ${escapeHtml(run?.baseline_action ?? t.baseline)}</div>
        ${provenanceRows ? `<details class="mt-2" data-disclosure="monitor-run-provenance"><summary class="cursor-pointer text-[11px] font-medium text-slate-500">${escapeHtml(t.provenance)}</summary><ul class="mt-1 list-disc pl-4 text-[11px] text-slate-400 space-y-1">${provenanceRows}</ul></details>` : ''}
        ${runAnswer ? `<div class="mt-3">${runAnswer}</div>` : ''}
      </li>`;
    }).join('');

    const create = `<form data-monitor-form="create" class="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
      <label class="min-w-0 flex-1"><span class="block text-[11px] font-medium text-slate-600 mb-1">${escapeHtml(t.optionalEmail)}</span><input type="email" name="email" autocomplete="email" class="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-blue-400 focus:outline-none"></label>
      <button type="submit" ${busy ? 'disabled' : ''} class="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-wait disabled:opacity-60">${escapeHtml(busy ? t.saving : t.createMonitor)}</button>
    </form>`;
    const connect = `<details class="mt-3 rounded-lg border border-slate-200" data-disclosure="connect-monitor"><summary class="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-slate-700">${escapeHtml(t.connectMonitor)}</summary><form data-monitor-form="connect" class="grid gap-2 px-3 pb-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
      <label><span class="block text-[11px] font-medium text-slate-600 mb-1">${escapeHtml(t.projectId)}</span><input type="text" name="project_id" autocomplete="off" required class="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-blue-400 focus:outline-none"></label>
      <label><span class="block text-[11px] font-medium text-slate-600 mb-1">${escapeHtml(t.projectToken)}</span><input type="password" name="management_token" autocomplete="off" class="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-blue-400 focus:outline-none"></label>
      <button type="submit" ${busy ? 'disabled' : ''} class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">${escapeHtml(t.connect)}</button>
    </form></details>`;
    const latestRunAnswer = renderAnswerSnapshot(runs[0]?.answer, lang, t.latestAnswer);
    const modelList = modelOptions.map(model => `<option value="${escapeHtml(model)}"></option>`).join('');
    const controls = project ? `<div class="mt-4 space-y-4">
      ${token ? `<div role="status" class="rounded-lg border border-amber-200 bg-amber-50 p-3"><div class="text-xs font-semibold text-amber-800">${escapeHtml(t.managementToken)}</div><p class="mt-1 text-[11px] text-amber-700">${escapeHtml(t.tokenWarning)}</p><code id="monitor-management-token" class="mt-2 block overflow-x-auto whitespace-nowrap rounded bg-white px-2 py-1.5 text-xs text-slate-700">${escapeHtml(token)}</code><div class="mt-2 flex flex-wrap gap-2"><button type="button" data-action="copy-monitor-token" class="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-800">${escapeHtml(SHARED_I18N?.t?.('common.copy', {}, language(lang)) ?? 'Copy')}</button><button type="button" data-action="save-monitor-token" class="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-800">${escapeHtml(t.saveOnDevice)}</button><button type="button" data-action="dismiss-monitor-token" class="rounded border border-amber-300 px-2.5 py-1 text-xs font-semibold text-amber-800">${escapeHtml(t.tokenSaved)}</button></div></div>` : ''}
      <div class="flex flex-col gap-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between"><span><code>${escapeHtml(project.id ?? '')}</code> · ${escapeHtml(project.root_domain ?? data.domain ?? '')} · ${escapeHtml(project.schedule ?? 'weekly')}${state?.tokenSaved ? ` · ${escapeHtml(t.savedOnDevice)}` : ''}</span><span class="flex flex-wrap gap-2"><button type="button" data-action="save-monitor-token" class="font-semibold text-indigo-700 hover:text-indigo-800">${escapeHtml(t.saveOnDevice)}</button><button type="button" data-action="forget-monitor-token" class="font-semibold text-slate-500 hover:text-slate-700">${escapeHtml(t.forgetDevice)}</button><button type="button" data-action="rotate-monitor-token" class="font-semibold text-orange-700 hover:text-orange-800">${escapeHtml(t.rotateToken)}</button></span></div>
      <form data-monitor-form="queries" class="rounded-xl border border-slate-200 p-3"><div class="text-xs font-semibold text-slate-700 mb-2">${escapeHtml(t.querySettings)}</div><div class="space-y-2">${queryRows}</div><button type="submit" ${busy ? 'disabled' : ''} class="mt-3 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">${escapeHtml(busy ? t.saving : t.saveQueries)}</button></form>
      <div class="grid gap-3 lg:grid-cols-2">
        <button type="button" data-action="run-monitor-default" ${busy ? 'disabled' : ''} class="rounded-xl border border-blue-200 bg-blue-50 px-3 py-3 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-wait disabled:opacity-60">${escapeHtml(busy ? t.running : t.runDefault)}</button>
        <form data-monitor-form="byok" class="rounded-xl border border-slate-200 p-3 space-y-2"><label><span class="block text-[11px] font-medium text-slate-600 mb-1">${escapeHtml(t.apiKey)}</span><input type="password" name="api_key" autocomplete="off" minlength="12" maxlength="512" required class="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-blue-400 focus:outline-none"></label><label><span class="block text-[11px] font-medium text-slate-600 mb-1">${escapeHtml(t.apiBaseUrl)}</span><input type="url" name="api_base_url" inputmode="url" autocomplete="off" required placeholder="https://api.example.com" class="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-blue-400 focus:outline-none"></label><div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"><label><span class="block text-[11px] font-medium text-slate-600 mb-1">${escapeHtml(t.apiModel)}</span><input type="text" name="api_model" list="monitor-api-model-list" autocomplete="off" maxlength="160" required class="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-blue-400 focus:outline-none"></label><button type="button" data-action="fetch-monitor-models" ${busy ? 'disabled' : ''} class="self-end rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">${escapeHtml(t.fetchModels)}</button></div><datalist id="monitor-api-model-list">${modelList}</datalist><p class="text-[10px] text-slate-400">${escapeHtml(t.apiKeyPrivacy)}</p><button type="submit" ${busy ? 'disabled' : ''} class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60">${escapeHtml(busy ? t.running : t.runByok)}</button></form>
      </div>
      ${latestRunAnswer ? `<div class="border-t border-slate-100 pt-4">${latestRunAnswer}</div>` : ''}
      <details class="rounded-xl border border-slate-200" data-disclosure="monitoring-history"><summary class="cursor-pointer select-none px-3 py-2.5 text-xs font-semibold text-slate-700">${escapeHtml(t.monitorHistory)} · ${escapeHtml(runs.length)}</summary><div class="px-3 pb-3"><p class="text-[10px] text-slate-400 mb-2">${escapeHtml(t.historyRetention)}</p>${historyRows ? `<ul>${historyRows}</ul>` : `<p class="text-xs text-slate-400">${escapeHtml(t.noHistory)}</p>`}</div></details>
      ${connect}
    </div>` : `${create}${connect}`;

    return `<section id="monitoring-section" class="bg-white rounded-xl border border-indigo-200 p-4 fade-in" data-category="all">
      <div><div class="flex items-center gap-2 flex-wrap"><h2 class="font-bold text-sm text-slate-900">${escapeHtml(t.monitoring)}</h2>${project ? `<span class="rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">weekly</span>` : ''}</div><p class="text-xs text-slate-500 mt-1 leading-relaxed">${escapeHtml(t.monitoringBody)}</p></div>
      ${error ? `<div role="alert" class="mt-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-700">${escapeHtml(error)}</div>` : ''}
      ${message ? `<div role="status" class="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">${escapeHtml(message)}</div>` : ''}
      ${controls}
    </section>`;
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
    answerErrorMessage,
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
    normalizeAllActions,
    normalizeChecks,
    normalizeContext,
    normalizePages,
    normalizeScoreSummary,
    generateFullRepairMarkdown,
    checkSummary,
    renderCheckSummaryBar,
    performanceSourceLabel,
    isEvidenceAudit,
    parseAuditInput,
    renderEvidenceRecommendations,
    renderEvidenceMap,
    renderMonitoring,
    renderEvidenceSummary,
    renderNormalizedChecks,
    renderLighthouse,
    readabilityView,
    sanitizeError,
    sameScoreVersion,
  };
})(typeof window !== 'undefined' ? window : globalThis);
