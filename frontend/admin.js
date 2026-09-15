(function (global) {
  'use strict';

  const PRODUCTION_API = 'https://geo-api.sayori.org';
  const LOCAL_API = 'http://127.0.0.1:8787';
  /** @type {any} */
  const location = global.location;
  const API = global.GeoScoreAdmin?.api || (
    location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(location.hostname)
      ? LOCAL_API
      : PRODUCTION_API
  );
  const $ = id => global.document.getElementById(id);
  const field = id => /** @type {HTMLInputElement | HTMLSelectElement | null} */ ($(id));

  function show(id, visible) {
    $(id)?.classList.toggle('hidden', !visible);
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(number(value) * 1000);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
  }

  function showError(id, message) {
    const element = $(id);
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('hidden', !message);
  }

  function loginErrorMessage(code) {
    return ({
      forbidden: '当前 GitHub 账号不在站长 allowlist 中。',
      oauth_failed: 'GitHub 登录失败，请重试。',
      invalid_state: '登录状态已过期，请重新开始。',
      oauth_not_configured: 'GitHub OAuth 尚未配置。',
    })[code] || '';
  }

  function setupLogin(session) {
    show('admin-login', true);
    show('admin-setup', !session?.github_oauth);
    show('admin-dashboard', false);
    show('admin-logout', false);
    const link = $('admin-login-link');
    if (link) {
      const next = `${location.origin || PRODUCTION_API}${location.pathname || '/admin.html'}`;
      link.setAttribute('href', `${API}/api/admin/github/login?next=${encodeURIComponent(next)}`);
      link.classList.toggle('hidden', !session?.github_oauth);
    }
    const code = new URLSearchParams(location.search).get('error');
    showError('admin-login-error', loginErrorMessage(code));
  }

  function renderRecent(rows) {
    const body = $('recent-audits');
    if (!body) return;
    body.replaceChildren();
    if (!Array.isArray(rows) || !rows.length) {
      const row = global.document.createElement('tr');
      const cell = global.document.createElement('td');
      cell.colSpan = 5;
      cell.className = 'px-2 py-6 text-center text-slate-400';
      cell.textContent = '暂无记录';
      row.append(cell);
      body.append(row);
      return;
    }
    for (const item of rows) {
      const row = global.document.createElement('tr');
      row.className = 'border-b border-slate-50 last:border-0';
      const values = [
        item?.domain || '—',
        item?.status || '—',
        item?.seo_score ?? '—',
        item?.geo_score ?? '—',
        formatDate(item?.completed_at || item?.created_at),
      ];
      for (const value of values) {
        const cell = global.document.createElement('td');
        cell.className = 'px-2 py-2 text-slate-700';
        cell.textContent = String(value);
        row.append(cell);
      }
      body.append(row);
    }
  }

  function renderOverview(data, login) {
    const totals = data?.totals || {};
    const statuses = totals.audits_by_status || {};
    const browser = data?.quotas?.browser_run || {};
    const publicAudit = data?.quotas?.public_audit || {};
    const used = number(browser.used_seconds);
    const budget = number(browser.budget_seconds);
    const remaining = number(browser.remaining_seconds);
    const percent = budget ? Math.min(100, Math.max(0, used / budget * 100)) : 0;
    $('metric-sites').textContent = String(number(totals.unique_sites));
    $('metric-complete').textContent = String(number(statuses.complete));
    $('metric-today').textContent = String(number(data?.today?.audits));
    $('metric-monitors').textContent = String(number(data?.monitor_projects));
    $('admin-welcome').textContent = login ? `已登录：${login}` : '';
    $('browser-budget-label').textContent = `${remaining}s 剩余 / ${budget}s`;
    $('browser-budget-bar').style.width = `${percent}%`;
    $('public-audit-label').textContent = `公开审查：每小时 ${number(publicAudit.limit_per_hour)} 次；今日已记录 ${number(publicAudit.today_audits)} 次。`;
    $('week-label').textContent = `本周 ${number(data?.this_week?.audits)} 次`;
    renderRecent(data?.recent_audits);
  }

  function adminPageUrl() {
    return (location.origin || PRODUCTION_API) + (location.pathname || '/admin.html');
  }

  function gscConnectUrl() {
    return API + '/api/admin/gsc/connect?next=' + encodeURIComponent(adminPageUrl());
  }

  function formatDecimal(value, digits) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toFixed(digits) : '—';
  }

  function renderGscRows(id, rows, key) {
    const body = $(id);
    if (!body) return;
    body.replaceChildren();
    if (!Array.isArray(rows) || !rows.length) {
      const row = global.document.createElement('tr');
      const cell = global.document.createElement('td');
      cell.colSpan = 4;
      cell.className = 'py-3 text-center text-slate-400';
      cell.textContent = '暂无数据';
      row.append(cell);
      body.append(row);
      return;
    }
    for (const item of rows) {
      const row = global.document.createElement('tr');
      row.className = 'border-b border-slate-50 last:border-0';
      const values = [
        item?.[key] || '—',
        number(item?.clicks),
        number(item?.impressions),
        formatDecimal(item?.position, 1),
      ];
      for (const value of values) {
        const cell = global.document.createElement('td');
        cell.className = 'max-w-[260px] truncate py-2 pr-2 text-slate-700';
        cell.textContent = String(value);
        cell.title = String(value);
        row.append(cell);
      }
      body.append(row);
    }
  }

  async function loadGscPerformance() {
    const property = field('gsc-property')?.value || '';
    if (!property) return;
    showError('gsc-error', '');
    const result = await fetchJson(API + '/api/admin/gsc/performance?days=28&site_url=' + encodeURIComponent(property));
    if (!result.response.ok) {
      showError('gsc-error', result.body?.message || '无法读取 Search Console 数据。');
      return;
    }
    const totals = result.body?.totals || {};
    $('gsc-clicks').textContent = String(number(totals.clicks));
    $('gsc-impressions').textContent = String(number(totals.impressions));
    $('gsc-ctr').textContent = formatDecimal(number(totals.ctr) * 100, 1) + '%';
    $('gsc-position').textContent = formatDecimal(totals.position, 1);
    $('gsc-range').textContent = (result.body?.start_date || '—') + ' 至 ' + (result.body?.end_date || '—') + '；Search Analytics 只保证返回顶部数据。';
    renderGscRows('gsc-query-rows', result.body?.top_queries, 'query');
    renderGscRows('gsc-page-rows', result.body?.top_pages, 'page');
  }

  async function loadGsc() {
    const statusResult = await fetchJson(API + '/api/admin/gsc/status');
    if (!statusResult.response.ok) {
      showError('gsc-error', statusResult.body?.message || '无法读取 GSC 连接状态。');
      return;
    }
    const status = statusResult.body || {};
    const statusLabel = $('gsc-status');
    const connectUrl = gscConnectUrl();
    if ($('gsc-callback-url')) $('gsc-callback-url').textContent = status.callback_url || '';
    $('gsc-connect-link')?.setAttribute('href', connectUrl);
    $('gsc-reconnect-link')?.setAttribute('href', connectUrl);
    const storageReady = status.storage_ready !== false;
    show('gsc-migration-needed', !storageReady);
    show('gsc-unconfigured', !status.configured);
    show('gsc-connect', Boolean(storageReady && status.configured && !status.connected));
    show('gsc-connected', Boolean(storageReady && status.connected));
    if (statusLabel) {
      statusLabel.textContent = !storageReady ? '需迁移' : !status.configured ? '待配置' : status.connected ? '已连接' : '未连接';
    }

    const query = new URLSearchParams(location.search);
    if (query.get('gsc_error')) {
      showError('gsc-error', 'Google 授权失败：' + query.get('gsc_error'));
    } else if (query.get('gsc') === 'connected') {
      showError('gsc-error', '');
    }
    if (!storageReady || !status.connected) return;

    const propertiesResult = await fetchJson(API + '/api/admin/gsc/properties');
    if (!propertiesResult.response.ok) {
      showError('gsc-error', propertiesResult.body?.message || '无法读取 Search Console 站点资源。');
      return;
    }
    const properties = Array.isArray(propertiesResult.body?.properties) ? propertiesResult.body.properties : [];
    const select = field('gsc-property');
    if (!select) return;
    select.replaceChildren();
    for (const property of properties) {
      const option = global.document.createElement('option');
      option.value = property.site_url;
      option.textContent = property.site_url + ' · ' + property.permission_level;
      select.append(option);
    }
    const preferred = properties.find(property => String(property.site_url).includes('geo.sayori.org')) || properties[0];
    if (!preferred) {
      showError('gsc-error', '此 Google 账号没有可读取的 Search Console 站点资源。');
      return;
    }
    select.value = preferred.site_url;
    const inspectionInput = field('gsc-inspection-url');
    if (inspectionInput && !inspectionInput.value) {
      inspectionInput.value = preferred.site_url.startsWith('sc-domain:')
        ? 'https://' + preferred.site_url.slice('sc-domain:'.length) + '/'
        : preferred.site_url;
    }
    await loadGscPerformance();
  }

  async function inspectGscUrl(event) {
    event.preventDefault();
    const property = field('gsc-property')?.value || '';
    const inspectionUrl = field('gsc-inspection-url')?.value?.trim() || '';
    if (!property || !inspectionUrl) return;
    showError('gsc-error', '');
    const result = await fetchJson(API + '/api/admin/gsc/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_url: property, inspection_url: inspectionUrl }),
    });
    if (!result.response.ok) {
      showError('gsc-error', result.body?.message || 'URL 检查失败。');
      return;
    }
    const index = result.body?.index || {};
    const output = $('gsc-inspection-result');
    if (!output) return;
    output.textContent = [
      'Verdict: ' + (index.verdict || '—'),
      'Coverage: ' + (index.coverage_state || '—'),
      'Fetch: ' + (index.page_fetch_state || '—'),
      'Indexing: ' + (index.indexing_state || '—'),
      'Last crawl: ' + (index.last_crawl_time || '—'),
      'User canonical: ' + (index.user_canonical || '—'),
      'Google canonical: ' + (index.google_canonical || '—'),
      '',
      result.body?.limitation || '',
    ].join('\n');
    show('gsc-inspection-result', true);
  }

  async function fetchJson(url, options) {
    const response = await global.fetch(url, { credentials: 'include', ...(options || {}) });
    let body = null;
    try { body = await response.json(); } catch { /* empty response */ }
    return { response, body };
  }

  async function load() {
    try {
      const sessionResult = await fetchJson(`${API}/api/admin/session`);
      const session = sessionResult.body || { github_oauth: false };
      global.GeoScoreAdmin = global.GeoScoreAdmin || {};
      global.GeoScoreAdmin.session = session;
      if (!session.authenticated) {
        setupLogin(session);
        return;
      }
      show('admin-login', false);
      show('admin-setup', false);
      show('admin-dashboard', true);
      show('admin-logout', true);
      const overviewResult = await fetchJson(`${API}/api/admin/overview`);
      if (overviewResult.response.status === 401) {
        setupLogin(session);
        return;
      }
      if (!overviewResult.response.ok) throw new Error('overview failed');
      renderOverview(overviewResult.body, session.login);
      await loadGsc();
      showError('admin-dashboard-error', '');
    } catch {
      showError('admin-dashboard-error', '无法加载控制台数据。');
    }
  }

  $('admin-logout')?.addEventListener('click', async () => {
    try { await fetchJson(`${API}/api/admin/logout`, { method: 'POST' }); } finally { global.location.reload(); }
  });

  $('gsc-load')?.addEventListener('click', loadGscPerformance);
  $('gsc-property')?.addEventListener('change', loadGscPerformance);
  $('gsc-inspect-form')?.addEventListener('submit', inspectGscUrl);

  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', load, { once: true });
  else void load();
})(window);
