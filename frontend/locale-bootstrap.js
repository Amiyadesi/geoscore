(function (global) {
  'use strict';

  const MANUAL_COOKIE = 'sayori_locale';
  const AUTO_COOKIE = 'sayori_locale_auto';
  const SHARED_STORAGE = 'sayori:ui-language';
  const LEGACY_STORAGE = 'geoscore:ui-language';

  function locale(value) {
    const input = String(value || '').toLowerCase();
    if (['zh-hant', 'zh-tw', 'zh-hk', 'tw'].includes(input)) return 'zh-Hant';
    if (['zh-hans', 'zh-cn', 'zh', 'cn'].includes(input)) return 'zh-Hans';
    return 'en';
  }

  function cookie(name) {
    const item = global.document.cookie.split(';').map(part => part.trim().split('='))
      .find(([key]) => key === name);
    if (!item) return '';
    try { return decodeURIComponent(item.slice(1).join('=')); } catch { return item.slice(1).join('='); }
  }

  function readStorage(key) {
    try { return global.localStorage?.getItem(key) || ''; } catch { return ''; }
  }

  function saveManual(value) {
    try {
      global.localStorage?.setItem(SHARED_STORAGE, value);
      global.localStorage?.setItem(LEGACY_STORAGE, value);
    } catch { /* storage may be unavailable */ }
    global.document.cookie = `${MANUAL_COOKIE}=${encodeURIComponent(value)}; Domain=.sayori.org; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
    global.document.cookie = `${AUTO_COOKIE}=; Domain=.sayori.org; Path=/; Max-Age=0; SameSite=Lax; Secure`;
  }

  function saveAutomatic(value) {
    global.document.cookie = `${AUTO_COOKIE}=${encodeURIComponent(value)}; Domain=.sayori.org; Path=/; SameSite=Lax; Secure`;
  }

  function finish(value) {
    const selected = locale(value);
    global.SAYORI_INITIAL_LOCALE = selected;
    global.document.documentElement.lang = selected === 'zh-Hans' ? 'zh-CN' : selected === 'zh-Hant' ? 'zh-Hant' : 'en';
    delete global.document.documentElement.dataset.localePending;
    return selected;
  }

  let query = '';
  try {
    const url = new URL(global.location.href);
    const raw = url.searchParams.get('lang');
    if (raw && ['zh', 'zh-hans', 'zh-hant', 'en'].includes(raw.toLowerCase())) {
      query = locale(raw);
      saveManual(query);
      url.searchParams.delete('lang');
      global.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
  } catch { /* use the remaining locale sources */ }

  const manual = cookie(MANUAL_COOKIE);
  const legacy = readStorage(SHARED_STORAGE) || readStorage(LEGACY_STORAGE);
  if (!manual && legacy) saveManual(locale(legacy));
  const immediate = query || manual || legacy || cookie(AUTO_COOKIE);
  if (immediate) {
    finish(immediate);
    global.SAYORI_LOCALE_READY = Promise.resolve(global.SAYORI_INITIAL_LOCALE);
    return;
  }

  global.document.documentElement.dataset.localePending = 'true';
  global.SAYORI_LOCALE_READY = global.fetch('https://sayori.org/api/locale', { credentials: 'include' })
    .then(response => response.ok ? response.json() : Promise.reject(new Error('locale unavailable')))
    .then(data => {
      const selected = locale(data.locale);
      saveAutomatic(selected);
      const initialized = Boolean(global.GeoScoreI18n);
      finish(selected);
      if (initialized) global.location.reload();
      return selected;
    })
    .catch(() => finish(global.navigator.languages?.[0] || global.navigator.language || 'en'));
})(typeof window !== 'undefined' ? window : globalThis);
