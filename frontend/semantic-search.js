(function (global) {
  'use strict';

  const MODEL = 'Xenova/bge-small-en-v1.5';
  const DB_NAME = 'geo_audit_sem';
  const STORE_NAME = 'vecs';

  function dotSimilarity(left, right) {
    let score = 0;
    for (let index = 0; index < left.length; index += 1) score += left[index] * right[index];
    return score;
  }

  function create(options) {
    const {
      apiBase,
      uiText,
      fetch: fetchRef = global.fetch,
      document: documentRef = global.document,
      navigator: navigatorRef = global.navigator,
      indexedDB: indexedDbRef = global.indexedDB,
    } = options || {};
    if (!apiBase || typeof uiText !== 'function' || typeof fetchRef !== 'function') {
      throw new Error('GeoScore semantic search requires API, copy, and fetch dependencies');
    }

    let embedder = null;
    let businesses = [];
    let vectors = null;
    let ready = false;

    function databaseOperation(mode, key, value) {
      if (!indexedDbRef) return Promise.resolve(null);
      return new Promise(resolve => {
        const request = indexedDbRef.open(DB_NAME, 1);
        request.onupgradeneeded = event => event.target.result.createObjectStore(STORE_NAME);
        request.onsuccess = event => {
          const database = event.target.result;
          const transaction = database.transaction(STORE_NAME, mode);
          const operation = mode === 'readonly'
            ? transaction.objectStore(STORE_NAME).get(key)
            : transaction.objectStore(STORE_NAME).put(value, key);
          operation.onsuccess = () => resolve(operation.result ?? null);
          operation.onerror = () => resolve(null);
        };
        request.onerror = () => resolve(null);
      });
    }

    async function embedBatch(texts) {
      const output = await embedder(texts, { pooling: 'mean', normalize: true });
      const dimension = output.dims[output.dims.length - 1];
      return Array.from({ length: texts.length }, (_, index) =>
        new Float32Array(output.data.slice(index * dimension, (index + 1) * dimension))
      );
    }

    function setBadge(state) {
      const element = documentRef?.getElementById('semantic-badge');
      if (!element) return;
      element.className = 'text-xs px-2 py-0.5 rounded';
      if (state === 'loading') {
        element.textContent = `⚡ ${uiText('semantic.loading')}`;
        element.classList.add('bg-amber-50', 'text-amber-600');
      } else if (state === 'ready') {
        element.textContent = `⚡ ${uiText('semantic.ready')}`;
        element.classList.add('bg-green-50', 'text-green-700', 'font-medium');
      } else {
        element.textContent = '';
      }
    }

    async function init() {
      if (!navigatorRef?.gpu) return false;
      try {
        setBadge('loading');
        const transformers = await import(
          'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/transformers.min.js'
        );
        transformers.env.allowLocalModels = false;
        transformers.env.useBrowserCache = true;
        embedder = await transformers.pipeline('feature-extraction', MODEL, {
          device: 'webgpu',
          dtype: 'q8',
        });

        const response = await fetchRef(`${apiBase}/api/businesses`);
        businesses = response.ok ? await response.json() : [];
        if (!businesses.length) {
          setBadge('off');
          return false;
        }

        const cacheKey = `${MODEL}@${businesses.length}`;
        const cached = await databaseOperation('readonly', cacheKey);
        if (Array.isArray(cached)) {
          vectors = cached.map(item => new Float32Array(item));
        } else {
          const texts = businesses.map(item =>
            `${item.name} ${item.category || ''} ${item.city || ''}`.replace(/\s+/g, ' ').trim()
          );
          vectors = [];
          for (let index = 0; index < texts.length; index += 16) {
            vectors.push(...await embedBatch(texts.slice(index, index + 16)));
          }
          void databaseOperation('readwrite', cacheKey, vectors.map(item => Array.from(item)));
        }

        ready = true;
        setBadge('ready');
        return true;
      } catch (error) {
        console.warn('[semantic]', error?.message ?? error);
        setBadge('off');
        return false;
      }
    }

    async function search(query, topK = 8) {
      if (!ready || !embedder || !vectors) return null;
      try {
        const output = await embedder(query, { pooling: 'mean', normalize: true });
        const queryVector = new Float32Array(output.data);
        const scored = businesses.map((business, index) => ({
          ...business,
          _sim: dotSimilarity(queryVector, vectors[index]),
        }));
        scored.sort((left, right) => right._sim - left._sim);
        return scored.filter(item => item._sim > 0.25).slice(0, topK);
      } catch {
        return null;
      }
    }

    return Object.freeze({ init, search });
  }

  global.GeoScoreSemanticSearch = Object.freeze({ create, dotSimilarity });
})(typeof window !== 'undefined' ? window : globalThis);
