(function (global) {
  'use strict';

  const PAY_URL = 'https://buy.stripe.com/7sY28t61t9OE3WA9ah38400';
  const API = 'https://pay.geo.sayori.org';
  let lastDomain = '';
  let pending = null;

  function currentDomain(data) {
    return String(data?.domain || data?.root_domain || '')
      .trim().replace(/^www\./i, '').toLowerCase();
  }

  function els() {
    return {
      card: global.document.getElementById('site-pass-card'),
      body: global.document.getElementById('site-pass-body'),
      buy: global.document.getElementById('site-pass-buy'),
    };
  }

  function paymentUrl(domain) {
    return `${PAY_URL}?client_reference_id=${encodeURIComponent(domain)}`;
  }

  async function status(domain) {
    const res = await fetch(`${API}/api/site-pass?domain=${encodeURIComponent(domain)}`);
    if (!res.ok) return { active: false };
    return res.json();
  }

  function render(pass, domain) {
    const { card, body, buy } = els();
    if (!card) return;
    card.classList.remove('hidden');
    if (pass?.active) {
      const date = new Date(pass.expires_at * 1000).toLocaleDateString();
      body.textContent = `Site Pass active until ${date}. ${pass.reruns_remaining} re-audits left.`;
      buy?.classList.add('hidden');
      return;
    }
    body.textContent = 'Unlock the full repair pack, shareable report, and 3 re-audits.';
    if (buy) {
      buy.classList.remove('hidden');
      buy.href = paymentUrl(domain);
    }
  }

  async function onAudit(data) {
    const domain = currentDomain(data);
    if (!domain || domain === lastDomain && !pending) return;
    lastDomain = domain;
    pending = status(domain).catch(() => ({ active: false }));
    render(await pending, domain);
    pending = null;
  }

  global.GeoScoreSitePass = { PAY_URL, currentDomain, paymentUrl, status, onAudit };
})(window);
