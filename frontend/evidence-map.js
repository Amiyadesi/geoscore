(function (global) {
  'use strict';

  /** @type {Readonly<{ snapshot: any; busy: boolean; error: { message: string } | null }>} */
  const EMPTY_STATE = Object.freeze({ snapshot: null, busy: false, error: null });

  function sanitizeSnapshot(value) {
    if (Array.isArray(value)) return value.map(sanitizeSnapshot);
    if (!value || typeof value !== 'object') return value;
    const blocked = new Set(['api_key', 'apikey', 'authorization', 'api_base_url', 'base_url', 'endpoint', 'api_model']);
    const clean = {};
    for (const [key, item] of Object.entries(value)) {
      if (blocked.has(key.toLowerCase())) continue;
      clean[key] = sanitizeSnapshot(item);
    }
    return clean;
  }

  /**
   * Turns the snapshot's anchoring block into presentation data. Returns null for
   * snapshots without anchoring (older audits), so the renderer can skip the card
   * instead of drawing an empty ladder.
   */
  function describeAnchoring(snapshot) {
    const anchoring = snapshot?.anchoring;
    if (!anchoring || !Array.isArray(anchoring.rungs) || !anchoring.rungs.length) return null;

    const rungs = anchoring.rungs.map(rung => ({
      rung: Number(rung?.rung) || 0,
      label: rung?.rung_label || 'generic',
      brandFree: Boolean(rung?.brand_free),
      intent: rung?.intent || 'unknown',
      query: String(rung?.query || ''),
      observed: Boolean(rung?.observed),
      observedSources: Number(rung?.observed_sources) || 0,
      providers: Array.isArray(rung?.observed_providers) ? rung.observed_providers : [],
    }));
    const probe = anchoring.next_probe;

    return {
      state: rungs.some(rung => rung.observed) ? 'observed' : 'not_observed',
      brandFreeObserved: Boolean(anchoring.brand_free_observed),
      vaguestBrandFreeRung: anchoring.vaguest_brand_free_rung_observed ?? null,
      rungs,
      nextProbe: probe ? { rung: Number(probe.rung) || 0, label: probe.rung_label || 'generic', query: String(probe.query || '') } : null,
      unprobedRungs: Array.isArray(anchoring.unprobed_rungs) ? anchoring.unprobed_rungs.length : 0,
      limitations: Array.isArray(anchoring.limitations) ? anchoring.limitations : [],
    };
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const ANCHORING_COPY = {
    en: {
      title: 'Anchoring depth',
      body: 'How vague a query still surfaced this site in the dated snapshot. The probe wording is generated from the audit, shown verbatim, and never changes the factual score.',
      observed: 'Vaguest rung still observed',
      notObserved: 'No brand-free probe returned this site in the snapshot.',
      notObservedHint: 'That can mean the wording is broader than the site is associated with, or that the provider has no coverage for it.',
      noProbe: 'The audit found no field evidence, so no brand-free probe was generated.',
      probe: 'Probe',
      result: 'Result',
      sawIt: 'observed',
      missed: 'not observed',
      notRun: 'not run yet',
      nextProbe: 'Next probe still unrun',
      limitations: 'Limitations',
      zeroWeight: 'Anchoring evidence never changes the factual score.',
    },
    zh: {
      title: '锚定深度',
      body: '这份带日期的快照显示：多模糊的查询仍然能搜到这个站点。探测词由审计证据生成并按原文展示，永不参与事实分数。',
      observed: '仍可观测到的最模糊级别',
      notObserved: '本次快照中，没有任何不含品牌名的探测返回该站点。',
      notObservedHint: '这可能说明探测词比站点实际关联的范围更宽，也可能只是该 provider 对这个措辞没有覆盖。',
      noProbe: '本次审计没有取得领域证据，因此没有生成不含品牌名的探测。',
      probe: '探测词',
      result: '结果',
      sawIt: '已观测',
      missed: '未观测',
      notRun: '尚未运行',
      nextProbe: '尚未运行的下一次探测',
      limitations: '局限',
      zeroWeight: '锚定证据永不参与事实分数。',
    },
  };

  const RUNG_TEXT = {
    en: { generic: 'role only, no brand', field: 'field, no brand', branded: 'brand', navigational: 'direct name' },
    zh: { generic: '仅角色，无品牌', field: '领域，无品牌', branded: '品牌', navigational: '直接名称' },
  };

  function anchoringRungText(label, lang) {
    const table = RUNG_TEXT[lang === 'zh' ? 'zh' : 'en'];
    return table[label] ?? label;
  }

  function anchoringStatusText(observed, lang, copy) {
    const tone = observed ? 'text-emerald-700' : 'text-slate-500';
    const mark = observed ? '✓' : '•';
    return `<span class="${tone}">${mark} ${escapeHtml(observed ? copy.sawIt : copy.missed)}</span>`;
  }

  function anchoringRows(view, lang, copy) {
    return view.rungs.map(rung => {
      const providers = rung.providers.length
        ? `<div class="mt-1 text-[10px] text-slate-400 break-words">${escapeHtml(rung.providers.join(', '))}</div>`
        : '';
      const brandFreeTag = rung.brandFree ? ' · brand-free' : '';
      return `<li class="py-2 border-t border-slate-100 first:border-t-0 text-xs" data-anchoring-rung="${escapeHtml(rung.rung)}">
        <div class="flex items-start justify-between gap-3">
          <span class="min-w-0 break-words"><span class="font-mono text-[10px] text-slate-400">L${escapeHtml(rung.rung)}</span> <span class="font-medium text-slate-700">${escapeHtml(rung.query)}</span></span>
          <span class="shrink-0 text-right">${anchoringStatusText(rung.observed, lang, copy)}<span class="block text-[10px] text-slate-400">${escapeHtml(anchoringRungText(rung.label, lang))}${escapeHtml(brandFreeTag)}</span></span>
        </div>
        ${providers}
      </li>`;
    }).join('');
  }

  /**
   * Builds the anchoring card for the report. Returns '' when the snapshot has no
   * anchoring, so older audits render exactly as before.
   */
  function renderAnchoringCard(data, lang, state) {
    if (!data?.audit_id) return '';
    const snapshot = state?.snapshot ?? data?.evidence_map ?? null;
    const view = describeAnchoring(snapshot);
    if (!view) return '';

    const language = lang === 'zh' ? 'zh' : 'en';
    const copy = ANCHORING_COPY[language];
    const brandFreeRungs = view.rungs.filter(rung => rung.brandFree);
    const observedRung = view.vaguestBrandFreeRung == null
      ? null
      : brandFreeRungs.find(rung => rung.rung === view.vaguestBrandFreeRung) ?? null;
    const headline = observedRung
      ? `<div class="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <div class="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">${escapeHtml(copy.observed)}</div>
          <div class="mt-0.5 text-xs text-emerald-900"><span class="font-mono">L${escapeHtml(observedRung.rung)}</span> · ${escapeHtml(observedRung.query)}</div>
        </div>`
      : `<div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div class="text-xs font-medium text-slate-700">${escapeHtml(brandFreeRungs.length ? copy.notObserved : copy.noProbe)}</div>
          ${brandFreeRungs.length ? `<p class="mt-1 text-[11px] text-slate-500 leading-relaxed">${escapeHtml(copy.notObservedHint)}</p>` : ''}
        </div>`;
    const nextProbe = view.nextProbe
      ? `<div class="mt-3 flex items-start justify-between gap-3 rounded-lg border border-dashed border-slate-200 px-3 py-2">
          <div class="min-w-0"><div class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">${escapeHtml(copy.nextProbe)}</div><div class="text-xs text-slate-500 break-words"><span class="font-mono text-[10px]">L${escapeHtml(view.nextProbe.rung)}</span> · ${escapeHtml(view.nextProbe.query)}</div></div>
          <span class="shrink-0 text-[10px] text-slate-400">${escapeHtml(copy.notRun)}</span>
        </div>`
      : '';
    const limitations = view.limitations.length
      ? `<div class="mt-3"><div class="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">${escapeHtml(copy.limitations)}</div><ul class="list-disc pl-4 space-y-1 text-[11px] text-slate-500">${view.limitations.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`
      : '';

    return `<section id="anchoring-section" class="bg-white rounded-xl border border-teal-200 p-4 fade-in" data-category="all">
      <div class="flex items-center gap-2 flex-wrap"><h2 class="font-bold text-sm text-slate-900">${escapeHtml(copy.title)}</h2><span class="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-700">${escapeHtml(snapshot?.observed_at ?? '')}</span></div>
      <p class="text-xs text-slate-500 mt-1 leading-relaxed">${escapeHtml(copy.body)}</p>
      <p class="text-[11px] font-medium text-teal-700 mt-1">${escapeHtml(copy.zeroWeight)}</p>
      <div class="mt-3">${headline}</div>
      <ul class="mt-3" data-anchoring-rungs>${anchoringRows(view, language, copy)}</ul>
      ${nextProbe}${limitations}
    </section>`;
  }

  function create(options) {
    const {
      apiBase,
      fetchJson,
      auxiliaryError,
      uiText,
      setCustomApiStatus,
      overwriteCustomApiConfig,
      claimPendingCustomApiConfig,
      getAuditId,
      getAuditData,
      setAuditData,
      rerender,
      onStateChange,
    } = options || {};

    if (!apiBase || typeof fetchJson !== 'function' || typeof getAuditId !== 'function') {
      throw new Error('GeoScore Evidence Map controller requires API and audit dependencies');
    }

    let state = { ...EMPTY_STATE };

    function getState() {
      return state;
    }

    /** Lets the host mount or drop the anchoring card whenever this state changes. */
    function notifyStateChange() {
      onStateChange?.(state);
    }

    function reset() {
      state = { ...EMPTY_STATE };
      notifyStateChange();
    }

    function hydrate(snapshot) {
      if (snapshot == null) return;
      state = { ...state, snapshot: sanitizeSnapshot(snapshot) };
      notifyStateChange();
    }

    async function run(runOptions = {}) {
      const requestedAuditId = runOptions.auditId || getAuditId();
      let customApiConfig = runOptions.customApiConfig || null;
      const usesCustomApi = Boolean(customApiConfig);
      const requestedApiModel = usesCustomApi ? String(customApiConfig.apiModel || '').trim() : '';
      if (!requestedAuditId || state.busy) {
        overwriteCustomApiConfig?.(customApiConfig);
        return false;
      }

      state = { ...state, busy: true, error: null };
      rerender?.();
      try {
        const endpoint = `${apiBase}/api/audits/${encodeURIComponent(requestedAuditId)}/evidence-map`;
        let requestPromise;
        if (customApiConfig) {
          let request = new Request(endpoint, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'X-API-Key': customApiConfig.apiKey,
            },
            body: JSON.stringify({
              api_base_url: customApiConfig.apiBaseUrl,
              api_model: customApiConfig.apiModel,
            }),
            referrerPolicy: 'no-referrer',
          });
          requestPromise = fetchJson(request);
          request = null;
          overwriteCustomApiConfig?.(customApiConfig);
          customApiConfig = null;
          setCustomApiStatus?.(uiText?.('customApi.sent') ?? '');
        } else {
          requestPromise = fetchJson(endpoint, {
            method: 'POST',
            headers: { Accept: 'application/json' },
          });
        }

        const payload = await requestPromise;
        if (getAuditId() !== requestedAuditId) return false;
        const snapshot = sanitizeSnapshot(payload.data ?? null);
        if (requestedApiModel && snapshot?.answer && typeof snapshot.answer === 'object') {
          snapshot.answer.model = requestedApiModel;
        }
        if (requestedApiModel && Array.isArray(snapshot?.answer_snapshot?.observations)) {
          snapshot.answer_snapshot.observations = snapshot.answer_snapshot.observations.map(observation => ({
            ...observation,
            model: requestedApiModel,
          }));
        }
        state = { snapshot, busy: false, error: null };
        const auditData = getAuditData?.();
        if (auditData) setAuditData?.({ ...auditData, evidence_map: snapshot });
        if (usesCustomApi) setCustomApiStatus?.(uiText?.('customApi.complete') ?? '');
      } catch (error) {
        if (getAuditId() === requestedAuditId) {
          state = {
            ...state,
            busy: false,
            error: usesCustomApi
              ? { code: 'CUSTOM_API_EVIDENCE_FAILED', message: uiText?.('customApi.error.evidence') ?? 'Custom API evidence failed' }
              : auxiliaryError?.(error) ?? { code: 'REQUEST_FAILED', message: String(error?.message || error) },
          };
          if (usesCustomApi) setCustomApiStatus?.(uiText?.('customApi.error.evidence') ?? '', true);
        }
      } finally {
        overwriteCustomApiConfig?.(customApiConfig);
      }

      if (getAuditId() === requestedAuditId) {
        rerender?.();
        notifyStateChange();
      }
      return state.error == null;
    }

    function runPending(data, runId) {
      const config = claimPendingCustomApiConfig?.(runId);
      if (!config) return false;
      const auditId = data?.audit_id || getAuditId();
      if (!auditId) {
        overwriteCustomApiConfig?.(config);
        return false;
      }
      void run({ auditId, customApiConfig: config });
      return true;
    }

    function handleClick(event) {
      if (!event?.target?.closest?.('[data-action="run-evidence-map"]')) return false;
      void run();
      return true;
    }

    return Object.freeze({
      getState,
      reset,
      hydrate,
      run,
      runPending,
      handleClick,
      renderAnchoringCard: (data, lang) => renderAnchoringCard(data, lang, state),
    });
  }

  global.GeoScoreEvidenceMap = Object.freeze({ create, sanitizeSnapshot, describeAnchoring, renderAnchoringCard, escapeHtml });
})(typeof window !== 'undefined' ? window : globalThis);
