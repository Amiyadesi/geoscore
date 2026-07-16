(function (global) {
  'use strict';

  const EMPTY_STATE = Object.freeze({
    project: null,
    managementToken: '',
    showToken: false,
    runs: [],
    busy: false,
    error: null,
    message: '',
  });

  function create(options) {
    const {
      apiBase,
      fetchJson,
      auxiliaryError,
      uiText,
      getReportLanguage,
      getAuditId,
      getAuditData,
      setAuditData,
      rerender,
      document: documentRef = global.document,
      location: locationRef = global.location,
      history: historyRef = global.history,
      navigator: navigatorRef = global.navigator,
      setTimeout: setTimeoutRef = global.setTimeout,
      FormData: FormDataRef = global.FormData,
    } = options || {};

    if (!apiBase || typeof fetchJson !== 'function' || typeof getAuditId !== 'function') {
      throw new Error('GeoScore monitoring controller requires API and audit dependencies');
    }

    let state = { ...EMPTY_STATE };

    function getState() {
      return state;
    }

    function reset() {
      state = { ...EMPTY_STATE };
    }

    function projectUrl(action = '') {
      const id = state.project?.id;
      if (!id) return null;
      return `${apiBase}/api/monitor-projects/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;
    }

    function headers(extra = {}) {
      return {
        Accept: 'application/json',
        'X-Project-Token': state.managementToken,
        ...extra,
      };
    }

    function languageMessage(zh, en) {
      return getReportLanguage?.() === 'zh' ? zh : en;
    }

    function showVerificationNotice(message, failed = false) {
      if (!documentRef?.body) return;
      const notice = documentRef.createElement('div');
      notice.id = 'monitor-verification-notice';
      notice.setAttribute('role', failed ? 'alert' : 'status');
      notice.className = `fixed left-4 right-4 top-4 z-[100] mx-auto max-w-xl rounded-xl border px-4 py-3 text-sm shadow-lg ${failed ? 'border-orange-200 bg-orange-50 text-orange-800' : 'border-green-200 bg-green-50 text-green-800'}`;
      notice.textContent = message;
      documentRef.getElementById(notice.id)?.remove();
      documentRef.body.appendChild(notice);
      setTimeoutRef?.(() => notice.remove(), 8000);
    }

    async function verifyEmailFromUrl() {
      if (!locationRef?.href) return false;
      const url = new URL(locationRef.href);
      const projectId = url.searchParams.get('monitor_project') || '';
      const verificationToken = url.searchParams.get('verify') || '';
      if (!projectId || !verificationToken) return false;
      url.searchParams.delete('monitor_project');
      url.searchParams.delete('verify');
      historyRef?.replaceState?.({}, '', `${url.pathname}${url.search}${url.hash}`);
      try {
        await fetchJson(`${apiBase}/api/monitor-projects/${encodeURIComponent(projectId)}/email/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ token: verificationToken }),
        });
        showVerificationNotice(uiText?.('audit.monitor.emailVerified') ?? 'Email verified');
      } catch (error) {
        const detail = auxiliaryError?.(error, verificationToken) ?? { message: String(error?.message || error) };
        showVerificationNotice(detail.message, true);
      }
      return true;
    }

    async function loadHistory() {
      const url = projectUrl('runs');
      if (!url || !state.managementToken) return false;
      const payload = await fetchJson(url, { headers: headers() });
      state = { ...state, runs: Array.isArray(payload.runs) ? payload.runs : [] };
      const auditData = getAuditData?.();
      if (auditData) setAuditData?.({ ...auditData, monitoring_history: state.runs });
      return true;
    }

    async function createProject(form) {
      const auditId = getAuditId();
      if (!auditId || state.busy) return false;
      const email = String(new FormDataRef(form).get('email') || '').trim();
      state = { ...state, busy: true, error: null, message: '' };
      rerender?.();
      try {
        const payload = await fetchJson(`${apiBase}/api/monitor-projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ audit_id: auditId, ...(email ? { email } : {}) }),
        });
        state = {
          project: payload.project,
          managementToken: payload.management_token || '',
          showToken: payload.token_shown_once === true,
          runs: [],
          busy: false,
          error: null,
          message: languageMessage('监控项目已创建。请立即保存管理 Token。', 'Monitoring project created. Save the management token now.'),
        };
        const auditData = getAuditData?.();
        if (auditData) setAuditData?.({ ...auditData, monitoring_project: payload.project });
      } catch (error) {
        state = { ...state, busy: false, error: auxiliaryError?.(error) ?? { message: String(error?.message || error) } };
      }
      rerender?.();
      return state.error == null;
    }

    async function updateQueries(form) {
      const url = projectUrl('queries');
      if (!url || state.busy) return false;
      const formData = new FormDataRef(form);
      const queryValues = formData.getAll('query').map(value => String(value).trim());
      const intentValues = formData.getAll('intent').map(String);
      const queries = queryValues.map((query, index) => ({ query, intent: intentValues[index] || 'informational' }));
      state = { ...state, busy: true, error: null, message: '' };
      rerender?.();
      try {
        const payload = await fetchJson(url, {
          method: 'PATCH',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ queries }),
        });
        state = {
          ...state,
          project: { ...state.project, queries: payload.queries ?? queries },
          busy: false,
          message: languageMessage('查询已保存，监控基线将在下次运行时重建。', 'Queries saved. The monitoring baseline will be rebuilt on the next run.'),
        };
      } catch (error) {
        state = { ...state, busy: false, error: auxiliaryError?.(error) ?? { message: String(error?.message || error) } };
      }
      rerender?.();
      return state.error == null;
    }

    async function run({ apiKey = '' } = {}) {
      const action = apiKey ? 'byok-runs' : 'runs';
      const url = projectUrl(action);
      if (!url || state.busy) return false;
      state = { ...state, busy: true, error: null, message: '' };
      rerender?.();
      try {
        await fetchJson(url, {
          method: 'POST',
          headers: headers({
            'Content-Type': 'application/json',
            ...(apiKey ? { 'X-API-Key': apiKey } : {}),
          }),
          body: '{}',
        });
        state = { ...state, busy: false, message: languageMessage('监控快照已完成。', 'Monitoring snapshot completed.') };
        await loadHistory();
      } catch (error) {
        state = { ...state, busy: false, error: auxiliaryError?.(error, apiKey) ?? { message: String(error?.message || error) } };
      }
      rerender?.();
      return state.error == null;
    }

    function handleSubmit(event) {
      const form = event?.target?.closest?.('[data-monitor-form]');
      if (!form) return false;
      event.preventDefault();
      if (form.dataset.monitorForm === 'create') {
        void createProject(form);
      } else if (form.dataset.monitorForm === 'queries') {
        void updateQueries(form);
      } else if (form.dataset.monitorForm === 'byok') {
        const input = form.querySelector('input[name="api_key"]');
        const apiKey = String(input?.value || '').trim();
        if (input) input.value = '';
        void run({ apiKey });
      }
      return true;
    }

    function handleClick(event) {
      const target = event?.target;
      if (!target?.closest) return false;
      if (target.closest('[data-action="run-monitor-default"]')) {
        void run();
        return true;
      }
      if (target.closest('[data-action="copy-monitor-token"]')) {
        const token = state.managementToken;
        if (token) void navigatorRef?.clipboard?.writeText?.(token);
        return true;
      }
      if (target.closest('[data-action="dismiss-monitor-token"]')) {
        state = { ...state, showToken: false };
        rerender?.();
        return true;
      }
      return false;
    }

    return Object.freeze({
      getState,
      reset,
      verifyEmailFromUrl,
      loadHistory,
      createProject,
      updateQueries,
      run,
      handleSubmit,
      handleClick,
    });
  }

  global.GeoScoreMonitoring = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
