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
      showError('admin-dashboard-error', '');
    } catch {
      showError('admin-dashboard-error', '无法加载控制台数据。');
    }
  }

  $('admin-logout')?.addEventListener('click', async () => {
    try { await fetchJson(`${API}/api/admin/logout`, { method: 'POST' }); } finally { global.location.reload(); }
  });

  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', load, { once: true });
  else void load();
})(window);
