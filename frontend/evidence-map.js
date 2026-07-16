(function (global) {
  'use strict';

  const EMPTY_STATE = Object.freeze({ snapshot: null, busy: false, error: null });

  function sanitizeSnapshot(value) {
    if (Array.isArray(value)) return value.map(sanitizeSnapshot);
    if (!value || typeof value !== 'object') return value;
    const blocked = new Set(['api_key', 'apikey', 'authorization', 'api_base_url', 'base_url', 'endpoint', 'api_model', 'model']);
    const clean = {};
    for (const [key, item] of Object.entries(value)) {
      if (blocked.has(key.toLowerCase())) continue;
      clean[key] = sanitizeSnapshot(item);
    }
    return clean;
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
    } = options || {};

    if (!apiBase || typeof fetchJson !== 'function' || typeof getAuditId !== 'function') {
      throw new Error('GeoScore Evidence Map controller requires API and audit dependencies');
    }

    let state = { ...EMPTY_STATE };

    function getState() {
      return state;
    }

    function reset() {
      state = { ...EMPTY_STATE };
    }

    function hydrate(snapshot) {
      if (snapshot == null) return;
      state = { ...state, snapshot: sanitizeSnapshot(snapshot) };
    }

    async function run(runOptions = {}) {
      const requestedAuditId = runOptions.auditId || getAuditId();
      let customApiConfig = runOptions.customApiConfig || null;
      const usesCustomApi = Boolean(customApiConfig);
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

      if (getAuditId() === requestedAuditId) rerender?.();
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
    });
  }

  global.GeoScoreEvidenceMap = Object.freeze({ create, sanitizeSnapshot });
})(typeof window !== 'undefined' ? window : globalThis);
