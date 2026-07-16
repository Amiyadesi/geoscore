(function (global) {
  'use strict';

  function create(options) {
    const {
      apiBase,
      uiText,
      escapeHtml,
      formatSeconds,
      getAuditId,
      getReportLanguage,
      getRecommendation,
      fetch: fetchRef = global.fetch,
      document: documentRef = global.document,
      storage: storageRef = global.localStorage,
      crypto: cryptoRef = global.crypto,
    } = options || {};
    if (!apiBase || typeof uiText !== 'function' || typeof escapeHtml !== 'function' || typeof getAuditId !== 'function') {
      throw new Error('GeoScore assistant UI requires API, copy, escaping, and audit dependencies');
    }

    let sessionId = cryptoRef?.randomUUID?.() ?? `${Date.now()}`;
    try {
      sessionId = storageRef?.getItem('session_id') || sessionId;
      storageRef?.setItem('session_id', sessionId);
    } catch { /* private browsing or blocked storage */ }

    function renderFixPack(pack) {
      const language = getReportLanguage?.() ?? 'en';
      const sections = [];
      const evidence = pack?.evidence;
      if (evidence) {
        sections.push(`<div><div class="font-semibold text-slate-700 mb-1">${language === 'zh' ? '证据摘要' : 'Evidence summary'}</div><div class="text-xs text-slate-500">${escapeHtml((evidence.observed ?? []).join(' · ') || evidence.why || '')}</div></div>`);
      }
      if (pack?.code_snippets?.length) {
        sections.push(pack.code_snippets.map(item => `<div><div class="font-semibold text-slate-700 mb-1">${escapeHtml(item.label || 'Code')}</div><pre class="bg-slate-900 text-green-300 rounded p-2 text-xs overflow-x-auto whitespace-pre-wrap">${escapeHtml(item.code || '')}</pre></div>`).join(''));
      }
      if (pack?.fix_steps?.length) {
        sections.push(`<div><div class="font-semibold text-slate-700 mb-1">${language === 'zh' ? '修改步骤' : 'Fix steps'}</div><ol class="list-decimal ml-5 text-xs text-slate-600 space-y-1">${pack.fix_steps.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ol></div>`);
      }
      if (pack?.verify?.length) {
        sections.push(`<div><div class="font-semibold text-slate-700 mb-1">${language === 'zh' ? '复验清单' : 'Verification'}</div><ul class="list-disc ml-5 text-xs text-slate-600 space-y-1">${pack.verify.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`);
      }
      if (pack?.handoff_prompt) {
        sections.push(`<div><div class="flex items-center justify-between gap-2 mb-1"><div class="font-semibold text-slate-700">${language === 'zh' ? '交给开发 AI' : 'Developer AI handoff'}</div><button type="button" data-copy="${escapeHtml(pack.handoff_prompt)}" class="text-[10px] text-blue-600 border border-blue-200 rounded px-2 py-1">${escapeHtml(uiText('common.copy'))}</button></div><pre class="bg-slate-50 border border-slate-200 rounded p-2 text-xs overflow-x-auto whitespace-pre-wrap text-slate-600">${escapeHtml(pack.handoff_prompt)}</pre></div>`);
      }
      return `<div class="space-y-3">${sections.join('')}</div>`;
    }

    async function toggleFix(button) {
      const item = button.closest('li');
      const box = item?.querySelector('.what-to-do');
      if (!box) return false;
      const hidden = box.classList.toggle('hidden');
      button.textContent = hidden ? uiText('fix.show') : uiText('fix.hide');
      if (hidden || box.dataset.loaded) return true;

      const recommendationId = button.dataset.recommendationId;
      const recommendation = getRecommendation?.(recommendationId || Number(button.dataset.recIndex));
      if (!recommendation) return false;

      box.dataset.loaded = '1';
      const startedAt = Date.now();
      const timer = documentRef.createElement('div');
      timer.className = 'text-xs text-slate-400 italic flex items-center gap-2';
      timer.innerHTML = `${escapeHtml(uiText('fix.generating'))} <span class="font-mono text-blue-400">0s</span>`;
      box.innerHTML = '';
      box.appendChild(timer);
      const interval = setInterval(() => {
        const value = timer.querySelector('span');
        if (value) value.textContent = formatSeconds(Date.now() - startedAt);
      }, 1000);

      try {
        const auditId = getAuditId();
        if (!auditId || !recommendationId) throw new Error('Fix pack requires an evidence audit');
        const response = await fetchRef(`${apiBase}/api/fix`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audit_id: auditId,
            recommendation_id: recommendationId,
            language: getReportLanguage?.() ?? 'en',
            output: 'full',
          }),
        });
        const pack = await response.json().catch(() => null);
        if (!response.ok || !pack) throw new Error(pack?.error?.message || 'Fix pack unavailable');
        clearInterval(interval);
        box.innerHTML = renderFixPack(pack) +
          `<div class="text-[10px] text-slate-300 mt-2 text-right">${formatSeconds(Date.now() - startedAt)}</div>`;
      } catch {
        clearInterval(interval);
        box.innerHTML = `<div class="text-xs text-blue-500">${escapeHtml(uiText('fix.failed'))}</div>`;
        delete box.dataset.loaded;
      }
      return true;
    }

    function appendError(message, temporary = false) {
      const element = documentRef.createElement('div');
      element.className = `${temporary ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-blue-50 border-blue-200 text-blue-700'} border rounded-xl p-4 text-sm fade-in`;
      element.textContent = message;
      documentRef.getElementById('modules')?.appendChild(element);
      if (temporary) setTimeout(() => element.remove(), 5000);
    }

    function enableChat() {
      const bubble = documentRef.getElementById('chat-bubble');
      if (bubble) bubble.classList.replace('hidden', 'flex');
      const main = documentRef.getElementById('main-content');
      if (main) main.style.paddingBottom = '76px';
    }

    function openChat() {
      documentRef.getElementById('chat-bubble')?.classList.replace('flex', 'hidden');
      documentRef.getElementById('chat-section')?.classList.remove('hidden');
      const main = documentRef.getElementById('main-content');
      if (main) main.style.paddingBottom = '180px';
      documentRef.getElementById('chat-input')?.focus();
    }

    function minimizeChat() {
      documentRef.getElementById('chat-section')?.classList.add('hidden');
      const bubble = documentRef.getElementById('chat-bubble');
      if (bubble) bubble.classList.replace('hidden', 'flex');
      const main = documentRef.getElementById('main-content');
      if (main) main.style.paddingBottom = '76px';
    }

    function clearChat() {
      const messages = documentRef.getElementById('chat-messages');
      if (messages) {
        messages.innerHTML = '';
        messages.style.maxHeight = '0';
      }
      const clearButton = documentRef.getElementById('chat-clear');
      if (clearButton) {
        clearButton.classList.add('hidden');
        clearButton.classList.remove('flex');
      }
      documentRef.getElementById('chat-suggestions')?.classList.remove('hidden');
    }

    function appendChatMessage(role, text) {
      const messages = documentRef.getElementById('chat-messages');
      if (!messages.children.length) {
        messages.style.maxHeight = '220px';
        const clearButton = documentRef.getElementById('chat-clear');
        if (clearButton) {
          clearButton.classList.remove('hidden');
          clearButton.classList.add('flex');
        }
        documentRef.getElementById('chat-suggestions')?.classList.add('hidden');
      }
      const element = documentRef.createElement('div');
      element.className = role === 'user'
        ? 'text-sm bg-blue-50 text-blue-900 px-3 py-2 rounded-xl self-end ml-8'
        : 'text-sm bg-slate-100 text-slate-800 px-3 py-2 rounded-xl mr-8';
      element.textContent = text;
      messages.appendChild(element);
      messages.scrollTop = 9999;
      return element;
    }

    async function sendChat() {
      const input = documentRef.getElementById('chat-input');
      const send = documentRef.getElementById('chat-send');
      const question = input?.value.trim() ?? '';
      const auditId = getAuditId();
      if (!question || !auditId || !input || !send) return false;
      input.value = '';
      send.disabled = true;
      appendChatMessage('user', question);
      const assistant = appendChatMessage('assistant', '…');
      const startedAt = Date.now();
      const interval = setInterval(() => {
        if (!assistant.textContent || assistant.textContent === '…') {
          assistant.textContent = `… ${formatSeconds(Date.now() - startedAt)}`;
        }
      }, 1000);
      try {
        const response = await fetchRef(`${apiBase}/api/chat/${auditId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question, session_id: sessionId }),
        });
        if (!response.ok || !response.body) {
          clearInterval(interval);
          assistant.textContent = 'Error getting response.';
          return false;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        assistant.textContent = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const line of decoder.decode(value).split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.response) {
                buffer += data.response;
                assistant.textContent = buffer;
              }
            } catch { /* skip malformed chunks */ }
          }
        }
        clearInterval(interval);
        documentRef.getElementById('chat-messages').scrollTop = 9999;
        return true;
      } catch {
        clearInterval(interval);
        assistant.textContent = 'Network error. Please try again.';
        return false;
      } finally {
        send.disabled = false;
      }
    }

    documentRef?.getElementById('chat-bubble')?.addEventListener('click', openChat);
    documentRef?.getElementById('chat-minimize')?.addEventListener('click', minimizeChat);
    documentRef?.getElementById('chat-send')?.addEventListener('click', sendChat);
    documentRef?.getElementById('chat-input')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') void sendChat();
    });
    documentRef?.getElementById('chat-clear')?.addEventListener('click', clearChat);
    documentRef?.querySelectorAll('.chat-suggestion').forEach(button => {
      button.addEventListener('click', () => {
        const input = documentRef.getElementById('chat-input');
        if (!input) return;
        input.value = button.textContent.trim();
        input.focus();
        void sendChat();
      });
    });

    return Object.freeze({ enableChat, toggleFix, appendError, renderFixPack, sendChat, clearChat });
  }

  global.GeoScoreAssistantUi = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
