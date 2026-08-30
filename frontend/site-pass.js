(function (global) {
  'use strict';

  const PAY_URL = 'https://buy.stripe.com/7sY28t61t9OE3WA9ah38400';
  const API = (typeof global.SITE_PASS_API === 'string' && global.SITE_PASS_API)
    ? global.SITE_PASS_API
    : ((typeof global.PRODUCTION_API === 'string' && global.PRODUCTION_API)
      ? global.PRODUCTION_API
      : 'https://geo-api.sayori.org');

  function currentDomain(auditData) {
    return String(auditData?.domain || auditData?.root_domain || '')
      .trim()
      .replace(/^www\./, '')
      .toLowerCase();
  }

  function cardEls() {
    return {
      card: global.document.getElementById('site-pass-card'),
      body: global.document.getElementById('site-pass-body'),
      buy: global.document.getElementById('site-pass-buy'),
    };
  }

  async function status(domain) {
    const res = await fetch(`${API}/api/site-pass?domain=${encodeURIComponent(domain)}`);
    if (!res.ok) return { active: false };
    return res.json();
  }

  async function claimFromQuery() {
    const params = new URLSearchParams(global.location.search);
    const sessionId = params.get('session_id');
    if (!sessionId || params.get('pass') !== '1') return null;
    const res = await fetch(`${API}/api/site-pass/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    });
    if (!res.ok) return null;
    return res.json();
  }

  function renderPass(pass, fallbackDomain) {
    const els = cardEls();
    if (!els.card) return;
    els.card.classList.remove('hidden');
    if (pass?.active) {
      const date = new Date(pass.expires_at * 1000).toLocaleDateString();
      els.body.textContent = `Pass active until ${date}. ${pass.reruns_remaining} re-audits left for ${pass.domain}.`;
      if (els.buy) els.buy.classList.add('hidden');
    } else if (els.buy) {
      els.buy.classList.remove('hidden');
      els.buy.setAttribute('href', PAY_URL);
      els.buy.dataset.domain = fallbackDomain || '';
    }
  }

  async function onAudit(data) {
    const domain = currentDomain(data);
    if (!domain) return;
    const els = cardEls();
    if (els.card) els.card.classList.remove('hidden');
    try {
      const claimed = await claimFromQuery();
      if (claimed?.active) {
        renderPass(claimed, domain);
        return;
      }
      renderPass(await status(domain), domain);
    } catch {
      renderPass({ active: false }, domain);
    }
  }

  global.GeoScoreSitePass = { PAY_URL, currentDomain, status, claimFromQuery, onAudit };

  global.document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(global.location.search);
    if (params.get('pass') === '1') {
      const els = cardEls();
      if (els.card) els.card.classList.remove('hidden');
      claimFromQuery().then((pass) => {
        if (pass) renderPass(pass, pass.domain);
      }).catch(() => {});
    }
  });
})(window);
