(function (global) {
  'use strict';

  function normalizeDomain(value) {
    const domain = String(value || '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .split(/[/?#]/)[0]
      .toLowerCase();
    return domain && domain.includes('.') ? domain : '';
  }

  function abbrevDomain(domain, maxLength = 15) {
    if (domain.length <= maxLength) return domain;
    const leftLength = Math.floor((maxLength - 1) / 2);
    return `${domain.slice(0, leftLength)}…${domain.slice(-(maxLength - leftLength - 1))}`;
  }

  function create(options) {
    const {
      apiBase,
      reportUi,
      getCurrentDomain,
      language = 'en',
      escapeHtml,
      fetch: fetchRef = global.fetch,
      document: documentRef = global.document,
    } = options || {};
    if (!apiBase || !reportUi || typeof getCurrentDomain !== 'function' ||
        typeof escapeHtml !== 'function' || typeof fetchRef !== 'function') {
      throw new Error('GeoScore competitor controller requires API, report, domain, and fetch dependencies');
    }

    const zh = language === 'zh';

    function elements() {
      return {
        input: documentRef?.getElementById('competitor-input'),
        results: documentRef?.getElementById('competitor-results'),
        button: documentRef?.getElementById('competitor-btn'),
      };
    }

    async function compare() {
      const { input, results, button } = elements();
      const currentDomain = getCurrentDomain();
      if (!input || !results || !button || !currentDomain) return false;

      const competitor = normalizeDomain(input.value);
      if (!competitor) {
        input.classList.add('border-orange-300', 'ring-1', 'ring-orange-300');
        input.focus();
        return false;
      }
      input.classList.remove('border-orange-300', 'ring-1', 'ring-orange-300');

      button.disabled = true;
      button.textContent = zh ? '比较中…' : 'Comparing…';
      results.classList.remove('hidden');
      results.innerHTML = `
        <div class="flex items-center gap-2 text-xs text-slate-400 py-2">
          <svg class="spinner w-4 h-4 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
          </svg>
          ${zh ? '正在运行比较审计，通常需要 10 至 20 秒…' : 'Running comparison audit — typically 10–20s…'}
        </div>`;

      try {
        const response = await fetchRef(`${apiBase}/api/compare?domains=${encodeURIComponent(currentDomain)},${encodeURIComponent(competitor)}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const mine = reportUi.normalizeScoreSummary(data[currentDomain] ?? {});
        const theirs = reportUi.normalizeScoreSummary(data[competitor] ?? {});
        const scores = [mine.overall, mine.seo, mine.geo, theirs.overall, theirs.seo, theirs.geo];
        if (!reportUi.sameScoreVersion(mine, theirs) || !scores.every(Number.isFinite)) {
          results.innerHTML = `<div class="text-xs text-slate-600 border border-slate-200 bg-slate-50 rounded-xl p-3"><strong>${zh ? '暂不可比较' : 'Not comparable yet'}</strong><div class="mt-1 text-slate-500">${zh ? '两个站点需要相同评分版本且都有充分证据。' : 'Both sites need the same score version and sufficient evidence.'}</div></div>`;
          return false;
        }

        const score = value => Math.round(value);
        const scoreColor = value => value >= 70 ? 'text-green-700' : value >= 50 ? 'text-yellow-600' : 'text-orange-600';
        const barColor = value => value >= 70 ? 'bg-green-500' : value >= 50 ? 'bg-yellow-400' : 'bg-orange-400';
        const bar = value => `<div class="w-full bg-slate-100 rounded-full h-1.5 mt-1"><div class="${barColor(value)} h-1.5 rounded-full transition-all" style="width:${value}%"></div></div>`;
        const row = (icon, label, mineValue, theirValue) => {
          const delta = mineValue - theirValue;
          return `<div class="grid grid-cols-[1fr_80px_80px_60px] gap-2 items-center py-2.5 border-b border-slate-100 last:border-0">
            <div class="text-xs font-medium text-slate-600">${icon} ${label}</div>
            <div class="text-center"><div class="text-base font-bold ${scoreColor(mineValue)}">${mineValue}</div>${bar(mineValue)}</div>
            <div class="text-center"><div class="text-base font-bold ${scoreColor(theirValue)}">${theirValue}</div>${bar(theirValue)}</div>
            <div class="text-center"><span class="text-xs font-bold px-2 py-0.5 rounded-full ${delta >= 0 ? 'text-green-700 bg-green-50' : 'text-orange-600 bg-orange-50'}">${delta >= 0 ? '▲' : '▼'} ${delta > 0 ? '+' : ''}${delta}</span></div>
          </div>`;
        };

        const [overall, seo, geo, theirOverall, theirSeo, theirGeo] = scores.map(score);
        const delta = overall - theirOverall;
        const insight = delta <= -15
          ? `<div class="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs"><div class="font-semibold text-amber-700 mb-1">⚠ ${escapeHtml(competitor)} ${zh ? '明显领先' : 'is significantly ahead'}</div><div class="text-amber-600">${geo < theirGeo - 10 ? (zh ? `最大差距在 GEO 就绪度，为 ${theirGeo - geo} 分` : `The biggest gap is GEO readiness at ${theirGeo - geo} points.`) : (zh ? '请先处理上方影响最大的修复项。' : 'Focus on the highest-impact repairs above.')}</div></div>`
          : delta >= 15
            ? `<div class="mt-3 p-3 bg-green-50 border border-green-200 rounded-xl text-xs"><div class="font-semibold text-green-700 mb-1">✓ ${zh ? `你领先 ${escapeHtml(competitor)} ${delta} 分` : `You're leading ${escapeHtml(competitor)} by ${delta} points`}</div></div>`
            : `<div class="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs"><div class="font-semibold text-blue-700 mb-1">📊 ${zh ? `你与 ${escapeHtml(competitor)} 分数接近` : `Neck and neck with ${escapeHtml(competitor)}`}</div></div>`;
        const shareText = `GeoScore comparison: ${currentDomain} ${overall}/100 vs ${competitor} ${theirOverall}/100\nSEO: ${seo} vs ${theirSeo}\nGEO: ${geo} vs ${theirGeo}\nhttps://geo.sayori.org`;

        results.innerHTML = `<div class="border border-slate-200 rounded-xl overflow-hidden bg-white">
          <div class="grid grid-cols-[1fr_80px_80px_60px] gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
            <div>${zh ? '指标' : 'Metric'}</div>
            <div class="text-center truncate" title="${escapeHtml(currentDomain)}">${escapeHtml(abbrevDomain(currentDomain))}</div>
            <div class="text-center truncate" title="${escapeHtml(competitor)}">${escapeHtml(abbrevDomain(competitor))}</div>
            <div class="text-center">Δ</div>
          </div>
          <div class="px-4">${row('🏆', zh ? '总分' : 'Overall', overall, theirOverall)}${row('🔍', 'SEO', seo, theirSeo)}${row('🤖', 'GEO', geo, theirGeo)}</div>
        </div>${insight}
        <button data-copy="${escapeHtml(shareText)}" class="mt-3 w-full text-xs bg-slate-900 hover:bg-slate-700 text-white py-2.5 rounded-lg font-semibold transition-colors">📋 ${zh ? '复制比较结果' : 'Copy comparison'}</button>`;
        return true;
      } catch (error) {
        results.innerHTML = `<div class="text-xs text-orange-500 py-1">${zh ? '比较失败，请稍后重试' : `Comparison failed — ${escapeHtml(error?.message || 'please try again')}.`}</div>`;
        return false;
      } finally {
        button.disabled = false;
        button.textContent = zh ? '比较 →' : 'Compare →';
      }
    }

    function bindInput() {
      const { input } = elements();
      if (!input || input.dataset.competitorBound === 'true') return false;
      input.dataset.competitorBound = 'true';
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') void compare();
      });
      return true;
    }

    function handleClick(event) {
      if (!event?.target?.closest?.('[data-action="compare"]')) return false;
      void compare();
      return true;
    }

    return Object.freeze({ bindInput, compare, handleClick });
  }

  global.GeoScoreCompetitor = Object.freeze({ abbrevDomain, create, normalizeDomain });
})(typeof window !== 'undefined' ? window : globalThis);
