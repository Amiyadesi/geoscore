(function (global) {
  'use strict';

  function create(options) {
    const {
      EventSource: EventSourceRef = global.EventSource,
      setTimeout: setTimeoutRef = global.setTimeout,
      clearTimeout: clearTimeoutRef = global.clearTimeout,
      buildEndpoint,
      maxRetries = 2,
      retryDelay = attempt => 2000 * attempt,
      onProgress = () => {},
      onSection = () => {},
      onComplete = () => {},
      onRetry = () => {},
      onFailure = () => {},
    } = options || {};

    if (typeof EventSourceRef !== 'function' || typeof buildEndpoint !== 'function') {
      throw new Error('GeoScore audit runner requires EventSource and endpoint dependencies');
    }

    let generation = 0;
    let activeSource = null;
    let retryTimer = null;
    let activeRun = null;

    function closeSource(source) {
      try { source?.close?.(); } catch { /* best-effort close */ }
      if (activeSource === source) activeSource = null;
    }

    function cancel() {
      const hadActiveRun = Boolean(activeRun || activeSource || retryTimer);
      generation += 1;
      if (retryTimer !== null) clearTimeoutRef(retryTimer);
      retryTimer = null;
      closeSource(activeSource);
      activeRun = null;
      return hadActiveRun;
    }

    function fail(run, details) {
      if (generation !== run.generation) return;
      activeRun = null;
      onFailure({ request: run.request, ...details });
    }

    function parseEvent(event, eventName, run, source, attempt) {
      try {
        const value = JSON.parse(event?.data);
        if (value && typeof value === 'object') return value;
      } catch { /* handled below */ }
      closeSource(source);
      fail(run, {
        code: 'AUDIT_STREAM_INVALID_EVENT',
        message: `Invalid ${eventName} event`,
        retryable: false,
        attempt,
      });
      return null;
    }

    function open(run, attempt) {
      if (generation !== run.generation) return false;
      const endpoint = buildEndpoint(run.request, {
        attempt,
        fresh: run.fresh && attempt === 0,
      });
      if (!endpoint) {
        fail(run, {
          code: 'AUDIT_STREAM_INVALID_ENDPOINT',
          message: 'Audit endpoint could not be built',
          retryable: false,
          attempt,
        });
        return false;
      }

      let source;
      try {
        source = new EventSourceRef(endpoint);
      } catch {
        fail(run, {
          code: 'AUDIT_STREAM_CONNECT_FAILED',
          message: 'Audit stream could not be opened',
          retryable: false,
          attempt,
        });
        return false;
      }
      activeSource = source;

      const current = () => generation === run.generation && activeRun === run && activeSource === source;
      const context = () => ({ request: run.request, attempt, source });

      source.addEventListener('progress', event => {
        if (!current()) return;
        const payload = parseEvent(event, 'progress', run, source, attempt);
        if (payload) onProgress(payload, context());
      });

      source.addEventListener('section', event => {
        if (!current()) return;
        const payload = parseEvent(event, 'section', run, source, attempt);
        if (payload) onSection(payload, context());
      });

      source.addEventListener('complete', event => {
        if (!current()) return;
        const payload = parseEvent(event, 'complete', run, source, attempt);
        if (!payload) return;
        closeSource(source);
        activeRun = null;
        onComplete(payload, context());
      });

      source.addEventListener('error', () => {
        if (!current()) return;
        closeSource(source);
        if (attempt >= maxRetries) {
          fail(run, {
            code: 'AUDIT_STREAM_RETRIES_EXHAUSTED',
            message: 'Audit stream retries exhausted',
            retryable: true,
            attempt,
          });
          return;
        }
        const nextAttempt = attempt + 1;
        const delayMs = Math.max(0, Number(retryDelay(nextAttempt)) || 0);
        onRetry({ request: run.request, attempt: nextAttempt, maxRetries, delayMs });
        retryTimer = setTimeoutRef(() => {
          retryTimer = null;
          open(run, nextAttempt);
        }, delayMs);
      });
      return true;
    }

    function start(request, startOptions = {}) {
      cancel();
      const run = {
        request,
        fresh: startOptions.fresh === true,
        generation,
      };
      activeRun = run;
      return open(run, 0);
    }

    return Object.freeze({
      start,
      cancel,
      getActiveSource: () => activeSource,
    });
  }

  global.GeoScoreAuditRunner = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
