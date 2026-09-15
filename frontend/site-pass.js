/** @param {any} global */
(function (global) {
  'use strict';

  const PAY_URL = 'https://buy.stripe.com/7sY28t61t9OE3WA9ah38400';
  const API = 'https://pay.geo.sayori.org';
  let lastDomain = '';
  /** @type {any} */
  let lastStatus = { active: false };
  let pending = null;

  function t(key, vars) {
    return global.GeoScoreI18n?.t?.(key, vars) ?? key;
  }

  function currentDomain(data) {
    return String(data?.domain || data?.root_domain || '')
      .trim().replace(/^www\./i, '').toLowerCase();
  }

  function els() {
    return {
      card: global.document.getElementById('site-pass-card'),
      body: global.document.getElementById('site-pass-body'),
      buy: /** @type {HTMLAnchorElement | null} */ (global.document.getElementById('site-pass-buy')),
    };
  }

  function paymentUrl(domain) {
    return `${PAY_URL}?client_reference_id=${encodeURIComponent(domain)}`;
  }

  async function status(domain) {
    const res = await fetch(`${API}/api/site-pass?domain=${encodeURIComponent(domain)}`);
    if (!res.ok) return { active: false, domain };
    const payload = await res.json();
    return { ...payload, domain };
  }

  function isActive() {
    return Boolean(lastStatus?.active);
  }

  function requirePass(featureKey) {
    if (isActive()) return true;
    const { card, body, buy } = els();
    if (card) card.classList.remove('hidden');
    if (body) {
      body.textContent = t(featureKey) || t('audit.sitePass.body');
    }
    if (buy && lastDomain) {
      buy.classList.remove('hidden');
      buy.textContent = t('audit.sitePass.buy');
      buy.href = paymentUrl(lastDomain);
    }
    return false;
  }

  function render(pass, domain) {
    const { card, body, buy } = els();
    lastStatus = pass || { active: false, domain };
    if (!card) return;
    card.classList.remove('hidden');
    if (pass?.active) {
      if (pass.owner) {
        body.textContent = t('audit.sitePass.owner');
        buy?.classList.add('hidden');
        return;
      }
      const date = new Date(pass.expires_at * 1000).toLocaleDateString();
      body.textContent = t('audit.sitePass.active', { date, count: pass.reruns_remaining });
      buy?.classList.add('hidden');
      return;
    }
    body.textContent = t('audit.sitePass.body');
    if (buy) {
      buy.classList.remove('hidden');
      buy.textContent = t('audit.sitePass.buy');
      buy.href = paymentUrl(domain);
    }
  }

  function ownerPass() {
    const session = global.GeoScoreAdmin?.session;
    if (!session?.full_access) return null;
    return {
      active: true,
      owner: true,
      expires_at: Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
      reruns_remaining: '∞',
    };
  }

  async function onAudit(data) {
    const domain = currentDomain(data);
    const owned = ownerPass();
    if (owned) {
      lastDomain = domain || lastDomain;
      render(owned, lastDomain);
      return;
    }
    if (!domain || domain === lastDomain && !pending) return;
    lastDomain = domain;
    pending = status(domain).catch(() => ({ active: false, domain }));
    render(await pending, domain);
    pending = null;
  }

  function onOwnerSession(session) {
    global.GeoScoreAdmin = global.GeoScoreAdmin || {};
    global.GeoScoreAdmin.session = session;
    if (session?.full_access) render(ownerPass(), lastDomain);
  }

  global.GeoScoreSitePass = {
    PAY_URL,
    currentDomain,
    paymentUrl,
    status,
    onAudit,
    onOwnerSession,
    isActive,
    requirePass,
    getLastStatus: () => lastStatus,
    getLastDomain: () => lastDomain,
  };
})(window);
