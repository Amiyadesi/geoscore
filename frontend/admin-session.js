/** @param {any} global */
(function (global) {
  'use strict';

  const PRODUCTION_API = 'https://geo-api.sayori.org';
  const LOCAL_API = 'http://127.0.0.1:8787';
  const API = global.location && (global.location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(global.location.hostname))
    ? LOCAL_API
    : PRODUCTION_API;

  global.GeoScoreAdmin = global.GeoScoreAdmin || { session: null, api: API };

  const nativeFetch = global.fetch.bind(global);
  global.fetch = function geoscoreAdminFetch(input, init) {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    if (url.startsWith(API) || url.startsWith('/api/')) {
      return nativeFetch(input, Object.assign({}, init, { credentials: 'include' }));
    }
    return nativeFetch(input, init);
  };

  nativeFetch(`${API}/api/admin/session`, { credentials: 'include' })
    .then(res => (res.ok ? res.json() : null))
    .then(session => {
      global.GeoScoreAdmin.session = session;
      if (session?.full_access) {
        if (global.document?.documentElement) {
          global.document.documentElement.dataset.geoscoreOwner = session.login || '1';
        }
        global.GeoScoreSitePass?.onOwnerSession?.(session);
      }
    })
    .catch(() => {});
})(window);
