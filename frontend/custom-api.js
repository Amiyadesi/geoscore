(function (global) {
  'use strict';

  const MODEL_LIMIT = 50;

  function normalizeBaseUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
      let normalizedPath = url.pathname.replace(/\/+$/, '');
      const loweredPath = normalizedPath.toLowerCase();
      for (const suffix of ['/chat/completions', '/models']) {
        if (loweredPath.endsWith(suffix)) {
          normalizedPath = normalizedPath.slice(0, -suffix.length).replace(/\/+$/, '');
          break;
        }
      }
      url.pathname = normalizedPath || '/v1';
      return url.toString().replace(/\/$/, '');
    } catch {
      return null;
    }
  }

  function modelIds(payload) {
    const candidates = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.models)
        ? payload.models
        : Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload?.data?.models)
            ? payload.data.models
            : [];
    const seen = new Set();
    const models = [];
    for (const item of candidates) {
      const value = String(typeof item === 'string' ? item : item?.id ?? item?.model ?? item?.name ?? '').trim();
      if (!value || value.length > 160 || seen.has(value)) continue;
      seen.add(value);
      models.push(value);
      if (models.length >= MODEL_LIMIT) break;
    }
    return models;
  }

  function create(options) {
    const {
      apiBase,
      uiText,
      fetch: fetchRef = global.fetch,
      document: documentRef = global.document,
      setTimeout: setTimeoutRef = global.setTimeout,
      clearTimeout: clearTimeoutRef = global.clearTimeout,
    } = options || {};
    if (!apiBase || typeof uiText !== 'function' || typeof fetchRef !== 'function') {
      throw new Error('GeoScore custom API controller requires API, copy, and fetch dependencies');
    }

    let modelsBusy = false;
    let runSequence = 0;
    let pendingConfig = null;

    function elements() {
      return {
        panel: documentRef?.getElementById('custom-api-panel'),
        apiKey: documentRef?.getElementById('custom-api-key'),
        baseUrl: documentRef?.getElementById('custom-api-base-url'),
        model: documentRef?.getElementById('custom-api-model'),
        modelList: documentRef?.getElementById('custom-api-model-list'),
        fetchModels: documentRef?.getElementById('custom-api-fetch-models'),
        status: documentRef?.getElementById('custom-api-status'),
      };
    }

    function setStatus(message = '', failed = false) {
      const { status } = elements();
      if (!status) return;
      status.textContent = String(message || '');
      status.classList.toggle('hidden', !message);
      status.classList.toggle('text-orange-700', failed);
      status.classList.toggle('text-green-700', !failed && Boolean(message));
      status.setAttribute('role', failed ? 'alert' : 'status');
      status.setAttribute('aria-live', failed ? 'assertive' : 'polite');
    }

    function focusField(field) {
      const { panel } = elements();
      if (panel) panel.open = true;
      field?.focus();
    }

    function overwriteConfig(config) {
      if (!config || typeof config !== 'object') return;
      config.apiKey = '';
      config.apiBaseUrl = '';
      config.apiModel = '';
      config.runId = null;
    }

    function discard(runId = null) {
      if (!pendingConfig) return false;
      if (runId !== null && pendingConfig.runId !== runId) return false;
      const config = pendingConfig;
      pendingConfig = null;
      overwriteConfig(config);
      return true;
    }

    function clearInputs() {
      const { apiKey, baseUrl, model, modelList } = elements();
      if (apiKey) apiKey.value = '';
      if (baseUrl) baseUrl.value = '';
      if (model) model.value = '';
      modelList?.replaceChildren();
    }

    function nextRunId() {
      runSequence += 1;
      return runSequence;
    }

    function stage(runId) {
      const { apiKey, baseUrl, model } = elements();
      const values = {
        apiKey: String(apiKey?.value || '').trim(),
        apiBaseUrl: String(baseUrl?.value || '').trim(),
        apiModel: String(model?.value || '').trim(),
      };
      const hasAnyValue = Boolean(values.apiKey || values.apiBaseUrl || values.apiModel);
      discard();
      if (!hasAnyValue) {
        setStatus('');
        return { ok: true, configured: false };
      }
      if (!values.apiKey || !values.apiBaseUrl || !values.apiModel) {
        setStatus(uiText('customApi.error.required'), true);
        focusField(!values.apiKey ? apiKey : !values.apiBaseUrl ? baseUrl : model);
        return { ok: false, configured: false };
      }
      const normalizedBaseUrl = normalizeBaseUrl(values.apiBaseUrl);
      if (!normalizedBaseUrl) {
        setStatus(uiText('customApi.error.https'), true);
        focusField(baseUrl);
        return { ok: false, configured: false };
      }
      pendingConfig = {
        runId,
        apiKey: values.apiKey,
        apiBaseUrl: normalizedBaseUrl,
        apiModel: values.apiModel.slice(0, 160),
      };
      clearInputs();
      setStatus(uiText('customApi.queued'));
      return { ok: true, configured: true };
    }

    function claim(runId) {
      if (!pendingConfig || pendingConfig.runId !== runId) return null;
      const config = pendingConfig;
      pendingConfig = null;
      return config;
    }

    function renderModels(models) {
      const { modelList } = elements();
      if (!modelList) return;
      modelList.replaceChildren();
      for (const value of models) {
        const option = documentRef.createElement('option');
        option.value = value;
        modelList.appendChild(option);
      }
    }

    async function fetchModels() {
      if (modelsBusy) return false;
      const { apiKey, baseUrl, fetchModels: button } = elements();
      let key = String(apiKey?.value || '').trim();
      const normalizedBaseUrl = normalizeBaseUrl(baseUrl?.value);
      if (!key) {
        setStatus(uiText('customApi.error.required'), true);
        focusField(apiKey);
        return false;
      }
      if (!normalizedBaseUrl) {
        setStatus(uiText('customApi.error.https'), true);
        focusField(baseUrl);
        return false;
      }
      modelsBusy = true;
      if (button) {
        button.disabled = true;
        button.textContent = uiText('customApi.fetchingModels');
      }
      setStatus(uiText('customApi.fetchingModels'));
      const controller = new AbortController();
      const timeout = setTimeoutRef(() => controller.abort(), 15000);
      try {
        const response = await fetchRef(`${apiBase}/api/answer-models`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-API-Key': key,
          },
          body: JSON.stringify({ api_base_url: normalizedBaseUrl }),
          signal: controller.signal,
          referrerPolicy: 'no-referrer',
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload) throw new Error(`HTTP ${response.status}`);
        const models = modelIds(payload);
        renderModels(models);
        setStatus(models.length
          ? uiText('customApi.modelsLoaded', { count: models.length })
          : uiText('customApi.error.emptyModels'), models.length === 0);
        return models.length > 0;
      } catch {
        renderModels([]);
        setStatus(uiText('customApi.error.fetch'), true);
        return false;
      } finally {
        clearTimeoutRef(timeout);
        key = '';
        modelsBusy = false;
        if (button) {
          button.disabled = false;
          button.textContent = uiText('customApi.fetchModels');
        }
      }
    }

    documentRef?.getElementById('custom-api-fetch-models')?.addEventListener('click', fetchModels);

    return Object.freeze({
      nextRunId,
      stage,
      claim,
      discard,
      clearInputs,
      setStatus,
      overwriteConfig,
      fetchModels,
    });
  }

  global.GeoScoreCustomApi = Object.freeze({ create, modelIds, normalizeBaseUrl });
})(typeof window !== 'undefined' ? window : globalThis);
