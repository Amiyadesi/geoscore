(function () {
  'use strict';

  const STORAGE_KEY = 'geoscore:ui-language';
  const supported = new Set(['en', 'zh']);

  function defaultLanguage() {
    let stored = '';
    try { stored = localStorage.getItem(STORAGE_KEY) || ''; } catch {}
    if (supported.has(stored)) return stored;
    return String(navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }

  function applyLanguage(language) {
    const selected = supported.has(language) ? language : 'en';
    document.documentElement.lang = selected === 'zh' ? 'zh-CN' : 'en';
    document.querySelectorAll('[data-doc-lang]').forEach(element => {
      element.hidden = element.dataset.docLang !== selected;
    });
    document.querySelectorAll('[data-language]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.language === selected));
    });
    document.title = selected === 'zh' ? 'GeoScore 文档' : 'GeoScore Docs';
    try { localStorage.setItem(STORAGE_KEY, selected); } catch {}
  }

  document.querySelectorAll('[data-language]').forEach(button => {
    button.addEventListener('click', () => applyLanguage(button.dataset.language));
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
