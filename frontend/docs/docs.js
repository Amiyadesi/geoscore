(function () {
  'use strict';

  const STORAGE_KEY = 'geoscore:ui-language';
  const SHARED_STORAGE_KEY = 'sayori:ui-language';
  const supported = new Set(['en', 'zh-Hans', 'zh-Hant']);

  function locale(value) {
    const input = String(value || '').toLowerCase();
    if (['zh-hant', 'zh-tw', 'zh-hk', 'tw'].includes(input)) return 'zh-Hant';
    if (['zh-hans', 'zh-cn', 'zh', 'cn'].includes(input)) return 'zh-Hans';
    return 'en';
  }

  function defaultLanguage() {
    let stored = '';
    try { stored = localStorage.getItem(SHARED_STORAGE_KEY) || localStorage.getItem(STORAGE_KEY) || ''; } catch {}
    return locale(window.SAYORI_INITIAL_LOCALE || stored || navigator.language);
  }

  function applyLanguage(language) {
    const selected = supported.has(language) ? language : 'en';
    const contentLanguage = selected === 'en' ? 'en' : 'zh';
    document.documentElement.lang = selected === 'zh-Hans' ? 'zh-CN' : selected === 'zh-Hant' ? 'zh-Hant' : 'en';
    document.querySelectorAll('[data-doc-lang]').forEach(element => {
      element.hidden = element.dataset.docLang !== contentLanguage;
    });
    document.querySelectorAll('[data-language]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.language === selected));
    });
    document.title = selected === 'en' ? 'GeoScore Docs' : selected === 'zh-Hant' ? 'GeoScore 文件' : 'GeoScore 文档';
    if (selected === 'zh-Hant') convertToTraditional();
  }

  function convertToTraditional() {
    const convert = window.OpenCC?.Converter?.({ from: 'cn', to: 't' });
    if (!convert) {
      loadConverter();
      return;
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      if (!node.parentElement?.closest('[data-doc-lang="zh"],.language-switch') || node.parentElement?.closest('code,pre,script,style,[data-no-opencc]')) return;
      node.nodeValue = convert(node.nodeValue);
    });
  }

  // locale-bootstrap.js loads the converter up front for zh-Hant visitors; this
  // covers a locale that was only detected after the page started loading.
  let converterRequested = false;
  function loadConverter() {
    if (converterRequested) return;
    converterRequested = true;
    const script = document.createElement('script');
    script.src = '/opencc-cn2t.js';
    script.onload = () => { if (window.OpenCC?.Converter) convertToTraditional(); };
    document.head.appendChild(script);
  }

  document.querySelectorAll('[data-language]').forEach(button => {
    button.addEventListener('click', () => {
      const selected = locale(button.dataset.language);
      try {
        localStorage.setItem(STORAGE_KEY, selected);
        localStorage.setItem(SHARED_STORAGE_KEY, selected);
      } catch {}
      document.cookie = `sayori_locale=${encodeURIComponent(selected)}; Domain=.sayori.org; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
      document.cookie = 'sayori_locale_auto=; Domain=.sayori.org; Path=/; Max-Age=0; SameSite=Lax; Secure';
      location.reload();
    });
  });

  const menu = document.getElementById('docs-menu');
  const taskNav = document.getElementById('task-nav');
  menu?.addEventListener('click', () => {
    const open = taskNav?.dataset.open !== 'true';
    if (taskNav) taskNav.dataset.open = String(open);
    menu.setAttribute('aria-expanded', String(open));
  });
  taskNav?.addEventListener('click', event => {
    if (!event.target.closest('a')) return;
    taskNav.dataset.open = 'false';
    menu?.setAttribute('aria-expanded', 'false');
  });

  document.querySelectorAll('[data-copy]').forEach(button => {
    button.addEventListener('click', async () => {
      const target = document.getElementById(button.dataset.copy || '');
      if (!target) return;
      const original = button.textContent;
      try {
        await navigator.clipboard.writeText(target.textContent || '');
        button.textContent = document.documentElement.lang.startsWith('zh') ? '已复制' : 'Copied';
      } catch {
        button.textContent = document.documentElement.lang.startsWith('zh') ? '复制失败' : 'Copy failed';
      }
      setTimeout(() => { button.textContent = original; }, 1600);
    });
  });

  applyLanguage(defaultLanguage());
})();
