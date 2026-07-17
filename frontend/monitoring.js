(function (global) {
  'use strict';

  const EMPTY_STATE = Object.freeze({
    project: null,
    managementToken: '',
    showToken: false,
    tokenSaved: false,
    runs: [],
    modelOptions: [],
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
      localStorage: localStorageRef = global.localStorage,
      setTimeout: setTimeoutRef = global.setTimeout,
      FormData: FormDataRef = global.FormData,
      normalizeBaseUrl = global.GeoScoreCustomApi?.normalizeBaseUrl,
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

    function tokenStorageKey(projectId) {
      return `geoscore:monitor-token:${String(projectId || '').trim()}`;
    }

    function savedToken(projectId) {
      if (!projectId || !localStorageRef?.getItem) return '';
      try { return String(localStorageRef.getItem(tokenStorageKey(projectId)) || '').trim(); }
      catch { return ''; }
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

    function rerenderWithByokValues(values) {
      rerender?.();
      const form = documentRef?.querySelector?.('[data-monitor-form="byok"]');
      if (!form) return;
      const entries = [
        ['input[name="api_key"]', values.apiKey],
        ['input[name="api_base_url"]', values.apiBaseUrl],
        ['input[name="api_model"]', values.apiModel],
      ];
      for (const [selector, value] of entries) {
        const input = form.querySelector?.(selector);
        if (input) input.value = value;
      }
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

    async function connectProject(form) {
      if (state.busy) return false;
      const formData = new FormDataRef(form);
      const projectId = String(formData.get('project_id') || '').trim();
      const suppliedToken = String(formData.get('management_token') || '').trim();
      const managementToken = suppliedToken || savedToken(projectId);
      if (!projectId || !managementToken) {
        state = { ...state, error: { message: languageMessage('请输入项目 ID 和管理 Token。', 'Enter the project ID and management token.') } };
        rerender?.();
        return false;
      }
      state = { ...state, busy: true, error: null, message: '' };
      rerender?.();
      try {
        const payload = await fetchJson(`${apiBase}/api/monitor-projects/${encodeURIComponent(projectId)}`, {
          headers: { Accept: 'application/json', 'X-Project-Token': managementToken },
        });
        state = {
          ...state,
          project: payload.project,
          managementToken,
          showToken: false,
          tokenSaved: savedToken(projectId) === managementToken,
          runs: [],
          busy: false,
          error: null,
          message: languageMessage('已连接监控项目。', 'Monitoring project connected.'),
        };
        await loadHistory();
      } catch (error) {
        state = { ...EMPTY_STATE, error: auxiliaryError?.(error, managementToken) ?? { message: String(error?.message || error) } };
      }
      rerender?.();
      return state.error == null;
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
          tokenSaved: false,
          runs: [],
          modelOptions: [],
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

    async function run({ apiKey = '', apiBaseUrl = '', apiModel = '' } = {}) {
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
          body: apiKey
            ? JSON.stringify({ api_base_url: apiBaseUrl, api_model: apiModel })
            : '{}',
        });
        state = { ...state, busy: false, message: languageMessage('监控快照已完成。', 'Monitoring snapshot completed.') };
        await loadHistory();
      } catch (error) {
        state = { ...state, busy: false, error: auxiliaryError?.(error, apiKey) ?? { message: String(error?.message || error) } };
      }
      rerender?.();
      return state.error == null;
    }

    async function fetchModels(form) {
      if (!form || state.busy) return false;
      const apiKey = String(form.querySelector('input[name="api_key"]')?.value || '').trim();
      const rawBaseUrl = String(form.querySelector('input[name="api_base_url"]')?.value || '').trim();
      const apiModel = String(form.querySelector('input[name="api_model"]')?.value || '').trim().slice(0, 160);
      const apiBaseUrl = typeof normalizeBaseUrl === 'function' ? normalizeBaseUrl(rawBaseUrl) : null;
      if (!apiKey || !apiBaseUrl) {
        state = { ...state, error: { message: languageMessage('请输入 API Key 和有效的 HTTPS Base URL。', 'Enter an API key and a valid HTTPS base URL.') } };
        rerender?.();
        return false;
      }
      state = { ...state, busy: true, error: null, message: '' };
      const requestValues = { apiKey, apiBaseUrl: rawBaseUrl, apiModel };
      rerenderWithByokValues(requestValues);
      try {
        const payload = await fetchJson(`${apiBase}/api/answer-models`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-API-Key': apiKey },
          body: JSON.stringify({ api_base_url: apiBaseUrl }),
          referrerPolicy: 'no-referrer',
        });
        const models = Array.isArray(payload.models) ? payload.models : [];
        state = {
          ...state,
          modelOptions: models.slice(0, 50).map(String),
          busy: false,
          message: languageMessage(`已加载 ${models.length} 个模型。`, `${models.length} models loaded.`),
        };
      } catch (error) {
        state = { ...state, modelOptions: [], busy: false, error: auxiliaryError?.(error, apiKey) ?? { message: String(error?.message || error) } };
      }
      rerenderWithByokValues(requestValues);
      return state.error == null;
    }

    function saveTokenToDevice() {
      const projectId = state.project?.id;
      if (!projectId || !state.managementToken || !localStorageRef?.setItem) return false;
      try {
        localStorageRef.setItem(tokenStorageKey(projectId), state.managementToken);
        state = { ...state, tokenSaved: true, message: languageMessage('管理 Token 已保存到本设备。', 'Management token saved on this device.') };
        rerender?.();
        return true;
      } catch {
        return false;
      }
    }

    function forgetTokenFromDevice() {
      const projectId = state.project?.id;
      if (!projectId || !localStorageRef?.removeItem) return false;
      try {
        localStorageRef.removeItem(tokenStorageKey(projectId));
        state = { ...state, tokenSaved: false, message: languageMessage('本设备已忘记管理 Token。', 'This device forgot the management token.') };
        rerender?.();
        return true;
      } catch {
        return false;
      }
    }

    async function rotateToken() {
      const url = projectUrl('token/rotate');
      if (!url || state.busy) return false;
      state = { ...state, busy: true, error: null, message: '' };
      rerender?.();
      try {
        const payload = await fetchJson(url, { method: 'POST', headers: headers() });
        forgetTokenFromDevice();
        state = {
          ...state,
          managementToken: String(payload.management_token || ''),
          showToken: payload.token_shown_once === true,
          tokenSaved: false,
          busy: false,
          error: null,
          message: languageMessage('Token 已轮换，旧 Token 已立即失效。', 'Token rotated. The old token is invalid now.'),
        };
      } catch (error) {
        state = { ...state, busy: false, error: auxiliaryError?.(error, state.managementToken) ?? { message: String(error?.message || error) } };
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
      } else if (form.dataset.monitorForm === 'connect') {
        void connectProject(form);
      } else if (form.dataset.monitorForm === 'queries') {
        void updateQueries(form);
      } else if (form.dataset.monitorForm === 'byok') {
        const apiKeyInput = form.querySelector('input[name="api_key"]');
        const apiBaseInput = form.querySelector('input[name="api_base_url"]');
        const apiModelInput = form.querySelector('input[name="api_model"]');
        const apiKey = String(apiKeyInput?.value || '').trim();
        const apiBaseUrl = typeof normalizeBaseUrl === 'function'
          ? normalizeBaseUrl(apiBaseInput?.value)
          : null;
        const apiModel = String(apiModelInput?.value || '').trim().slice(0, 160);
        if (apiKeyInput) apiKeyInput.value = '';
        if (apiBaseInput) apiBaseInput.value = '';
        if (apiModelInput) apiModelInput.value = '';
        if (!apiKey || !apiBaseUrl || !apiModel) {
          state = { ...state, error: { message: languageMessage('API Key、Base URL 和 model 必须同时填写。', 'API key, base URL, and model are all required.') } };
          rerender?.();
        } else {
          void run({ apiKey, apiBaseUrl, apiModel });
        }
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
      if (target.closest('[data-action="save-monitor-token"]')) {
        saveTokenToDevice();
        return true;
      }
      if (target.closest('[data-action="forget-monitor-token"]')) {
        forgetTokenFromDevice();
        return true;
      }
      if (target.closest('[data-action="rotate-monitor-token"]')) {
        void rotateToken();
        return true;
      }
      const fetchModelsButton = target.closest('[data-action="fetch-monitor-models"]');
      if (fetchModelsButton) {
        void fetchModels(fetchModelsButton.closest('form'));
        return true;
      }
      return false;
    }

    return Object.freeze({
      getState,
      reset,
      verifyEmailFromUrl,
      loadHistory,
      connectProject,
      createProject,
      updateQueries,
      run,
      fetchModels,
      saveTokenToDevice,
      forgetTokenFromDevice,
      rotateToken,
      handleSubmit,
      handleClick,
    });
  }

  global.GeoScoreMonitoring = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
