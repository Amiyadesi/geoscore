const PRODUCTION_API = 'https://geo-api.sayori.org';  // direct Worker — bypasses Pages proxy SSE buffering
const LOCAL_API = 'http://127.0.0.1:8787';
const API = window.location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ? LOCAL_API
  : PRODUCTION_API;
const REPORT_UI = window.GeoScoreReport;
const I18N = window.GeoScoreI18n;
const UI_LANGUAGE = I18N ? I18N.getUiLanguage() : (REPORT_UI?.language(navigator.language) ?? 'en');
const STORED_REPORT_LANGUAGE = I18N ? I18N.getReportLanguage() : null;
let currentAuditId = null;
let currentDomain = '';
let currentAuditData = null;
let currentLighthouseState = null;
let currentAuditRequest = null;
let reportLanguage = STORED_REPORT_LANGUAGE || UI_LANGUAGE;
let reportLanguageManuallySet = Boolean(STORED_REPORT_LANGUAGE);
const recMap = new Map(); // index → rec object, rebuilt on each audit

function applyUiLanguage() {
  I18N?.apply?.(document, UI_LANGUAGE);
  I18N?.bindUiLanguageSelect?.(document);
}

function uiText(key, vars) {
  return I18N?.t?.(key, vars, UI_LANGUAGE) ?? key;
}

function reportText(key, vars) {
  return I18N?.t?.(key, vars, reportLanguage) ?? key;
}

document.documentElement.lang = UI_LANGUAGE === 'zh' ? 'zh-CN' : 'en';
applyUiLanguage();
document.title = uiText('app.documentTitle');
window.addEventListener('geoscore:ui-language-change', () => window.location.reload());

// Product facts are served by the same Worker as audits so static claims do not drift.
async function loadProductMeta() {
  const status = document.getElementById('meta-facts-status');
  try {
    const response = await fetch(`${API}/api/meta`, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`meta ${response.status}`);
    const meta = await response.json();
    const rate = meta.rate_limit || {};
    const checks = meta.checks || {};
    const optionalModules = meta.capabilities?.optional_modules_not_run;
    const values = {
      version: meta.version || meta.score_version || uiText('common.unknown'),
      pages: meta.max_pages ? uiText('meta.pages.value', { count: meta.max_pages }) : uiText('common.unknown'),
      modes: Array.isArray(meta.audit_modes) ? meta.audit_modes.join(' / ') : uiText('common.unknown'),
      checks: Number.isFinite(Number(checks.scoring))
        ? uiText('meta.checks.value', { scoring: checks.scoring, informational: checks.informational ?? 0, predicted: checks.predicted ?? 0 })
        : uiText('common.unknown'),
      optional: Array.isArray(optionalModules)
        ? uiText('meta.optional.value', { count: optionalModules.length })
        : uiText('common.unknown'),
      rate: rate.fresh_audits && rate.window_hours ? uiText('meta.rate.value', { count: rate.fresh_audits, hours: rate.window_hours }) : uiText('common.unknown'),
      license: meta.license || 'MIT',
      source: meta.source_url || 'GitHub',
    };
    document.querySelectorAll('[data-meta-fact]').forEach(el => {
      const key = el.dataset.metaFact;
      if (key === 'source') {
        el.href = values.source;
        el.textContent = 'GitHub';
      } else if (values[key] != null) {
        el.textContent = values[key];
      }
    });
    if (status) status.textContent = '';
  } catch {
    if (status) status.textContent = uiText('meta.unavailable');
  }
}
loadProductMeta();

// ── "How it works?" modal ─────────────────────────────────────────────────
const hiwModal  = document.getElementById('hiw-modal');
const hiwClose  = document.getElementById('hiw-close');

if (hiwClose) hiwClose.addEventListener('click', () => hiwModal?.classList.add('hidden'));
if (hiwModal) {
  hiwModal.addEventListener('click', (e) => { if (e.target === hiwModal) hiwModal.classList.add('hidden'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hiwModal.classList.add('hidden'); });
}

// Global keyboard shortcut: '/' focuses search input (like GitHub/YouTube)
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
    e.preventDefault();
    const si = document.getElementById('search-input');
    if (si) { si.focus(); si.select(); si.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }
});

document.querySelectorAll('.hiw-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.hiw-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.hiw-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`)?.classList.add('active');
  });
});

// ── URL parameter auto-start (?d=stripe.com or ?domain=stripe.com) ────────
// Deferred to end of script via setTimeout(0) so all let/const at file scope
// are initialised before startAudit() runs (avoids TDZ ReferenceErrors).
(function () {
  const params = new URLSearchParams(location.search);
  const d      = params.get('d') || params.get('domain');
  const mode   = params.get('mode');
  const target = params.get('url');
  const archetypeHint = params.get('archetype_hint');
  const share  = params.get('share');
  if (share) {
    // Shareable report view — load cached audit without re-running
    setTimeout(() => loadSharedAudit(share), 0);
  } else if (d || (mode === 'url' && target)) {
    const input = mode === 'url' && target ? target : d;
    setTimeout(() => {
      const si = document.getElementById('search-input');
      if (si) si.value = input;
      startAudit(input, { archetypeHint });
    }, 0);
  }
})();

// ── Social proof: fetch audit count + recently scanned feed ──────────────
(function () {
  const el = document.getElementById('audits-count');
  fetch(`${API}/api/stats`).then(r => r.json()).then(({ audits }) => {
    if (el && audits) {
      const formatted = audits >= 1000 ? (audits / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : audits;
      el.textContent = UI_LANGUAGE === 'zh' ? `${formatted}+ 个站点已审查` : `${formatted}+ sites audited`;
    }
  }).catch(() => {});

})();

// ── Progress counter ──────────────────────────────────────────────────────
const PROGRESS_MODULES = new Set([
  'technical_seo','schema_audit','content_quality','authority','geo_predicted',
  'on_page_seo','accessibility','crux','robots_sitemap','mobile_audit',
  'html_validator','common_crawl',
  // 'lighthouse' intentionally excluded — runs via /api/lighthouse after complete event
]);
const TOTAL_MODULES = PROGRESS_MODULES.size;
let modulesComplete = 0;
let computedSectionsRendered = false;
let auditStartTime = 0;
let auditTimerInterval = null;

const MODULE_LOADING_KEY = {
  technical_seo: 'progress.fetch',
  schema_audit: 'progress.schema',
  content_quality: 'progress.content',
  authority: 'progress.authority',
  geo_predicted: 'progress.predicted',
  on_page_seo: 'progress.page',
  off_page_seo: 'progress.authority',
  site_intel: 'progress.fetch',
  redirect_chain: 'progress.fetch',
  accessibility: 'progress.accessibility',
  security_audit: 'progress.fetch',
  ssl_cert: 'progress.fetch',
  domain_intel: 'progress.fetch',
  crux: 'progress.crux',
  keywords: 'progress.content',
  html_validator: 'progress.validator',
  common_crawl: 'progress.crawl',
  lighthouse: 'progress.pagespeed',
};

const MODULE_CATEGORY = {
  technical_seo: 'seo', schema_audit: 'seo', content_quality: 'seo',
  on_page_seo: 'seo', accessibility: 'seo',
  geo_predicted: 'geo', ai_content_insights: 'geo',
  security_audit: 'seo', ssl_cert: 'seo',
  authority: 'authority', off_page_seo: 'authority',
  site_intel: 'site_intel', redirect_chain: 'site_intel',
  domain_intel: 'seo', crux: 'seo', lighthouse: 'seo',
  html_validator: 'seo', common_crawl: 'authority',
};

// Data source attribution — shown as trust badge on each module card header
const MODULE_SOURCE = {
  technical_seo:   { label: 'Live fetch · robots · sitemap', cls: 'src-blue' },
  schema_audit:    { label: 'HTML parse · JSON-LD',          cls: 'src-slate' },
  content_quality: { label: 'HTML parse',                    cls: 'src-slate' },
  authority:       { label: 'Wayback · Wikipedia · OPR',    cls: 'src-green' },
  geo_predicted:   { label: 'Predicted · AI/API',                 cls: 'src-purple' },
  on_page_seo:     { label: 'HTML parse · semantic checks', cls: 'src-slate' },
  off_page_seo:    { label: 'DNS · Social scrape',           cls: 'src-teal' },
  site_intel:      { label: 'ipinfo · DoH DNS',              cls: 'src-slate' },
  redirect_chain:  { label: 'Live HTTP trace',               cls: 'src-blue' },
  accessibility:   { label: 'WCAG parse · sampled HTML',     cls: 'src-slate' },
  security_audit:  { label: 'Mozilla Observatory',           cls: 'src-orange' },
  ssl_cert:        { label: 'crt.sh CT log',                 cls: 'src-green' },
  domain_intel:    { label: 'RDAP · Cloudflare DoH',         cls: 'src-blue' },
  crux:            { label: 'Google CrUX API',               cls: 'src-green' },
  keywords:        { label: 'Autocomplete · AI/API',         cls: 'src-purple' },
  robots_sitemap:  { label: 'Live fetch · XML parse',         cls: 'src-blue' },
  broken_links:    { label: 'Live HTTP checks',               cls: 'src-blue' },
  mobile_audit:    { label: 'HTML parse',                     cls: 'src-slate' },
  html_validator:  { label: 'W3C Nu HTML Checker',            cls: 'src-blue' },
  common_crawl:    { label: 'Common Crawl Index',             cls: 'src-green' },
  lighthouse:      { label: 'Google PageSpeed Insights API',  cls: 'src-blue' },
};

// Display order: most verifiable data first → least certain last.
// Principle: every card a user sees should earn its place with accuracy.
// Tier 1: Direct network/DNS measurements (always 100% factual)
// Tier 2: Real Chrome user data (measured by Google from millions of real visits)
// Tier 3: HTTP response analysis (fetched directly from the server)
// Tier 4: Verified third-party databases (domain age, Wikipedia, Common Crawl)
// Tier 5: HTML content analysis (accurate when page is accessible, suppressed if bot-blocked)
// Tier 6: AI inference & predictions (model-generated, lower certainty)
// Tier 7: Tools & actions
const CARD_ORDER = {
  // ── Summary (always pinned at top) ──────────────────────────────────
  'plain-english-report':        3,

  'card-site-intro':             7,   // Website identity brief (generated from factual signals)

  // ── Tier 1: Direct network measurements (ground truth) ──────────────
  // HTTP redirect hops, TLS cert, WHOIS/DNS, hosting IP — zero interpretation
  'module-redirect_chain':       10,   // HTTP redirect hops & HTTPS enforcement
  'module-ssl_cert':             12,   // TLS certificate validity & issuer
  'module-domain_intel':         14,   // WHOIS: registrar, expiry, DNSSEC, SPF/DMARC
  'card-dns':                    16,   // DNS A / MX / NS / AAAA records
  'module-site_intel':           18,   // IP, hosting provider, third-party scripts
  'card-tech-stack':             20,   // CMS, CDN, framework detected from response
  'card-robots':                 22,   // robots.txt content (fetched directly)
  'card-email-ads':              24,   // SPF record, ads.txt presence

  // ── Tier 2: Real Chrome user data ───────────────────────────────────
  // 28-day rolling measurements from millions of real visits (Google CrUX)
  'module-crux':                 28,   // Core Web Vitals — real user data
  'card-speed':                  30,   // PageSpeed breakdown
  'card-mobile':                 32,   // Mobile usability

  // ── Tier 3: HTTP response analysis ──────────────────────────────────
  // Data extracted directly from the fetched server response
  'module-technical_seo':        38,   // Robots, HTTPS, meta tags, compression
  'card-serp-preview':           40,   // Google snippet (from fetched title/description)
  'card-social-preview':         42,   // OG/Twitter card (from fetched HTML)
  'card-international-seo':      44,   // lang attribute, hreflang tags
  'module-security_audit':       46,   // HTTP security headers (factual header scan)

  // ── Tier 4: Verified third-party data ───────────────────────────────
  // External databases cross-referenced for factual signals
  'module-authority':            52,   // Domain age, Wikipedia, Common Crawl backlinks
  'module-off_page_seo':         56,   // Email security (DNS), social profiles (HTML)

  // ── Tier 5: HTML content analysis ───────────────────────────────────
  // Accurate when page is accessible; suppressed entirely when bot-blocked
  'module-schema_audit':         62,   // JSON-LD structured data extracted from HTML
  'card-structured-data':        64,   // Raw JSON-LD detail
  'module-content_quality':      68,   // Word count, headings, links, readability
  'card-readability':            70,   // Flesch reading ease score
  'card-headings':               72,   // Heading hierarchy (H1–H6)
  'module-on_page_seo':          76,   // Image, link & heading analysis
  'card-image-alt':              78,   // Alt text audit
  'card-fonts':                  80,   // Web font analysis
  'module-accessibility':        84,   // WCAG pattern checks

  // ── Tier 6: AI inference & predictions ──────────────────────────────
  // Model-generated estimates — lower certainty, shown after all factual data
  'module-geo_predicted':        90,   // AI citation simulation
  'card-ai-business':            91,   // AI business context
  'card-ai-content':             92,   // AI content analysis
  'card-ai-trust':               93,   // AI trust signals
  'card-ai-freshness':           94,   // AI freshness analysis
  'card-ai-opportunities':       95,   // AI quick wins
  'card-eeat':                   96,   // E-E-A-T signals (partially inferred)
  'card-keyword-research':       97,   // AI keyword suggestions
  'module-ai_content_insights':  98,   // AI content insights

  // ── Tier 5b: Crawlability, images & mobile ──────────────────────────
  'module-robots_sitemap':       74,   // robots.txt + sitemap check
  'module-broken_links':         81,   // Broken link checker
  'module-mobile_audit':         83,   // Mobile readiness check

  // ── Tier 7: Tools & actions ──────────────────────────────────────────
  'card-llms-gen':              105,   // llms.txt file generator
  'card-schema-gen':            106,   // JSON-LD schema generator
  'card-geo-probe':              99,   // AI entity visibility probe
  'card-keywords-cloud':        110,   // Page keyword frequency cloud
  'card-competitor':            115,   // Competitor comparison
  'recs-section':               120,   // Full prioritised recommendation list
  'card-embed-code':            125,   // Embed widget
};
function cardOrder(id) { return CARD_ORDER[id] ?? 500; }

function scoreContext(score) {
  if (reportLanguage === 'zh') {
    if (score >= 80) return '事实就绪度较强';
    if (score >= 60) return '事实就绪度中等';
    if (score >= 40) return '事实就绪度有限';
    return '需要优先修复';
  }
  if (score >= 80) return 'Strong factual readiness';
  if (score >= 60) return 'Moderate factual readiness';
  if (score >= 40) return 'Limited factual readiness';
  return 'Prioritise repairs';
}

function effortTime(effort) {
  return ['', '⚡ ~15 min', '🕐 ~30 min', '🕑 1–2 hrs', '📅 Half day', '📅 Multi-day'][effort] ?? '';
}

function fmtSecs(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
}

function initProgress() {
  modulesComplete = 0;
  auditStartTime = Date.now();
  const bar = document.getElementById('progress-bar');
  const fill = document.getElementById('progress-fill');
  const label = document.getElementById('progress-label');
  const timer = document.getElementById('audit-timer');
  if (bar) bar.classList.remove('hidden');
  if (fill) fill.style.width = '0%';
  if (label) label.textContent = uiText('progress.modules', { done: 0, total: TOTAL_MODULES });
  if (timer) timer.textContent = '0s';

  // Clear any previous timer before starting a new one
  if (auditTimerInterval) clearInterval(auditTimerInterval);
  auditTimerInterval = setInterval(() => {
    const elapsed = Date.now() - auditStartTime;
    const timerEl = document.getElementById('audit-timer');
    if (timerEl) timerEl.textContent = fmtSecs(elapsed);

    // Update each running module's live elapsed display
    document.querySelectorAll('.module-elapsed').forEach(el => {
      const startMs = Number(el.dataset.startMs);
      if (startMs) el.textContent = fmtSecs(Date.now() - startMs);
    });
  }, 1000);
}

function stopAuditTimer() {
  if (auditTimerInterval) { clearInterval(auditTimerInterval); auditTimerInterval = null; }
}

function tickProgress() {
  modulesComplete = Math.min(modulesComplete + 1, TOTAL_MODULES);
  const pct = Math.round((modulesComplete / TOTAL_MODULES) * 100);
  const fill = document.getElementById('progress-fill');
  const label = document.getElementById('progress-label');
  if (fill) fill.style.width = `${pct}%`;
  if (label) label.textContent = uiText('progress.modules', { done: modulesComplete, total: TOTAL_MODULES });
  if (modulesComplete >= TOTAL_MODULES) {
    stopAuditTimer();
    setTimeout(() => { const bar = document.getElementById('progress-bar'); if (bar) bar.classList.add('hidden'); }, 1200);
  }
}
let sessionId = localStorage.getItem('session_id') || crypto.randomUUID();
try { localStorage.setItem('session_id', sessionId); } catch { /* Safari private mode */ }

// ── Semantic Search (Transformers.js v3 + WebGPU) ─────────────────────────
// BGE-Small-EN-v1.5 ONNX (33 MB) runs on WebGPU via ONNX Runtime Web.
// Same model family as @cf/baai/bge-small-en-v1.5 in Workers AI — vector
// spaces are compatible, so embeddings can be compared cross-environment.
// Swap SEMANTIC_MODEL to 'onnx-community/Ternary-Bonsai-1.7B' once that
// ONNX conversion is published on HuggingFace Hub (not yet available).

const SEMANTIC_MODEL = 'Xenova/bge-small-en-v1.5';
const SEM_IDB = 'geo_audit_sem';
const SEM_STORE = 'vecs';

let embedder = null;
let allBusinesses = [];
let businessVecs = null;  // Float32Array[] parallel to allBusinesses
let semanticReady = false;

// BGE normalises vectors to unit length, so dot product = cosine similarity
function dotSim(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function idbOp(mode, key, val) {
  return new Promise((resolve) => {
    const req = indexedDB.open(SEM_IDB, 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore(SEM_STORE);
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction(SEM_STORE, mode);
      const r = mode === 'readonly'
        ? tx.objectStore(SEM_STORE).get(key)
        : tx.objectStore(SEM_STORE).put(val, key);
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  });
}

async function embedBatch(texts) {
  const out = await embedder(texts, { pooling: 'mean', normalize: true });
  const dim = out.dims[out.dims.length - 1];
  return Array.from({ length: texts.length }, (_, i) =>
    new Float32Array(out.data.slice(i * dim, (i + 1) * dim))
  );
}

async function initSemanticSearch() {
  if (!navigator.gpu) return;
  try {
    setSemanticBadge('loading');

    const { pipeline, env } = await import(
      'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/transformers.min.js'
    );
    env.allowLocalModels = false;
    env.useBrowserCache = true;

    embedder = await pipeline('feature-extraction', SEMANTIC_MODEL, {
      device: 'webgpu',
      dtype: 'q8',
    });

    const r = await fetch(`${API}/api/businesses`);
    allBusinesses = r.ok ? await r.json() : [];
    if (!allBusinesses.length) { setSemanticBadge('off'); return; }

    // Restore pre-computed business embeddings from IndexedDB if available
    const cacheKey = `${SEMANTIC_MODEL}@${allBusinesses.length}`;
    const hit = await idbOp('readonly', cacheKey);
    if (hit) {
      businessVecs = hit.map(arr => new Float32Array(arr));
    } else {
      // Embed all businesses in batches of 16 (background, non-blocking for UI)
      const texts = allBusinesses.map(
        b => `${b.name} ${b.category || ''} ${b.city || ''}`.replace(/\s+/g, ' ').trim()
      );
      businessVecs = [];
      for (let i = 0; i < texts.length; i += 16) {
        businessVecs.push(...await embedBatch(texts.slice(i, i + 16)));
      }
      // Persist — serialise Float32Arrays to plain arrays for structured clone
      idbOp('readwrite', cacheKey, businessVecs.map(v => Array.from(v)));
    }

    semanticReady = true;
    setSemanticBadge('ready');
  } catch (err) {
    console.warn('[semantic]', err?.message ?? err);
    setSemanticBadge('off');
  }
}

function setSemanticBadge(state) {
  const el = document.getElementById('semantic-badge');
  if (!el) return;
  el.className = 'text-xs px-2 py-0.5 rounded';
  if (state === 'loading') {
    el.textContent = `⚡ ${uiText('semantic.loading')}`;
    el.classList.add('bg-amber-50', 'text-amber-600');
  } else if (state === 'ready') {
    el.textContent = `⚡ ${uiText('semantic.ready')}`;
    el.classList.add('bg-green-50', 'text-green-700', 'font-medium');
  } else {
    el.textContent = '';
  }
}

async function semanticSearch(q, topK = 8) {
  if (!semanticReady || !embedder || !businessVecs) return null;
  try {
    const out = await embedder(q, { pooling: 'mean', normalize: true });
    const qvec = new Float32Array(out.data);
    const scored = allBusinesses.map((b, i) => ({ ...b, _sim: dotSim(qvec, businessVecs[i]) }));
    scored.sort((a, b) => b._sim - a._sim);
    return scored.filter(b => b._sim > 0.25).slice(0, topK);
  } catch {
    return null;
  }
}

// Kick off model loading in background — doesn't block page render
initSemanticSearch();
// Show recent audit history on page load
renderRecentAudits();

// ── Scroll-to-top ──────────────────────────────────────────────────────────
{
  const scrollTopBtn = document.getElementById('scroll-top');
  if (scrollTopBtn) {
    window.addEventListener('scroll', () => {
      const show = window.scrollY > 400;
      if (show) { scrollTopBtn.classList.remove('hidden'); scrollTopBtn.classList.add('flex'); }
      else       { scrollTopBtn.classList.add('hidden');   scrollTopBtn.classList.remove('flex'); }
    }, { passive: true });
    scrollTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }
}

// ── Collapsible card toggle ────────────────────────────────────────────────
// rotated = card collapsed (chevron points up, body hidden)
function toggleCardBody(headerEl) {
  const body = headerEl.parentElement.querySelector('.card-body');
  if (!body) return;
  const isNowHidden = body.classList.toggle('hidden');
  headerEl.querySelector('.chevron')?.classList.toggle('rotated', isNowHidden);
}

// ── Recent audits ──────────────────────────────────────────────────────────
function saveRecentAudit(domain) {
  try {
    const key = 'geoscore:recent';
    let recent = JSON.parse(localStorage.getItem(key) || '[]');
    recent = recent.filter(d => d !== domain);
    recent.unshift(domain);
    localStorage.setItem(key, JSON.stringify(recent.slice(0, 5)));
  } catch { /* non-critical */ }
}

function renderRecentAudits() {
  try {
    const wrap = document.getElementById('recent-audits-wrap');
    if (!wrap) return;
    const recent = JSON.parse(localStorage.getItem('geoscore:recent') || '[]');
    if (!recent.length) { wrap.classList.add('hidden'); return; }
    wrap.innerHTML = `<div class="flex items-center gap-2 flex-wrap justify-center">
      <span class="text-xs text-slate-400 shrink-0">Recent:</span>
      ${recent.map(d => `<button data-quick="${esc(d)}"
        class="inline-flex items-center gap-1.5 text-xs bg-white border border-slate-200 hover:border-blue-300 hover:text-blue-600 px-2.5 py-1 rounded-full transition-colors font-medium text-slate-600 shadow-sm">
        <img src="https://www.google.com/s2/favicons?sz=16&domain_url=${encodeURIComponent(d)}" alt="" class="w-3.5 h-3.5 rounded-sm" onerror="this.style.display='none'">
        ${esc(d)}
      </button>`).join('')}
    </div>`;
    wrap.classList.remove('hidden');
  } catch { /* non-critical */ }
}

function parsePublicDomainInput(rawInput) {
  return REPORT_UI?.parseAuditInput(rawInput) ?? {
    domain: '', mode: 'site', targetUrl: null, ok: false, reason: 'Only public domains are supported',
  };
}

// ── Category tab counts ────────────────────────────────────────────────────
// Store original labels on first call so counts can be reset
const _catTabOriginalLabels = new Map();
function updateCatTabCounts() {
  // Initialise label cache once
  document.querySelectorAll('.cat-tab').forEach(tab => {
    if (!_catTabOriginalLabels.has(tab.dataset.cat)) {
      _catTabOriginalLabels.set(tab.dataset.cat, tab.textContent.trim());
    }
  });
  // Count visible cards per category
  const counts = {};
  document.querySelectorAll('#modules > [data-category]').forEach(el => {
    if (el.style.display === 'none') return;
    const cat = el.dataset.category;
    if (cat) counts[cat] = (counts[cat] || 0) + 1;
  });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  document.querySelectorAll('.cat-tab').forEach(tab => {
    const cat = tab.dataset.cat;
    const label = _catTabOriginalLabels.get(cat) || tab.textContent.replace(/\s*\(\d+\)\s*$/, '');
    const count = cat === 'all' ? total : (counts[cat] || 0);
    tab.textContent = count > 0 ? `${label} (${count})` : label;
  });
}

// ── Rec checkbox: mark as done ─────────────────────────────────────────────
function getRecDoneSet(domain) {
  try { return new Set(JSON.parse(localStorage.getItem(`geoscore:rec-done:${domain}`) || '[]')); }
  catch { return new Set(); }
}
function saveRecDoneSet(domain, set) {
  try { localStorage.setItem(`geoscore:rec-done:${domain}`, JSON.stringify([...set])); } catch { }
}

document.addEventListener('change', (e) => {
  const cb = e.target.closest('.rec-checkbox');
  if (!cb) return;
  const li = cb.closest('li');
  const done = getRecDoneSet(currentDomain);
  const title = cb.dataset.title;
  if (cb.checked) {
    done.add(title);
    li?.classList.add('rec-done');
  } else {
    done.delete(title);
    li?.classList.remove('rec-done');
  }
  saveRecDoneSet(currentDomain, done);
});

// OG image load-error fallback (capture phase — works without inline onerror)
document.addEventListener('error', (e) => {
  if (e.target.tagName !== 'IMG' || !e.target.classList.contains('og-preview-img')) return;
  const wrapper = e.target.parentElement;
  if (wrapper) wrapper.innerHTML = '<div class="h-full min-h-[8rem] flex items-center justify-center bg-slate-100 text-slate-400 text-xs p-2">Image could not be loaded</div>';
}, true);

// ── Category tabs ─────────────────────────────────────────────────────────
document.addEventListener('click', (e) => {
  const tab = e.target.closest('.cat-tab');
  if (!tab) return;
  document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  const cat = tab.dataset.cat;
  document.querySelectorAll('#modules > [data-category]').forEach(el => {
    el.style.display = (cat === 'all' || el.dataset.category === cat) ? '' : 'none';
  });
  // Recommendations always visible
  const recs = document.getElementById('recs-section');
  if (recs) recs.style.display = '';
});

// ── Quick-search shortcuts ────────────────────────────────────────────────

function quickSearch(domain) {
  searchInput.value = domain;
  suggestions.classList.add('hidden');
  startAudit(domain);
}

document.addEventListener('click', (e) => {
  const languageButton = e.target.closest('[data-report-lang]');
  if (languageButton) {
    reportLanguage = REPORT_UI?.language(languageButton.dataset.reportLang) ?? 'en';
    reportLanguageManuallySet = true;
    I18N?.setReportLanguage?.(reportLanguage);
    applyReportLanguageLabels();
    renderEvidenceFirstSummary(currentAuditData);
    renderScoreSummaryNote(currentAuditData);
    renderEvidenceReportSections(currentAuditData);
    renderEvidenceCheckSummaryBar(currentAuditData);
    updatePerformanceContext(currentAuditData);
    if (currentLighthouseState) renderLighthouseState(currentLighthouseState);
    return;
  }

  const lighthouseRetry = e.target.closest('[data-action="retry-lighthouse"]');
  if (lighthouseRetry) {
    const domain = lighthouseRetry.dataset.domain || currentDomain;
    if (domain) fetchLighthouse(domain);
    return;
  }

  const quick = e.target.closest('[data-quick]');
  if (quick) { quickSearch(quick.dataset.quick); return; }

  const fix = e.target.closest('[data-action="toggle-fix"]');
  if (fix) { toggleWhatToDo(fix); return; }

  // Clipboard copy — any element with data-copy="text to copy"
  const copyEl = e.target.closest('[data-copy]');
  if (copyEl) {
    const text = copyEl.dataset.copy;
    navigator.clipboard.writeText(text).then(() => {
      const orig = copyEl.textContent;
      copyEl.textContent = '✓ Copied';
      setTimeout(() => { copyEl.textContent = orig; }, 2000);
    });
    return;
  }

  // Card collapse toggle — replaces onclick="toggleCardBody(this)"
  const cardToggle = e.target.closest('[data-action="toggle-card"]');
  if (cardToggle) { toggleCardBody(cardToggle); return; }

  const archetypeCorrection = e.target.closest('[data-action="correct-archetype"]');
  if (archetypeCorrection) {
    openArchetypeCorrection(archetypeCorrection.dataset.domain, archetypeCorrection.dataset.archetype);
    return;
  }

  // Competitor compare button — replaces onclick="runCompetitorComparison()"
  const compareBtn = e.target.closest('[data-action="compare"]');
  if (compareBtn) { runCompetitorComparison(); return; }

  // llms.txt generator
  if (e.target.id === 'llms-gen-btn') {
    handleLlmsGen(e.target);
    return;
  }
  if (e.target.id === 'llms-copy-btn') {
    const text = document.getElementById('llms-gen-text')?.textContent ?? '';
    navigator.clipboard.writeText(text).then(() => {
      e.target.textContent = '✓ Copied!';
      setTimeout(() => { e.target.textContent = 'Copy'; }, 2000);
    });
    return;
  }
  if (e.target.id === 'llms-view-btn') {
    handleLlmsView(e.target);
    return;
  }

  // Schema JSON-LD generator
  if (e.target.id === 'schema-gen-btn') { handleSchemaGen(e.target); return; }
  if (e.target.id === 'schema-copy-btn') {
    const text = document.getElementById('schema-gen-text')?.textContent ?? '';
    navigator.clipboard.writeText(text).then(() => {
      e.target.textContent = '✓ Copied!';
      setTimeout(() => { e.target.textContent = 'Copy'; }, 2000);
    });
    return;
  }

  // GEO entity probe
  if (e.target.id === 'geo-probe-btn') { handleGeoProbe(e.target); return; }

  // OG image download
  if (e.target.id === 'og-download-btn') {
    downloadOgImage(e.target);
    return;
  }

  // SERP snippet optimiser
  if (e.target.id === 'serp-gen-btn') {
    handleSerpGen(e.target);
    return;
  }
  if (e.target.id === 'serp-copy-title-btn') {
    const text = document.getElementById('serp-gen-title')?.textContent ?? '';
    navigator.clipboard.writeText(text).then(() => {
      e.target.textContent = '✓ Copied!';
      setTimeout(() => { e.target.textContent = 'Copy title'; }, 2000);
    });
    return;
  }
  if (e.target.id === 'serp-copy-desc-btn') {
    const text = document.getElementById('serp-gen-desc')?.textContent ?? '';
    navigator.clipboard.writeText(text).then(() => {
      e.target.textContent = '✓ Copied!';
      setTimeout(() => { e.target.textContent = 'Copy description'; }, 2000);
    });
    return;
  }
});

async function handleLlmsGen(btn) {
  const output = document.getElementById('llms-gen-output');
  const textEl = document.getElementById('llms-gen-text');
  const copyBtn = document.getElementById('llms-copy-btn');
  if (!output || !textEl) return;

  btn.disabled = true;
  output.classList.remove('hidden');
  textEl.textContent = '';

  const genStart = Date.now();
  const genTimer = setInterval(() => {
    btn.textContent = `⏳ Generating… ${fmtSecs(Date.now() - genStart)}`;
  }, 1000);
  btn.textContent = '⏳ Generating… 0s';

  try {
    const res = await fetch(`${API}/api/llms-gen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: btn.dataset.domain,
        vertical: btn.dataset.vertical,
        keywords: (btn.dataset.keywords || '').split(',').filter(Boolean),
        schemas: (btn.dataset.schemas || '').split(',').filter(Boolean),
      }),
    });

    if (!res.ok || !res.body) throw new Error('Generation failed');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let raw = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value).split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;
        try { raw += JSON.parse(payload).response ?? ''; } catch { /* skip */ }
      }
      textEl.textContent = raw;
      const _pre = output.querySelector('pre');
      if (_pre) _pre.scrollTop = 9999;
    }

    clearInterval(genTimer);
    if (copyBtn) copyBtn.classList.remove('hidden');
    btn.textContent = `↻ Re-generate (took ${fmtSecs(Date.now() - genStart)})`;
  } catch {
    clearInterval(genTimer);
    textEl.textContent = 'Generation failed — AI may be unavailable. Try again.';
    btn.textContent = '✨ Generate llms.txt';
  } finally {
    btn.disabled = false;
  }
}

async function handleLlmsView(btn) {
  const output = document.getElementById('llms-gen-output');
  const textEl = document.getElementById('llms-gen-text');
  const copyBtn = document.getElementById('llms-copy-btn');
  if (!output || !textEl) return;

  // Toggle: if already showing fetched content, hide it
  if (btn.dataset.showing === '1') {
    output.classList.add('hidden');
    if (copyBtn) copyBtn.classList.add('hidden');
    btn.dataset.showing = '0';
    btn.textContent = '👁 View existing';
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳ Loading…';
  output.classList.remove('hidden');
  textEl.textContent = 'Fetching llms.txt…';

  try {
    const res = await fetch(`${API}/api/fetch-llms?domain=${encodeURIComponent(btn.dataset.domain)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    const text = await res.text();
    textEl.textContent = text;
    if (copyBtn) copyBtn.classList.remove('hidden');
    btn.dataset.showing = '1';
    btn.textContent = '✕ Hide';
  } catch (err) {
    textEl.textContent = `Could not fetch llms.txt: ${err.message}`;
    btn.dataset.showing = '0';
    btn.textContent = '👁 View existing';
  } finally {
    btn.disabled = false;
  }
}

// ── Shareable report loader ────────────────────────────────────────────────

async function loadSharedAudit(domain) {
  const si = document.getElementById('search-input');
  if (si) si.value = domain;

  // Show a loading indicator
  const resultsEl = document.getElementById('results');
  if (resultsEl) resultsEl.classList.remove('hidden');
  const progressEl = document.getElementById('progress-bar-wrap');
  if (progressEl) progressEl.classList.remove('hidden');

  try {
    const res = await fetch(`${API}/api/share/${encodeURIComponent(domain)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();

    // Reuse the full audit rendering pipeline — same as a live audit completing
    if (progressEl) progressEl.classList.add('hidden');
    renderFullAudit(data);

    // Update URL so refreshing stays on share view
    history.replaceState(null, '', `?share=${encodeURIComponent(domain)}`);

    // Show a "shared view" notice
    const noticeEl = document.createElement('div');
    noticeEl.className = 'text-xs text-slate-400 text-center mt-2 fade-in';
    noticeEl.textContent = `📤 Viewing saved audit for ${domain} · Run a new audit to get fresh results`;
    document.getElementById('modules')?.prepend(noticeEl);

  } catch (err) {
    if (progressEl) progressEl.classList.add('hidden');
    const errEl = document.getElementById('error-message');
    if (errEl) {
      errEl.textContent = `Could not load shared audit: ${err.message}`;
      errEl.classList.remove('hidden');
    }
  }
}

// ── AI Agent Markdown Export ──────────────────────────────────────────────
// Generates a single-prompt markdown file optimised for AI coding agents.
// Works as a paste-into-Lovable prompt OR a Claude Code / Cursor context file.

function detectStack(data) {
  // Detect framework from site_intel third-party scripts or technical_seo hints
  const techData = data?.modules?.technical_seo?.data ?? {};
  const siteIntel = data?.modules?.site_intel?.data ?? {};
  const scripts = (siteIntel.third_party?.script_domains ?? []).join(' ').toLowerCase();
  const cms = (techData.cms ?? '').toLowerCase();
  if (cms.includes('wordpress') || cms.includes('wp')) return 'wordpress';
  if (cms.includes('shopify')) return 'shopify';
  if (cms.includes('webflow')) return 'webflow';
  if (cms.includes('wix')) return 'wix';
  if (cms.includes('squarespace')) return 'squarespace';
  if (cms.includes('next') || scripts.includes('next')) return 'nextjs';
  if (cms.includes('nuxt')) return 'nuxt';
  if (cms.includes('astro')) return 'astro';
  if (cms.includes('gatsby')) return 'gatsby';
  if (cms.includes('remix')) return 'remix';
  // Vite SPA heuristic: no CMS detected, has JS bundle
  return 'vite'; // safest generic default for modern SPAs
}

function stackHeadFile(stack) {
  const map = {
    nextjs: '`app/layout.tsx` (or `pages/_document.tsx` for Pages Router)',
    nuxt: '`nuxt.config.ts` useHead / `app.vue` <Head>',
    astro: 'your layout `.astro` file `<head>` section',
    gatsby: '`gatsby-ssr.js` or your layout component',
    remix: 'your root `app/root.tsx` <head> section',
    wordpress: 'your theme\'s `header.php` or an SEO plugin (Yoast/RankMath)',
    shopify: 'your theme\'s `theme.liquid` `<head>` section',
    webflow: 'Webflow → Pages → Custom Code → Head Code',
    wix: 'Wix → Settings → Custom Code → Head',
    squarespace: 'Settings → Advanced → Code Injection → Header',
    vite: '`index.html` `<head>` section',
  };
  return map[stack] ?? '`index.html` or your root layout `<head>`';
}

function stackPublicDir(stack) {
  const map = {
    nextjs: '`public/`',
    nuxt: '`public/`',
    astro: '`public/`',
    gatsby: '`static/`',
    remix: '`public/`',
    wordpress: 'your domain root (upload via FTP or File Manager)',
    shopify: 'Assets section (or via Shopify Files)',
    webflow: 'Upload to Webflow Hosting → Custom Code',
    wix: 'Wix doesn\'t support custom robots.txt — use Wix SEO settings',
    squarespace: 'Squarespace doesn\'t support custom robots.txt — use their SEO panel',
    vite: '`public/`',
  };
  return map[stack] ?? '`public/`';
}

function stackHeadersFile(stack) {
  if (stack === 'nextjs') return '`next.config.js` `headers()` export';
  if (stack === 'nuxt') return '`nuxt.config.ts` `routeRules`';
  if (stack === 'astro') return '`public/_headers` (Netlify/CF Pages) or `astro.config.mjs` headers';
  if (['gatsby','remix','vite'].includes(stack)) return '`public/_headers` (Cloudflare Pages/Netlify) or `vercel.json`';
  return 'your server / hosting provider headers config';
}

function generateEvidenceAgentMarkdown(data) {
  return REPORT_UI.generateFullRepairMarkdown(data, reportLanguage);
}

function generateAgentMarkdown(data) {
  if (data?.score_summary) return generateEvidenceAgentMarkdown(data);
  const domain   = data?.domain ?? '';
  const seo      = data?.seo_score  ?? data?.foundation_score ?? 0;
  const geo      = data?.geo_score  ?? data?.weakness_score   ?? 0;
  const overall  = data?.overall_score ?? Math.round(seo * 0.55 + geo * 0.45);
  const mods     = data?.modules ?? {};
  const date     = new Date().toISOString().slice(0, 10);
  const stack    = detectStack(data);
  const headFile = stackHeadFile(stack);
  const pubDir   = stackPublicDir(stack);
  const hdrFile  = stackHeadersFile(stack);

  const tech     = mods.technical_seo?.data ?? {};
  const meta     = tech.page_meta ?? {};
  const schema   = mods.schema_audit?.data ?? {};
  const robots   = mods.robots_sitemap?.data ?? {};
  const rt       = robots.robots_txt ?? {};
  const sm       = robots.sitemap ?? {};
  const offPage  = mods.off_page_seo?.data ?? {};
  const security = mods.security_audit?.data ?? {};
  const imgAudit = tech.image_audit ?? {};
  const mobileData = mods.mobile_audit?.data ?? null;
  const mobile   = mobileData ?? {};
  const content  = mods.content_quality?.data ?? {};
  const bl       = mods.broken_links?.data ?? {};
  const brokenLinks = (bl.broken ?? []).filter(b => b.status !== null);

  // ── Detect what the site is (for schema type) ─────────────────────────
  const schemasFound = schema.schemas_found ?? [];
  const coverage = schema.coverage ?? {};
  const isPersonalEditorial = schema.site_type === 'editorial';
  const hasVisibleFaq = mods.on_page_seo?.data?.content?.has_faq === true;
  // Guess schema type from vertical detected in geo_predicted
  const vertical = mods.geo_predicted?.data?.vertical ?? mods.keywords?.data?.vertical ?? 'general';
  const schemaType =
    isPersonalEditorial && schemasFound.includes('Person') ? 'Person' :
    isPersonalEditorial ? 'Organization' :
    vertical === 'restaurant' || vertical === 'food_delivery' ? 'Restaurant' :
    vertical === 'dental' || vertical === 'medical' ? 'MedicalBusiness' :
    vertical === 'legal' ? 'LegalService' :
    vertical === 'real_estate' ? 'RealEstateAgent' :
    vertical === 'fitness' ? 'SportsActivityLocation' :
    vertical === 'hotel' ? 'Hotel' :
    schemasFound.includes('Product') || schemasFound.includes('SoftwareApplication') ? 'SoftwareApplication' :
    schemasFound.includes('LocalBusiness') ? 'LocalBusiness' :
    'Organization';

  // ── Build change list ─────────────────────────────────────────────────
  const changes = [];
  const dnsChanges = [];
  let changeNum = 0;

  function addChange(impact, title, body) {
    changes.push({ num: ++changeNum, impact, title, body });
  }

  // ── CRITICAL: bot/crawler blocks ───────────────────────────────────────
  if (rt.blocks_all) {
    addChange('🔴 CRITICAL', 'Un-block all crawlers in robots.txt',
`Your robots.txt has \`Disallow: /\` for all user-agents — this blocks Google and all search engines. Fix immediately.

Replace your robots.txt in ${pubDir} with:
\`\`\`
User-agent: *
Allow: /

Sitemap: https://${domain}/sitemap.xml
\`\`\``);
  }
  if (mobileData && !mobile.has_viewport_meta) {
    addChange('🔴 CRITICAL', 'Add viewport meta tag',
`The page is missing the viewport meta tag — it will not render correctly on mobile.

Add inside ${headFile}:
\`\`\`html
<meta name="viewport" content="width=device-width, initial-scale=1" />
\`\`\``);
  }

  // ── HIGH: schema markup ────────────────────────────────────────────────
  if (schemasFound.length === 0) {
    const schemaJson = JSON.stringify({
      "@context": "https://schema.org",
      "@type": schemaType,
      "name": meta.title ? meta.title.split(/[|—-]/)[0].trim() : domain,
      "url": `https://${domain}`,
      ...(meta.description ? { "description": meta.description } : {})
    }, null, 2);
    addChange('🟠 HIGH', `Add ${schemaType} JSON-LD schema markup`,
`No structured data found. Schema markup gives search and answer systems explicit entity facts; add only types and claims supported by this page.

Add this inside ${headFile} (before </head>):
\`\`\`html
<script type="application/ld+json">
${schemaJson}
</script>
\`\`\`

After adding, validate at: https://validator.schema.org`);
  } else if (!isPersonalEditorial && !coverage.FAQPage && hasVisibleFaq) {
    addChange('🟡 MEDIUM', 'Mark up the existing FAQ with FAQPage schema',
`A visible FAQ section was found, but no FAQPage schema was detected.

Add FAQPage JSON-LD beside the existing page schema using the exact questions and answers already published on the page. Do not create a synthetic FAQ just for markup. Validate the final JSON-LD at https://validator.schema.org.`);
  }

  // ── HIGH: static files ─────────────────────────────────────────────────
  if (mods.robots_sitemap?.data && !rt.exists) {
    addChange('🟠 HIGH', `Create robots.txt in ${pubDir}`,
`robots.txt is missing. Search engines use it for crawl guidance.

Create the file \`${pubDir.replace(/`/g,'')}/robots.txt\` with this exact content:
\`\`\`
User-agent: *
Allow: /

Sitemap: https://${domain}/sitemap.xml
\`\`\``);
  }

  if (mods.robots_sitemap?.data && !sm.exists) {
    addChange('🟠 HIGH', `Create sitemap.xml in ${pubDir}`,
`No sitemap found. A sitemap helps Google discover all your pages and is required for Google Search Console submission.

Create \`${pubDir.replace(/`/g,'')}/sitemap.xml\`:
\`\`\`xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://${domain}/</loc>
    <lastmod>${date}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <!-- Add a <url> block for every page on your site -->
</urlset>
\`\`\`

Then submit it at https://search.google.com/search-console`);
  }

  // ── HIGH: llms.txt ────────────────────────────────────────────────────
  if (mods.technical_seo?.data && REPORT_UI?.llmsTxtView?.(tech, reportLanguage)?.state === 'missing') {
    const titleBrand = meta.title ? meta.title.split(/[|—-]/)[0].trim() : domain;
    addChange('🟠 HIGH', `Create llms.txt in ${pubDir}`,
`llms.txt is an optional, human-readable content index. It can make important pages easier for automated readers to discover, but it is not a citation guarantee.

Create \`${pubDir.replace(/`/g,'')}/llms.txt\`:
\`\`\`
# ${titleBrand}
> ${meta.description ?? `${titleBrand} — visit https://${domain} to learn more.`}

## About
${titleBrand} is ${meta.description ?? 'a service available at ' + domain}.

## Key Pages
- [Home](https://${domain}/)

## Contact
- Website: https://${domain}
\`\`\``);
  }

  // ── HIGH: missing canonical & og tags ─────────────────────────────────
  const missingMeta = [];
  if ((tech.issues ?? []).some(i => i.includes('canonical'))) {
    missingMeta.push(`  <link rel="canonical" href="https://${domain}/" />`);
  }
  if ((tech.issues ?? []).some(i => i.includes('og:site_name'))) {
    const brand = meta.title ? meta.title.split(/[|—-]/)[0].trim() : domain;
    missingMeta.push(`  <meta property="og:site_name" content="${brand}" />`);
  }
  if (!meta.description || meta.description.trim() === '') {
    missingMeta.push(`  <meta name="description" content="One sentence describing what you offer and for whom. Keep under 160 characters." />`);
    missingMeta.push(`  <meta property="og:description" content="Same as above." />`);
  }
  if (missingMeta.length > 0) {
    addChange('🟠 HIGH', 'Add missing meta tags to <head>',
`Add these tags inside ${headFile}:
\`\`\`html
${missingMeta.join('\n')}
\`\`\``);
  }

  // ── HIGH: title issues ─────────────────────────────────────────────────
  if (meta.title && meta.title.length < 30) {
    addChange('🟠 HIGH', 'Expand page title — too short',
`Current title is only ${meta.title.length} characters: "${meta.title}"
Target: 30–70 characters. Include the primary keyword near the front.

In ${headFile}, update:
\`\`\`html
<title>Your Primary Keyword | ${meta.title}</title>
\`\`\``);
  }

  // ── HIGH: security headers ─────────────────────────────────────────────
  const missingHeaders = security.missing_headers ?? [];
  if (missingHeaders.length > 0 || (security.issues ?? []).some(i => i.includes('header'))) {
    if (stack === 'nextjs') {
      addChange('🟠 HIGH', 'Add security headers in next.config.js',
`Missing HTTP security headers: ${missingHeaders.length > 0 ? missingHeaders.join(', ') : 'CSP, X-Frame-Options, Referrer-Policy'}. These protect against XSS and clickjacking.

In \`next.config.js\` (or \`next.config.mjs\`), add a \`headers()\` export:
\`\`\`js
/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }];
  },
};
module.exports = nextConfig;
\`\`\``);
    } else {
      addChange('🟠 HIGH', `Add security headers via ${hdrFile}`,
`Missing security headers protect against XSS, clickjacking, and MIME-sniffing attacks.

Create \`public/_headers\` (for Cloudflare Pages or Netlify) with:
\`\`\`
/*
  X-Frame-Options: SAMEORIGIN
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
\`\`\`

Or for Vercel, add to \`vercel.json\`:
\`\`\`json
{
  "headers": [{
    "source": "/(.*)",
    "headers": [
      { "key": "X-Frame-Options", "value": "SAMEORIGIN" },
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
    ]
  }]
}
\`\`\``);
    }
  }

  // ── MEDIUM: content ────────────────────────────────────────────────────
  if ((content.word_count ?? 0) > 0 && (content.word_count ?? 0) < 400) {
    addChange('🟡 MEDIUM', 'Add more content to the homepage',
`Only ${content.word_count} words detected. ${isPersonalEditorial
  ? 'Expand only the pages that need real context; do not manufacture filler for a score.'
  : 'Pages with fewer than 400 words may be considered thin by Google.'}

Add substantive sections to the homepage:
- **What this page covers** and who wrote it
- **First-hand context** for the work, project, or topic
- **Links to primary material** where claims need support
- **Clear navigation** to related posts or project pages

Keep additions factual and useful. Do not add made-up testimonials, FAQs, prices, or outcomes.`);
  }

  // ── MEDIUM: alt text ───────────────────────────────────────────────────
  if ((imgAudit.missing_alt ?? 0) > 0) {
    addChange('🟡 MEDIUM', `Fix ${imgAudit.missing_alt} images missing alt text`,
`Alt text is required for accessibility (WCAG AA) and helps images rank in Google Image Search.

Find every \`<img>\` without an \`alt\` attribute and add one:
\`\`\`html
<!-- Before -->
<img src="photo.jpg" />

<!-- After -->
<img src="photo.jpg" alt="Descriptive text about the image content" />
\`\`\`

Use empty \`alt=""\` ONLY for purely decorative images (dividers, spacers).`);
  }

  // ── MEDIUM: social profiles ────────────────────────────────────────────
  const socialProfiles = offPage.social_profiles ?? [];
  const hasBareSocialLinks = (offPage.issues ?? []).some(i => i.includes('platform homepages'));
  if (socialProfiles.length === 0 && !hasBareSocialLinks) {
    addChange('🟡 MEDIUM', 'Add social media profile links to footer',
`No social profile links found. Social links build brand authority and are used by search engines and AI engines to verify entity identity.

Add links to your active profiles in the site footer:
\`\`\`html
<footer>
  <!-- Add whichever platforms you're active on -->
  <a href="https://twitter.com/yourbrand" rel="noopener">Twitter/X</a>
  <a href="https://www.linkedin.com/company/yourbrand" rel="noopener">LinkedIn</a>
  <a href="https://www.facebook.com/yourbrand" rel="noopener">Facebook</a>
</footer>
\`\`\``);
  } else if (hasBareSocialLinks) {
    addChange('🟡 MEDIUM', 'Fix social links — update to real profile URLs',
`Social icons link to platform homepages (e.g., facebook.com/) rather than your actual profiles. This gives zero brand authority signal.

Update each social link to point to your specific profile:
\`\`\`html
<!-- Wrong -->
<a href="https://facebook.com/">Facebook</a>

<!-- Right -->
<a href="https://facebook.com/yourbrandname">Facebook</a>
\`\`\``);
  }

  // ── MEDIUM: broken links ───────────────────────────────────────────────
  if (brokenLinks.length > 0) {
    const linkList = brokenLinks.slice(0, 6)
      .map(b => `  - **[${b.status}]** ${b.type === 'internal' ? '(internal)' : '(external)'} \`${b.url}\`${b.text ? ` — "${b.text}"` : ''}`)
      .join('\n');
    addChange('🟠 HIGH', `Fix ${brokenLinks.length} broken link(s)`,
`Broken links hurt crawlability and user experience. Internal broken links are especially harmful for SEO.

Broken links found:\n${linkList}

Fix each link: update the href to the correct URL, or remove the link if the page no longer exists.`);
  }

  // ── LOW: contact info ──────────────────────────────────────────────────
  if (!content.has_phone && !content.has_email && !content.has_address && (content.word_count ?? 0) > 0) {
    addChange('🟢 LOW', 'Add contact information to homepage or footer',
`No contact details found. Google's E-E-A-T guidelines and AI engines weight pages with verifiable contact info higher.

Add to your footer or a contact section:
\`\`\`html
<address>
  <a href="mailto:hello@${domain}">hello@${domain}</a>
  <!-- Add phone/address if applicable -->
</address>
\`\`\``);
  }

  // ── GEO: llms.txt / AI visibility note ────────────────────────────────
  const citatRate = mods.geo_predicted?.data?.citation_rate ?? -1;
  const geoReliable = mods.geo_predicted?.data?.is_reliable !== false;
  if (!isPersonalEditorial && geoReliable && citatRate >= 0 && citatRate < 0.3) {
    addChange('🟡 MEDIUM', 'Improve AI search visibility (GEO)',
`The separate simulation found weak predicted visibility. Beyond the llms.txt file above, these actions can improve machine-readable discovery and entity corroboration:

1. **Get a Wikidata entry**: Create a Wikidata item for your brand at https://www.wikidata.org/wiki/Special:NewItem — this is the single highest-impact GEO action
2. **Get cited on authoritative sites**: Press mentions, directory listings, and .edu/.gov links all boost LLM training data inclusion
3. **Add an About page** with specific, verifiable facts (founding date, mission, team)
4. **Publish FAQ content** matching questions people search for in your space`);
  }

  // SPF, DKIM, and DMARC depend on the active mail provider and sending routes.
  // Do not emit copy-paste DNS records until those facts are confirmed.

  // ── Build the markdown output ─────────────────────────────────────────
  const noChanges = changes.length === 0;
  const estimatedNewScore = Math.min(100, overall + Math.round(changes.filter(c => c.impact.includes('HIGH') || c.impact.includes('CRITICAL')).length * 6));

  const changeBlocks = changes.map(c =>
    `---\n\n### Change ${c.num} — ${c.title} ${c.impact}\n\n${c.body}\n`
  ).join('\n');

  const dnsBlock = dnsChanges.length > 0 ? `
---

## DNS Changes — Do These Outside Lovable/Cursor

These are DNS record changes made at your domain registrar or DNS provider (Cloudflare, Namecheap, GoDaddy, etc.). They cannot be done in code.

${dnsChanges.map((d, i) => `### DNS ${i + 1} — ${d}`).join('\n\n')}
` : '';

  const stackNote = stack !== 'vite' ? `\n> **Detected stack:** ${stack} — file paths and code examples are tailored accordingly.` : '';

  return `# SEO & GEO Fix Prompt — ${domain}
> **Audit date:** ${date} | **Current score:** ${overall}/100 (SEO ${seo} · GEO ${geo}) | **Estimated score after fixes:** ~${estimatedNewScore}/100
> **${changes.length} code change${changes.length !== 1 ? 's' : ''} below** · ${dnsChanges.length > 0 ? dnsChanges.length + ' DNS change' + (dnsChanges.length > 1 ? 's' : '') + ' (at end)' : 'No DNS changes needed'}
${stackNote}

---

## How to use this file

**Lovable / Bolt / v0:** Copy everything from the first \`---\` line onwards and paste it as a single message in chat.

**Claude Code:** \`claude "$(cat SEO-FIXES-${domain}.md)"\`

**Cursor / Windsurf:** Open this file and say *"Apply all the changes in this file to my project"*

---

## The Prompt (paste from here)

I need you to apply the following SEO and GEO fixes to my website at **${domain}**. Please implement all ${changes.length} code change${changes.length !== 1 ? 's' : ''} in one go. Each change includes the exact content or code — use it as-is, adjusting file paths only if your project structure differs.

${noChanges ? '**No code changes needed — this site is in great shape!**' : changeBlocks}
${dnsBlock}
---

*End of prompt. After applying these changes, the site should score approximately **${estimatedNewScore}/100** (up from ${overall}/100).*

---

*Generated by [GeoScore Audit Tool](https://geo.sayori.org) on ${date}*
`;
}

function downloadAgentMarkdown(data) {
  const md = generateAgentMarkdown(data);
  const domain = (data?.domain ?? 'site').replace(/[^a-z0-9.-]/gi, '-');
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `GEOSCORE-REPAIR-${domain}.md`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
}

// ── Formatted PDF Report Window ───────────────────────────────────────────

function openReportWindow(data) {
  const domain = data?.domain ?? '';
  const scoreSummary = REPORT_UI?.normalizeScoreSummary(data) ?? {};
  const seo = scoreSummary.seo ?? null;
  const geo = scoreSummary.geo ?? null;
  const overall = scoreSummary.overall ?? null;
  const date = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
  const mods = data?.modules ?? {};

  const scoreColor = s => s == null ? '#94a3b8' : s >= 75 ? '#16a34a' : s >= 50 ? '#d97706' : '#dc2626';
  const scoreBg    = s => s == null ? '#f8fafc' : s >= 75 ? '#f0fdf4' : s >= 50 ? '#fffbeb' : '#fef2f2';
  const scoreText  = s => s == null ? '—' : Math.round(s);

  // Evidence-contract reports export only applicable, evidenced failures.
  const allIssues = Array.isArray(data?.recommendations_v2)
    ? data.recommendations_v2.map(item => [
        item?.title,
        item?.page_url ? `Page: ${item.page_url}` : '',
        item?.evidence ? `Observed: ${item.evidence}` : '',
        item?.fix ? `Fix: ${item.fix}` : '',
      ].filter(Boolean).join(' — '))
    : Object.values(mods).flatMap(mod => mod?.data?.issues ?? []);

  const issueRows = allIssues.slice(0, 20).map(i =>
    `<tr><td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#475569">• ${i.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</td></tr>`
  ).join('');

  const modRows = [
    ['Technical SEO',    mods.technical_seo,    '⚙'],
    ['On-Page SEO',      mods.on_page_seo,       '📝'],
    ['Content Quality',  mods.content_quality,   '📄'],
    ['Authority',        mods.authority,          '🏆'],
    ['Off-Page / Social',mods.off_page_seo,      '📣'],
    ['Security',         mods.security_audit,    '🔒'],
    ['Accessibility',    mods.accessibility,     '♿'],
    ['GEO / AI',         mods.geo_predicted,     '🤖'],
    ['robots.txt + Sitemap', mods.robots_sitemap,'🕷'],
    ['Core Web Vitals',  mods.crux,              '⚡'],
  ].map(([label, mod, icon]) => {
    if (!mod) return '';
    const st = mod.status;
    const dot = st === 'ok' ? '🟢' : st === 'partial' ? '🟡' : st === 'failed' ? '🔴' : '⚪';
    const issues = (mod?.data?.issues ?? []).slice(0,3).map(i =>
      `<div style="font-size:11px;color:#64748b;margin-top:3px">• ${i.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>`
    ).join('');
    return `<tr style="border-bottom:1px solid #f1f5f9">
      <td style="padding:10px 12px;width:32px;font-size:16px">${dot}</td>
      <td style="padding:10px 4px;font-size:13px;font-weight:600;color:#1e293b;white-space:nowrap">${icon} ${label}</td>
      <td style="padding:10px 12px">${issues || '<span style="font-size:11px;color:#22c55e">✓ No issues</span>'}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>SEO Audit Report — ${domain}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b;background:#fff;font-size:14px;line-height:1.5}
  @media print{
    .no-print{display:none!important}
    .page-break{page-break-before:always}
    body{font-size:11pt}
    table{page-break-inside:auto}
    tr{page-break-inside:avoid}
  }
</style>
</head>
<body>
<div class="no-print" style="background:#f8fafc;border-bottom:1px solid #e2e8f0;padding:12px 24px;display:flex;align-items:center;gap:12px">
  <button onclick="window.print()" style="background:#1e293b;color:#fff;border:none;padding:8px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600">🖨 Print / Save as PDF</button>
  <button onclick="window.close()" style="background:#fff;border:1px solid #e2e8f0;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:13px">✕ Close</button>
  <span style="font-size:12px;color:#94a3b8;margin-left:auto">Tip: In the print dialog choose "Save as PDF" → set margins to Minimal for best results</span>
</div>

<div style="background:linear-gradient(135deg,#1e293b,#334155);color:#fff;padding:40px 48px">
  <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#94a3b8;margin-bottom:8px">SEO &amp; GEO Audit Report</div>
  <h1 style="font-size:28px;font-weight:700;margin-bottom:4px">${domain}</h1>
  <div style="font-size:13px;color:#94a3b8">${date}</div>
  <div style="display:flex;gap:20px;margin-top:28px">
    <div style="background:rgba(255,255,255,.08);border-radius:12px;padding:16px 24px;text-align:center">
      <div style="font-size:36px;font-weight:800;color:${scoreColor(overall)}">${scoreText(overall)}</div>
      <div style="font-size:11px;color:#94a3b8;margin-top:2px">Overall Score</div>
    </div>
    <div style="background:rgba(255,255,255,.08);border-radius:12px;padding:16px 24px;text-align:center">
      <div style="font-size:36px;font-weight:800;color:${scoreColor(seo)}">${scoreText(seo)}</div>
      <div style="font-size:11px;color:#94a3b8;margin-top:2px">SEO Score</div>
    </div>
    <div style="background:rgba(255,255,255,.08);border-radius:12px;padding:16px 24px;text-align:center">
      <div style="font-size:36px;font-weight:800;color:${scoreColor(geo)}">${scoreText(geo)}</div>
      <div style="font-size:11px;color:#94a3b8;margin-top:2px">GEO Score</div>
    </div>
  </div>
</div>

<div style="padding:32px 48px">
  <h2 style="font-size:16px;font-weight:700;margin-bottom:16px;color:#1e293b">Module Breakdown</h2>
  <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
    ${modRows || '<tr><td style="padding:12px;color:#94a3b8">No module data</td></tr>'}
  </table>

  ${allIssues.length ? `
  <div class="page-break" style="margin-top:32px">
    <h2 style="font-size:16px;font-weight:700;margin-bottom:16px;color:#1e293b">All Issues (${allIssues.length})</h2>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
      ${issueRows}
      ${allIssues.length > 20 ? `<tr><td style="padding:8px;font-size:11px;color:#94a3b8">… and ${allIssues.length - 20} more issues</td></tr>` : ''}
    </table>
  </div>` : ''}

  <div style="margin-top:40px;padding-top:20px;border-top:1px solid #f1f5f9;font-size:11px;color:#94a3b8;text-align:center">
    Generated by GeoScore Audit Tool · ${date}
  </div>
</div>
</body>
</html>`;

  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
}

// ── Re-audit score diff ────────────────────────────────────────────────────

async function loadAndShowDiff(domain, currentSummary) {
  try {
    const res = await fetch(`${API}/api/history/${encodeURIComponent(domain)}`);
    if (!res.ok) return;
    const { history } = await res.json();
    if (!history || history.length < 2) return;

    // Most recent previous audit (second-to-last — last is the one just run)
    const prev = history[history.length - 2];
    if (!prev || !REPORT_UI?.sameScoreVersion(currentSummary, prev)) return;

    const currentSeo = currentSummary?.seo;
    const currentGeo = currentSummary?.geo;
    const previousSeo = Number(prev.seo_score);
    const previousGeo = Number(prev.geo_score);
    if (![currentSeo, currentGeo, previousSeo, previousGeo].every(Number.isFinite)) return;

    const seoD   = currentSeo - previousSeo;
    const geoD   = currentGeo - previousGeo;
    const prevDate = new Date(prev.date).toLocaleDateString('en-GB', { day:'numeric', month:'short' });

    const fmt = d => {
      if (d === 0) return '<span style="color:#94a3b8">→</span>';
      const sign = d > 0 ? '↑' : '↓';
      const col  = d > 0 ? 'color:#16a34a' : 'color:#dc2626';
      return `<span style="${col};font-size:11px;font-weight:600">${sign}${Math.abs(d)}</span>`;
    };

    // Append diff to the context lines below each score ring
    const seoCtx = document.getElementById('seo-context');
    const geoCtx = document.getElementById('geo-context');
    const note   = ` vs ${prevDate}`;

    if (seoCtx && !seoCtx.dataset.diff) {
      seoCtx.dataset.diff = '1';
      seoCtx.insertAdjacentHTML('beforeend', `<br>${fmt(seoD)}<span style="font-size:9px;color:#94a3b8">${note}</span>`);
    }
    if (geoCtx && !geoCtx.dataset.diff) {
      geoCtx.dataset.diff = '1';
      geoCtx.insertAdjacentHTML('beforeend', `<br>${fmt(geoD)}<span style="font-size:9px;color:#94a3b8">${note}</span>`);
    }
  } catch { /* non-fatal */ }
}

// ── Schema JSON-LD generator ──────────────────────────────────────────────

async function handleSchemaGen(btn) {
  const output  = document.getElementById('schema-gen-output');
  const textEl  = document.getElementById('schema-gen-text');
  const copyBtn = document.getElementById('schema-copy-btn');
  const select  = document.getElementById('schema-type-select');
  if (!output || !textEl) return;

  btn.disabled = true;
  output.classList.remove('hidden');
  textEl.textContent = '';
  if (copyBtn) copyBtn.classList.add('hidden');

  const genStart = Date.now();
  const timer = setInterval(() => { btn.textContent = `⏳ Generating… ${fmtSecs(Date.now() - genStart)}`; }, 1000);
  btn.textContent = '⏳ Generating… 0s';

  try {
    const res = await fetch(`${API}/api/schema-gen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain:       btn.dataset.domain,
        businessName: btn.dataset.name,
        schemaType:   select?.value || 'LocalBusiness',
        city:         btn.dataset.city,
        country:      btn.dataset.country,
      }),
    });
    if (!res.ok || !res.body) throw new Error();
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let raw = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value).split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;
        try { raw += JSON.parse(payload).response ?? ''; } catch { /* skip */ }
      }
      textEl.textContent = raw;
    }
    clearInterval(timer);
    if (copyBtn) copyBtn.classList.remove('hidden');
    btn.textContent = `↻ Re-generate (${fmtSecs(Date.now() - genStart)})`;
  } catch {
    clearInterval(timer);
    textEl.textContent = 'Generation failed — try again.';
    btn.textContent = '✨ Generate schema';
  } finally {
    btn.disabled = false;
  }
}

// ── GEO entity probe ──────────────────────────────────────────────────────

async function handleGeoProbe(btn) {
  const output = document.getElementById('geo-probe-output');
  const result = document.getElementById('geo-probe-result');
  if (!output || !result) return;

  btn.disabled = true;
  btn.textContent = '⏳ Checking…';
  output.classList.remove('hidden');
  result.innerHTML = '<div class="text-xs text-slate-400">Querying DuckDuckGo knowledge graph…</div>';

  try {
    const res = await fetch(`${API}/api/geo-probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: btn.dataset.domain, businessName: btn.dataset.name }),
    });
    if (!res.ok) throw new Error();
    const d = await res.json();

    const scoreColor = d.visibility_score >= 70 ? 'text-green-700' : d.visibility_score >= 30 ? 'text-amber-600' : 'text-orange-600';
    const scoreBg    = d.visibility_score >= 70 ? 'bg-green-50 border-green-200' : d.visibility_score >= 30 ? 'bg-amber-50 border-amber-200' : 'bg-orange-50 border-orange-200';
    const signals    = (d.signals ?? []).map(s => `<li class="text-xs text-slate-600">• ${esc(s)}</li>`).join('');
    result.innerHTML = `
      <div class="flex items-center gap-3 mb-3">
        <div class="border rounded-xl px-4 py-2 ${scoreBg} text-center shrink-0">
          <div class="text-2xl font-bold ${scoreColor}">${d.visibility_score}</div>
          <div class="text-[10px] text-slate-400">/ 100</div>
        </div>
        <div>
          <div class="text-sm font-semibold text-slate-700">${d.has_knowledge_panel ? '✓ Knowledge panel found' : '✗ Not in knowledge graph'}</div>
          ${d.knowledge_source ? `<div class="text-xs text-slate-400 mt-0.5">Source: ${esc(d.knowledge_source)}</div>` : ''}
        </div>
      </div>
      ${d.knowledge_summary ? `<div class="text-xs text-slate-600 bg-white border border-slate-200 rounded-lg p-2.5 mb-3 italic line-clamp-3">"${esc(d.knowledge_summary)}"</div>` : ''}
      <ul class="space-y-1">${signals}</ul>`;

    btn.textContent = '↻ Re-check';
  } catch {
    result.innerHTML = '<div class="text-xs text-orange-600">Probe failed — try again.</div>';
    btn.textContent = 'Check visibility';
  } finally {
    btn.disabled = false;
  }
}

// ── OG image download ─────────────────────────────────────────────────────

async function downloadOgImage(btn) {
  const imageUrl = btn.dataset.imageUrl;
  const domain   = btn.dataset.domain;
  if (!imageUrl) return;

  btn.disabled = true;
  const original = btn.innerHTML;
  btn.textContent = '⏳ Downloading…';

  try {
    const res = await fetch(`${API}/api/fetch-image?url=${encodeURIComponent(imageUrl)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();

    // Derive extension from URL (strip query string first)
    const rawExt = imageUrl.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
    const ext = ['jpg','jpeg','png','webp','gif','svg','avif'].includes(rawExt) ? rawExt : 'jpg';

    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = `${domain}-og-image.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objUrl), 5000);

    btn.innerHTML = '✓ Saved';
    setTimeout(() => { btn.innerHTML = original; btn.disabled = false; }, 2500);
  } catch {
    btn.innerHTML = original;
    btn.disabled = false;
  }
}

// ── SERP snippet optimiser ────────────────────────────────────────────────

async function handleSerpGen(btn) {
  const output   = document.getElementById('serp-gen-output');
  const titleEl  = document.getElementById('serp-gen-title');
  const descEl   = document.getElementById('serp-gen-desc');
  const tLenEl   = document.getElementById('serp-gen-title-len');
  const dLenEl   = document.getElementById('serp-gen-desc-len');
  if (!output || !titleEl || !descEl) return;

  btn.disabled = true;
  btn.textContent = '⏳ Generating…';

  try {
    const res = await fetch(`${API}/api/serp-gen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:       btn.dataset.title,
        description: btn.dataset.desc,
        domain:      btn.dataset.domain,
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const t = (data.title       ?? '').trim();
    const d = (data.description ?? '').trim();

    titleEl.textContent = t;
    descEl.textContent  = d;
    if (tLenEl) tLenEl.textContent = `${t.length} chars${t.length > 60 ? ' ⚠ too long' : t.length < 50 ? ' ⚠ short' : ' ✓'}`;
    if (dLenEl) dLenEl.textContent = `${d.length} chars${d.length > 155 ? ' ⚠ too long' : d.length < 120 ? ' ⚠ short' : ' ✓'}`;

    output.classList.remove('hidden');
    btn.textContent = '↻ Re-generate';
  } catch {
    output.classList.remove('hidden');
    titleEl.textContent = 'Generation failed — please try again.';
    descEl.textContent  = '';
    btn.textContent = '✨ Generate optimal snippet';
  } finally {
    btn.disabled = false;
  }
}

// ── Search & Autocomplete ──────────────────────────────────────────────────

const searchInput = document.getElementById('search-input');
const suggestions = document.getElementById('suggestions');
let debounce;

if (searchInput && suggestions) {
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = searchInput.value.trim();
    if (q.length < 2) { suggestions.classList.add('hidden'); return; }
    debounce = setTimeout(() => fetchSuggestions(q), 250);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = searchInput.value.trim();
      if (q) { suggestions.classList.add('hidden'); startAudit(q); }
    }
  });

  document.getElementById('audit-btn')?.addEventListener('click', () => {
    const q = searchInput.value.trim();
    if (q) { suggestions.classList.add('hidden'); startAudit(q); }
  });

  document.addEventListener('click', (e) => {
    if (!suggestions.contains(e.target)) suggestions.classList.add('hidden');
  });
}

async function fetchSuggestions(q) {
  try {
    const [kwResults, semResults] = await Promise.all([
      fetch(`${API}/api/search?q=${encodeURIComponent(q)}`)
        .then(r => r.ok ? r.json() : [])
        .catch(() => []),
      semanticSearch(q),
    ]);

    if (semResults?.length) {
      // Semantic results first; backfill with keyword extras not already present
      const seen = new Set(semResults.map(b => b.domain || b.name));
      const extras = (kwResults || []).filter(b => !seen.has(b.domain || b.name));
      renderSuggestions([...semResults, ...extras].slice(0, 8));
    } else {
      renderSuggestions(kwResults || []);
    }
  } catch { suggestions.classList.add('hidden'); }
}

const CATEGORY_LABELS = {
  dental: '🦷 Dental', hotel: '🏨 Hotel', restaurant: '🍽️ Restaurant',
  fitness: '💪 Fitness', legal: '⚖️ Legal', real_estate: '🏠 Real Estate',
  medical: '🏥 Medical', ecommerce: '🛒 E-commerce', tech: '💻 Tech',
  airline: '✈️ Airline', telecom: '📡 Telecom', tourism: '🗺️ Tourism',
};

function renderSuggestions(items) {
  if (!items.length) { suggestions.classList.add('hidden'); return; }
  suggestions.innerHTML = items.map((b) => {
    const catLabel = CATEGORY_LABELS[b.category] || (b.category ? esc(b.category) : '');
    return `
    <li class="px-4 py-3 hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-0"
        data-domain="${b.domain || ''}" data-name="${esc(b.name)}">
      <div class="flex items-center justify-between">
        <div class="font-medium text-sm">${esc(b.name)}</div>
        ${catLabel ? `<span class="text-xs text-slate-400 ml-2 shrink-0">${catLabel}</span>` : ''}
      </div>
      <div class="text-xs text-slate-400 mt-0.5">${esc(b.city || '')}${b.city && b.domain ? ' · ' : ''}${esc(b.domain || '')}</div>
    </li>`;
  }).join('');
  suggestions.classList.remove('hidden');
  suggestions.querySelectorAll('li').forEach((li) => {
    li.addEventListener('click', () => {
      const domain = li.dataset.domain || li.dataset.name;
      searchInput.value = domain;
      suggestions.classList.add('hidden');
      startAudit(domain);
    });
  });
}

// ── Audit ──────────────────────────────────────────────────────────────────

function looksLikeDomain(str) {
  return /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/.test(str);
}

// Build smart domain guesses from free-text input
function buildDomainGuesses(input) {
  const q = input.toLowerCase().replace(/[''`]/g, '').replace(/[^a-z0-9\s.\-]/g, '').trim();
  const guesses = [];

  // TLD transposition fixes (e.g. stripe.cmo → stripe.com)
  const tldFixes = { '.cmo': '.com', '.ocm': '.com', '.con': '.com', '.ner': '.net', '.rog': '.org' };
  for (const [bad, good] of Object.entries(tldFixes)) {
    if (q.endsWith(bad) && q.length > bad.length) {
      guesses.push(q.slice(0, -bad.length) + good);
    }
  }

  if (!q.includes('.')) {
    const words = q.split(/\s+/).filter(Boolean);
    const first = words[0];
    if (first && first.length >= 2) {
      guesses.push(`${first}.com`);
      const joined = words.join('');
      if (joined !== first && joined.length >= 3 && joined.length <= 24) {
        guesses.push(`${joined}.com`);
      }
      if (first.length >= 3) guesses.push(`${first}.co.uk`);
    }
  }

  // Deduplicate, keep valid-looking ones only
  return [...new Set(guesses)].filter(d => looksLikeDomain(d)).slice(0, 4);
}

async function startAudit(rawInput, options = {}) {
  const parsed = parsePublicDomainInput(rawInput);
  let domain = parsed.domain;
  if (!parsed.ok) {
    showAuditShell(domain || String(rawInput || '').trim() || 'Invalid target');
    document.getElementById('modules').innerHTML = `<div class="bg-white border border-orange-200 rounded-xl p-5 text-sm text-orange-700">${esc(parsed.reason)}</div>`;
    return;
  }

  if (!looksLikeDomain(domain)) {
    showAuditShell(domain);
    const card = document.getElementById('business-card');
    card.innerHTML = `<div class="text-sm text-slate-400 italic">Searching…</div>`;

    // Parallel: generate guesses + search DB
    const [domainGuesses, dbResults] = await Promise.all([
      Promise.resolve(buildDomainGuesses(domain)),
      fetch(`${API}/api/search?q=${encodeURIComponent(domain)}`).then(r => r.ok ? r.json() : []).catch(() => []),
    ]);

    // Merge: domain guesses first, then DB business matches (deduped)
    const seenDomains = new Set(domainGuesses);
    const dbSuggestions = (dbResults || [])
      .filter(b => b.domain && !seenDomains.has(b.domain))
      .slice(0, 3)
      .map(b => ({ domain: b.domain, label: b.name }));

    const allSuggestions = [
      ...domainGuesses.map(d => ({ domain: d, label: d })),
      ...dbSuggestions,
    ];

    currentDomain = domain;

    if (allSuggestions.length > 0) {
      card.innerHTML = `
        <div class="flex items-center gap-2 mb-3">
          <span class="text-slate-400 text-sm">Did you mean?</span>
        </div>
        <div class="flex flex-wrap gap-2">
          ${allSuggestions.map(s => `
            <button class="flex items-center gap-2 border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-800 px-3 py-2 rounded-xl text-sm font-medium transition-colors" data-quick="${esc(s.domain)}">
              <svg class="w-3.5 h-3.5 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              ${esc(s.label !== s.domain ? s.label + ' · ' : '')}${esc(s.domain)}
            </button>`).join('')}
        </div>
        <div class="text-xs text-slate-400 mt-3">Or type a full domain like <span class="font-mono text-slate-500">stripe.com</span> and press Enter</div>`;
    } else {
      card.innerHTML = `
        <div class="text-sm text-slate-700 mb-2">No matches found for <strong class="text-slate-900">${esc(rawInput)}</strong></div>
        <div class="text-xs text-slate-500">Enter a website domain (e.g. <span class="font-mono">stripe.com</span>, <span class="font-mono">dentist-london.co.uk</span>)</div>`;
    }
    return;
  }

  currentDomain = domain;
  currentAuditRequest = {
    domain,
    mode: parsed.mode === 'url' ? 'url' : 'site',
    targetUrl: parsed.mode === 'url' ? parsed.targetUrl : null,
    archetypeHint: options.archetypeHint || null,
  };
  const pageQuery = REPORT_UI?.buildAuditPageQuery(currentAuditRequest) || `?d=${encodeURIComponent(domain)}`;
  history.pushState({}, '', pageQuery);
  showAuditShell(domain);
  document.getElementById('business-card').innerHTML = spinnerCard(domain);
  openAuditStream(currentAuditRequest, 0, options.fresh === true);
}

function showAuditShell(domain) {
  stopAuditTimer();
  currentAuditData = null;
  currentLighthouseState = null;
  const savedReportLanguage = I18N?.getReportLanguage?.() ?? null;
  reportLanguageManuallySet = Boolean(savedReportLanguage);
  reportLanguage = savedReportLanguage || UI_LANGUAGE;
  document.getElementById('audit').classList.remove('hidden');
  document.getElementById('scores').classList.add('hidden');
  document.getElementById('score-insight')?.classList.add('hidden');
  document.getElementById('data-provenance-row')?.classList.add('hidden');
  document.getElementById('embed-cta').classList.add('hidden');
  document.getElementById('chat-section').classList.add('hidden');
  document.getElementById('cwv-row').classList.add('hidden');
  const evidenceSummary = document.getElementById('evidence-summary');
  if (evidenceSummary) { evidenceSummary.innerHTML = ''; evidenceSummary.classList.add('hidden'); }
  const msgs = document.getElementById('chat-messages');
  if (msgs) { msgs.innerHTML = ''; msgs.style.maxHeight = '0'; }
  const clearBtn = document.getElementById('chat-clear');
  if (clearBtn) { clearBtn.classList.add('hidden'); clearBtn.classList.remove('flex'); }
  const sugg = document.getElementById('chat-suggestions');
  if (sugg) sugg.classList.remove('hidden');
  const main = document.getElementById('main-content');
  if (main) main.style.paddingBottom = '';
  document.getElementById('modules').innerHTML = '';
  window._auditBotBlocked = false; // reset per-audit bot-block flag
  computedSectionsRendered = false;
  const summaryBar = document.getElementById('summary-bar');
  if (summaryBar) { summaryBar.innerHTML = ''; summaryBar.classList.add('hidden'); }
  const ctxEl = document.getElementById('overall-context');
  if (ctxEl) ctxEl.textContent = '';
  const deltaEl = document.getElementById('overall-delta');
  if (deltaEl) { deltaEl.textContent = ''; deltaEl.classList.add('hidden'); }
  // Reset grade badges
  ['overall','seo','geo','perf'].forEach(k => {
    const g = document.getElementById(`${k}-grade`);
    if (g) { g.textContent = '—'; g.className = 'mt-0.5 text-[10px] font-semibold px-2 py-0.5 rounded-full inline-block grade-b'; }
    const s = document.getElementById(`${k}-score`);
    if (s) s.textContent = '—';
    // Reset rings to empty — MUST also reset display in case a prior audit hid the
    // ring via the "No data" path; otherwise the next audit's animateRing call
    // animates an invisible element and the arc never appears.
    const r = document.getElementById(`ring-${k}`);
    if (r) { r.style.strokeDashoffset = '314.16'; r.style.display = ''; }
  });
  // Reset AEO + performance block visibility — if a prior audit hid them (no data),
  // the next audit must start with them visible again.
  const aeoWrap = document.getElementById('aeo-circle-wrap');
  if (aeoWrap) aeoWrap.style.display = '';
  const perfWrap = document.getElementById('perf-circle-wrap');
  if (perfWrap) perfWrap.style.display = '';
  const perfSub = document.getElementById('perf-score-sub');
  if (perfSub) perfSub.textContent = '/100';
  // Reset monitor panel
  const monitorBanner = document.getElementById('monitor-banner');
  if (monitorBanner) { monitorBanner.style.maxHeight = '0'; monitorBanner.style.opacity = '0'; }
  const catTabs = document.getElementById('cat-tabs');
  if (catTabs) catTabs.classList.remove('hidden');
  document.querySelectorAll('.cat-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.cat === 'all');
    // Reset count suffix from previous audit
    const orig = _catTabOriginalLabels.get(t.dataset.cat);
    if (orig) t.textContent = orig;
  });
  recMap.clear();
  initProgress();
}

// Apply the currently active category filter to a freshly-appended card
function applyActiveCatFilter(el) {
  const activeCat = document.querySelector('.cat-tab.active')?.dataset.cat;
  if (activeCat && activeCat !== 'all' && el.dataset.category !== activeCat) {
    el.style.display = 'none';
  }
}

function spinnerCard(domain) {
  // Populate the new header elements
  const nameEl = document.getElementById('domain-name');
  const dateEl = document.getElementById('audit-date');
  const faviconEl = document.getElementById('domain-favicon');
  if (nameEl) nameEl.textContent = domain;
  if (dateEl) dateEl.textContent = UI_LANGUAGE === 'zh'
    ? '正在审查公开页面…'
    : 'Auditing public pages…';
  if (faviconEl) {
    faviconEl.innerHTML = `<img src="https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(domain)}" alt="" class="w-6 h-6" onerror="this.style.display='none'">`;
  }
  return ''; // business-card inner HTML is now in the header elements
}

// ── Score ring helpers ────────────────────────────────────────────────────────
function gradeLabel(score) {
  if (score >= 90) return { text: 'A+', cls: 'grade-a' };
  if (score >= 80) return { text: 'A',  cls: 'grade-a' };
  if (score >= 70) return { text: 'B+', cls: 'grade-b' };
  if (score >= 60) return { text: 'B',  cls: 'grade-b' };
  if (score >= 50) return { text: 'C+', cls: 'grade-c' };
  if (score >= 40) return { text: 'C',  cls: 'grade-c' };
  if (score >= 30) return { text: 'D',  cls: 'grade-d' };
  return { text: 'F', cls: 'grade-f' };
}

function animateRing(ringId, score, color) {
  const ring = document.getElementById(ringId);
  if (!ring) return;
  ring.style.display = ''; // ensure visible — may have been hidden by a prior "No data" state
  const circumference = 314.16;
  const offset = circumference * (1 - Math.max(0, Math.min(100, score)) / 100);
  ring.style.stroke = color;
  // Trigger reflow then animate
  requestAnimationFrame(() => {
    ring.style.transition = 'stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1)';
    ring.style.strokeDashoffset = offset;
  });
}

function setScoreCircle(key, score, color) {
  const scoreEl = document.getElementById(`${key}-score`);
  const gradeEl = document.getElementById(`${key}-grade`);
  const ctxEl   = document.getElementById(`${key}-context`);
  const ringId  = `ring-${key}`;

  // Animated count-up (matches ring animation duration)
  if (scoreEl) {
    const t0 = performance.now(), dur = 900;
    const tick = (now) => {
      const p = Math.min((now - t0) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      scoreEl.textContent = Math.round(score * eased);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  if (gradeEl) {
    const g = gradeLabel(score);
    gradeEl.textContent = g.text;
    gradeEl.className = `mt-0.5 text-[10px] font-semibold px-2 py-0.5 rounded-full inline-block ${g.cls}`;
  }

  // Percentile context on every ring (overall may be overridden below by cross-metric enrichment)
  if (ctxEl) ctxEl.textContent = scoreContext(score);

  // Ring color: green ≥70, amber 40-69, red <40
  const ringColor = score >= 70 ? '#16a34a' : score >= 40 ? '#d97706' : '#ea580c';
  animateRing(ringId, score, ringColor);
}

function applyReportLanguageLabels() {
  const labels = {
    'overall-label': reportText('audit.overall'),
    'seo-label': reportText('audit.seo'),
    'geo-label': reportText('audit.geo'),
    'geo-sub-label': reportLanguage === 'zh' ? '事实检查' : 'Factual checks',
    'aeo-label': reportText('audit.aeo'),
    'aeo-sub-label': reportLanguage === 'zh' ? '内容可提取性' : 'Extractability',
    'perf-label': reportText('audit.performance'),
  };
  Object.entries(labels).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === 'seo-label' || id === 'geo-label' || id === 'aeo-label') {
      const tip = el.querySelector('.tech-tip');
      if (tip) tip.textContent = value;
      else el.textContent = value;
    } else {
      el.textContent = value;
    }
  });
}

function setUnavailableScoreCircle(key, context) {
  const scoreEl = document.getElementById(`${key}-score`);
  const gradeEl = document.getElementById(`${key}-grade`);
  const ctxEl = document.getElementById(`${key}-context`);
  const ring = document.getElementById(`ring-${key}`);
  if (scoreEl) scoreEl.textContent = '—';
  if (gradeEl) {
    gradeEl.textContent = reportLanguage === 'zh' ? '证据不足' : 'Insufficient';
    gradeEl.className = 'mt-0.5 text-[10px] font-semibold px-2 py-0.5 rounded-full inline-block bg-slate-100 text-slate-500';
  }
  if (ctxEl) ctxEl.textContent = context || (reportLanguage === 'zh' ? '不以 0 分代替未知' : 'Unknown is not scored as zero');
  if (ring) {
    ring.style.strokeDashoffset = '314.16';
    ring.style.stroke = '#cbd5e1';
    ring.style.display = '';
  }
}

function renderEvidenceFirstSummary(data) {
  const el = document.getElementById('evidence-summary');
  if (!el || !REPORT_UI || !data) return;
  const html = REPORT_UI.renderEvidenceSummary(data, reportLanguage, UI_LANGUAGE);
  if (!html) {
    el.innerHTML = '';
    el.classList.add('hidden');
    return;
  }
  el.lang = reportLanguage === 'zh' ? 'zh-CN' : 'en';
  el.innerHTML = html;
  el.classList.remove('hidden');
}

function renderEvidenceReportSections(data) {
  if (!REPORT_UI?.isEvidenceAudit?.(data)) return false;
  const modules = document.getElementById('modules');
  if (!modules) return true;
  modules.innerHTML = '';
  recMap.clear();
  (data.recommendations_v2 ?? []).forEach((recommendation) => {
    if (recommendation?.id) recMap.set(String(recommendation.id), recommendation);
  });
  const checks = REPORT_UI.renderNormalizedChecks(data, reportLanguage);
  const recommendations = REPORT_UI.renderEvidenceRecommendations(data, reportLanguage);
  modules.innerHTML = [checks, recommendations].filter(Boolean).join('');
  document.getElementById('cat-tabs')?.classList.add('hidden');
  return true;
}

function renderScoreSummaryNote(data) {
  if (!REPORT_UI || !data?.score_summary) return;
  const summary = REPORT_UI.normalizeScoreSummary(data);
  const t = REPORT_UI.copy(reportLanguage);
  const insightEl = document.getElementById('score-insight');
  const insightText = document.getElementById('score-insight-text');
  const insightSub = document.getElementById('score-insight-sub');
  if (!insightEl || !insightText || !insightSub) return;

  const coverage = REPORT_UI.formatPercent(summary.coverage);
  const confidence = REPORT_UI.formatPercent(summary.confidence);
  const meta = [
    coverage ? `${t.coverage} ${coverage}` : '',
    confidence ? `${t.confidence} ${confidence}` : '',
  ].filter(Boolean).join(' · ');
  const unavailableContext = coverage ? `${t.coverage} ${coverage}` : '';
  if (summary.overall === null) setUnavailableScoreCircle('overall', unavailableContext);
  else {
    const context = document.getElementById('overall-context');
    if (context) context.textContent = scoreContext(summary.overall);
  }
  if (summary.seo === null) setUnavailableScoreCircle('seo', unavailableContext);
  else {
    const context = document.getElementById('seo-context');
    if (context) context.textContent = scoreContext(summary.seo);
  }
  if (summary.geo === null) setUnavailableScoreCircle('geo', unavailableContext);
  else {
    const context = document.getElementById('geo-context');
    if (context) context.textContent = scoreContext(summary.geo);
  }
  if (summary.aeo === null) setUnavailableScoreCircle('aeo', unavailableContext);
  if (summary.overall === null) {
    insightText.textContent = t.insufficient;
    insightSub.textContent = [t.scoreInsufficient, meta].filter(Boolean).join(' ');
    insightEl.style.cssText = 'background:#f8fafc;border:1px solid #cbd5e1;border-radius:12px;';
    insightText.style.color = '#475569';
  } else {
    insightText.textContent = `${Math.round(summary.overall)}/100${meta ? ` · ${meta}` : ''}`;
    insightSub.textContent = t.scoreEvidence;
    const [bg, border, color] = summary.overall >= 80
      ? ['#f0fdf4', '#bbf7d0', '#15803d']
      : summary.overall >= 60
        ? ['#eff6ff', '#bfdbfe', '#1d4ed8']
        : ['#fffbeb', '#fde68a', '#92400e'];
    insightEl.style.cssText = `background:${bg};border:1px solid ${border};border-radius:12px;`;
    insightText.style.color = color;
  }
  insightEl.lang = reportLanguage === 'zh' ? 'zh-CN' : 'en';
  insightEl.classList.remove('hidden');
  document.getElementById('data-provenance-row')?.classList.remove('hidden');
}

function renderEvidenceCheckSummaryBar(data) {
  const bar = document.getElementById('summary-bar');
  if (!bar || !REPORT_UI?.isEvidenceAudit?.(data)) return;
  bar.innerHTML = REPORT_UI.renderCheckSummaryBar(data, reportLanguage);
  bar.classList.toggle('hidden', !bar.innerHTML);
}

function updatePerformanceContext(data) {
  const context = document.getElementById('perf-context');
  if (!context || !REPORT_UI?.performanceSourceLabel) return;
  const label = REPORT_UI.performanceSourceLabel(data, reportLanguage);
  if (label) context.textContent = label;
}

function renderLighthouseState(state) {
  if (!state || !REPORT_UI) return;
  const status = REPORT_UI.lighthouseStatus(state.data, state.error, state.strategies, state.status);
  renderSection({
    module: 'lighthouse',
    status,
    data: state.data ?? null,
    error: state.error ?? null,
    strategies: state.strategies ?? [],
    duration_ms: state.duration_ms ?? null,
  });
}

// ── Lighthouse fetch — runs in its own Worker invocation after main audit completes ──
// This avoids the 50-subrequest-per-invocation limit on Cloudflare's free plan.
async function fetchLighthouse(domain) {
  updateModuleProgress('lighthouse', 'running', 'Fetching PageSpeed Insights…');
  currentLighthouseState = null;
  let card = document.getElementById('module-lighthouse');
  if (!card) {
    card = document.createElement('div');
    card.id = 'module-lighthouse';
    card.className = 'bg-white rounded-xl border border-slate-200 p-4 fade-in';
    card.dataset.category = 'seo';
    card.style.order = cardOrder(card.id);
    document.getElementById('modules')?.appendChild(card);
  }
  card.innerHTML = `<div class="flex items-center gap-2 text-slate-500 text-sm">
    <span class="spinner w-4 h-4 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin inline-block"></span>
    ${reportLanguage === 'zh' ? '正在通过 Google PageSpeed Insights 获取 Lighthouse 数据…' : 'Fetching Lighthouse data from Google PageSpeed Insights…'}
  </div>`;
  applyActiveCatFilter(card);

  try {
    const lighthouseParams = new URLSearchParams({ domain });
    if (currentAuditId) lighthouseParams.set('audit_id', currentAuditId);
    const res = await fetch(`${API}/api/lighthouse?${lighthouseParams.toString()}`);
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      currentLighthouseState = {
        status: 'failed',
        data: null,
        error: REPORT_UI?.sanitizeError(json?.error ?? { code: 'PAGESPEED_UPSTREAM_ERROR', message: `HTTP ${res.status}`, retryable: true }),
        strategies: Array.isArray(json?.strategies) ? json.strategies : [],
        domain,
      };
      renderLighthouseState(currentLighthouseState);
      restorePerformanceFallback();
      return;
    }
    const data = json.data;
    const sectionStatus = REPORT_UI?.lighthouseStatus(data, null, [], data?.status) ?? (data?.status === 'partial' ? 'partial' : 'ok');
    if (sectionStatus === 'failed') {
      currentLighthouseState = {
        status: 'failed',
        data,
        error: REPORT_UI?.sanitizeError({ code: 'PAGESPEED_EMPTY_RESULT', message: 'PageSpeed returned no numeric score', retryable: true }),
        strategies: [data?.mobile, data?.desktop].filter(Boolean),
        domain,
      };
      renderLighthouseState(currentLighthouseState);
      restorePerformanceFallback();
      return;
    }

    window._auditModCache = window._auditModCache ?? {};
    window._auditModCache.lighthouse = data;
    if (currentAuditData) {
      const update = json.audit_update && typeof json.audit_update === 'object' ? json.audit_update : {};
      currentAuditData = {
        ...currentAuditData,
        ...update,
        modules: {
          ...(currentAuditData.modules ?? {}),
          lighthouse: { status: data.status === 'partial' ? 'partial' : 'ok', data },
        },
      };
      if (json.audit_update) renderFullAudit(currentAuditData);
    }
    currentLighthouseState = { status: sectionStatus, data, error: null, strategies: [], domain };
    renderLighthouseState(currentLighthouseState);

    const lhPerfScore = data.mobile_score ?? data.desktop_score ?? (typeof data.score === 'number' ? data.score : null);
    if (lhPerfScore !== null && lhPerfScore !== undefined) {
      const perfWrap = document.getElementById('perf-circle-wrap');
      if (perfWrap) perfWrap.style.display = '';
      setScoreCircle('perf', lhPerfScore, '#16a34a');
      updatePerformanceContext({ modules: { lighthouse: { data } } });
      const perfSub = document.getElementById('perf-score-sub');
      if (perfSub) perfSub.textContent = '/100';
    }
    updateCwvPillsFromLighthouse(data);
  } catch (err) {
    currentLighthouseState = {
      status: 'failed',
      data: null,
      error: REPORT_UI?.sanitizeError({ code: 'PAGESPEED_NETWORK_ERROR', message: err instanceof Error ? err.message : String(err), retryable: true }),
      strategies: [],
      domain,
    };
    renderLighthouseState(currentLighthouseState);
    restorePerformanceFallback();
  }
}

function restorePerformanceFallback() {
  const ps = currentAuditData?.modules?.on_page_seo?.data?.page_speed;
  const crux = currentAuditData?.modules?.crux?.data;
  const fallbackScore = ps?.performance ?? (crux?.has_data ? crux.performance_score : null);
  const perfWrap = document.getElementById('perf-circle-wrap');
  if (fallbackScore !== null && fallbackScore !== undefined) {
    if (perfWrap) perfWrap.style.display = '';
    setScoreCircle('perf', fallbackScore, '#16a34a');
    updatePerformanceContext(currentAuditData);
  } else if (perfWrap) {
    perfWrap.style.display = 'none';
  }
  document.getElementById('cwv-row')?.classList.add('hidden');
}

// Update the CWV pill row with Lighthouse lab values (called after fetchLighthouse resolves)
function updateCwvPillsFromLighthouse(lh) {
  const fmt = ms => ms >= 1000 ? `${(ms/1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
  const pillDefs = [
    { id: 'cwv-lcp',  val: lh.lcp_ms,  label: 'LCP',  good: v => v <= 2500,  warn: v => v <= 4000,  display: fmt },
    { id: 'cwv-cls',  val: lh.cls,     label: 'CLS',  good: v => v <= 0.1,   warn: v => v <= 0.25,  display: v => v?.toFixed(3) },
    { id: 'cwv-fcp',  val: lh.fcp_ms,  label: 'FCP',  good: v => v <= 1800,  warn: v => v <= 3000,  display: fmt },
    { id: 'cwv-tbt',  val: lh.tbt_ms,  label: 'TBT',  good: v => v <= 200,   warn: v => v <= 600,   display: v => `${Math.round(v)}ms` },
  ];
  for (const p of pillDefs) {
    if (p.val == null) continue;
    const el = document.getElementById(p.id);
    if (!el) continue;
    const color = p.good(p.val) ? '#16a34a' : p.warn(p.val) ? '#d97706' : '#dc2626';
    el.textContent = `${p.label} ${p.display(p.val)}`;
    el.style.color = color;
    el.style.borderColor = color;
  }
  // Desktop score pill
  if (lh.desktop_score !== null && lh.desktop_score !== undefined) {
    const el = document.getElementById('cwv-desktop');
    if (el) {
      const color = lh.desktop_score >= 90 ? '#16a34a' : lh.desktop_score >= 50 ? '#d97706' : '#dc2626';
      el.textContent = `Desktop ${lh.desktop_score}`;
      el.style.color = color;
      el.style.borderColor = color;
    }
  }
}

// SSE with auto-reconnect (up to 2 retries on network error)
// fresh=true adds ?fresh=1 so the server atomically busts its cache before re-auditing
function openAuditStream(request, attempt, fresh = false) {
  const auditRequest = typeof request === 'string'
    ? { domain: request, mode: 'site', targetUrl: null, archetypeHint: null }
    : request;
  const endpoint = REPORT_UI?.buildAuditEndpoint(API, auditRequest, { fresh: fresh && attempt === 0 });
  if (!endpoint) {
    appendError('Only public domains are supported');
    return;
  }
  const es = new EventSource(endpoint);

  es.addEventListener('progress', (e) => {
    const d = JSON.parse(e.data);
    updateModuleProgress(d.module, d.status, d.detail);
  });

  es.addEventListener('section', (e) => {
    const d = JSON.parse(e.data);
    if (d.module !== 'cache_hit') {
      renderSection(d);
      if (PROGRESS_MODULES.has(d.module)) { tickProgress(); clearTimeout(window._catCountTimer); window._catCountTimer = setTimeout(updateCatTabCounts, 120); }
    } else {
      renderFullAudit(d.data);
      // Instantly complete progress bar for cached results
      modulesComplete = TOTAL_MODULES;
      const fill = document.getElementById('progress-fill');
      const label = document.getElementById('progress-label');
      if (fill) fill.style.width = '100%';
      if (label) label.textContent = UI_LANGUAGE === 'zh'
        ? `${TOTAL_MODULES} / ${TOTAL_MODULES} 项`
        : `${TOTAL_MODULES} / ${TOTAL_MODULES} modules`;
      stopAuditTimer();
      setTimeout(() => { const bar = document.getElementById('progress-bar'); if (bar) bar.classList.add('hidden'); }, 800);
    }
  });

  es.addEventListener('complete', (e) => {
    const d = JSON.parse(e.data);
    currentAuditId = d.audit_id;
    stopAuditTimer();
    renderFullAudit(d);
    enableChat();
    es.close();
    // Kick off Lighthouse in a separate request (own Worker invocation = own subrequest budget)
    fetchLighthouse(auditRequest.domain);
  });

  es.addEventListener('error', () => {
    es.close();
    if (attempt < 2) {
      setTimeout(() => openAuditStream(auditRequest, attempt + 1), 2000 * (attempt + 1));
      appendError(`Connection interrupted — retrying (${attempt + 1}/2)...`, true);
    } else {
      stopAuditTimer();
      appendError('Audit failed or timed out. Please try again.');
      // Clear any modules stuck on spinner
      document.querySelectorAll('[id^="module-"] .spinner').forEach(spinner => {
        const card = spinner.closest('[id^="module-"]');
        if (card) renderSection({ module: card.id.replace('module-', ''), status: 'failed', error: 'Timed out', duration_ms: null });
      });
    }
  });
}

function renderSiteIntro(data) {
  if (document.getElementById('card-site-intro')) return;

  const mods = data.modules ?? {};
  const authData    = mods.authority?.data;
  const schemaData  = mods.schema_audit?.data;
  const techData    = mods.technical_seo?.data;
  const offPageData = mods.off_page_seo?.data;

  // Need at least authority data to produce anything meaningful
  if (!authData) return;

  // ── Registration year (RDAP — ground truth) ───────────────────────────────
  let registrationYear = null;
  const nowYear = new Date().getFullYear();
  if (authData.registration_date) {
    const y = new Date(authData.registration_date).getFullYear();
    if (!isNaN(y) && y > 1990 && y <= nowYear) registrationYear = y;
  }
  // Wayback earliest crawl as a fallback ("active since" — slightly different meaning)
  let waybackYear = null;
  if (!registrationYear && authData.wayback_first_seen) {
    const y = new Date(authData.wayback_first_seen).getFullYear();
    if (!isNaN(y) && y > 1990 && y <= nowYear) waybackYear = y;
  }

  // ── Inject Wayback year into off_page card (runs after all modules are rendered) ──
  {
    const wbYear = registrationYear || waybackYear;
    if (wbYear) {
      const offDetail = document.getElementById('off-page-detail');
      if (offDetail) {
        const existingChip = offDetail.querySelector('[data-wb-year]');
        if (existingChip) {
          existingChip.innerHTML = `📦 Archived since <strong>${wbYear}</strong>`;
        } else {
          const statsRow = offDetail.querySelector('.flex.flex-wrap.gap-2.text-sm.text-slate-600');
          if (statsRow) {
            const chip = document.createElement('span');
            chip.setAttribute('data-wb-year', '');
            chip.className = 'bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg';
            chip.innerHTML = `📦 Archived since <strong>${wbYear}</strong>`;
            statsRow.prepend(chip);
          }
        }
      }
    }
  }

  // ── Domain age ────────────────────────────────────────────────────────────
  const ageYrs = authData.domain_age_years ?? null;

  // ── Schema-declared entity type (what the site explicitly claims to be) ───
  // Only use unambiguous entity/business schemas — skip structural schemas that say
  // nothing about what type of organisation the site is (WebPage, ImageObject, etc.)
  const ENTITY_SCHEMAS = new Set([
    'Organization','Corporation','LocalBusiness','NewsMediaOrganization',
    'SoftwareApplication','WebApplication','MobileApplication',
    'Dentist','Physician','Hospital','MedicalClinic','LegalService','Attorney',
    'Accountant','RealEstateAgent','Plumber','Electrician','GeneralContractor',
    'HVACBusiness','Locksmith','MovingCompany','AutoDealer','AutoRepair',
    'Restaurant','FoodEstablishment','Bakery','CafeOrCoffeeShop',
    'Hotel','LodgingBusiness','Store','ClothingStore','BookStore',
    'HealthClub','SportsClub','Gym','BeautySalon','HairSalon',
    'CollegeOrUniversity','ElementarySchool','School','EducationalOrganization',
    'GovernmentOrganization','NGO','Nonprofit',
  ]);
  // Site-identity schemas are ones that tell you the type of entity
  const entitySchemas = (schemaData?.schemas_found ?? []).filter(s => ENTITY_SCHEMAS.has(s));

  // ── Sentences — only include sentences where every word is verifiable ──────
  const sentences = [];

  // Sentence 1: domain age / registration
  if (registrationYear !== null && ageYrs !== null) {
    const stability = ageYrs >= 10 ? 'a well-established online presence'
      : ageYrs >= 5  ? 'an established web presence'
      : ageYrs >= 2  ? 'a growing web presence'
      : 'a relatively new web presence';
    sentences.push(
      `The domain was registered in ${registrationYear} and has been active for ${ageYrs} year${ageYrs !== 1 ? 's' : ''}, reflecting ${stability}.`
    );
  } else if (ageYrs !== null) {
    const stability = ageYrs >= 10 ? 'a well-established online presence'
      : ageYrs >= 5  ? 'an established web presence'
      : ageYrs >= 2  ? 'a growing web presence'
      : 'a relatively new web presence';
    sentences.push(
      `The domain has been active for ${ageYrs} year${ageYrs !== 1 ? 's' : ''}, reflecting ${stability}.`
    );
  } else if (waybackYear !== null) {
    sentences.push(`The domain was first crawled by the Wayback Machine in ${waybackYear}.`);
  } else if (registrationYear !== null) {
    sentences.push(`The domain was registered in ${registrationYear}.`);
  }

  // Sentence 2: schema-declared entity type (only when unambiguous entity schemas exist)
  if (entitySchemas.length > 0) {
    const schemaDisplay = entitySchemas.slice(0, 2).join(' and ');
    sentences.push(`The site's structured data declares it as a ${esc(schemaDisplay)}.`);
  }

  // Sentence 3: verified authority signals (third-party lookups only)
  const authSignals = [];
  if (authData.wikipedia)   authSignals.push('a Wikipedia article');
  if (authData.wikidata_id) authSignals.push('a Wikidata knowledge graph entry');
  const backlinkCount = authData.indexed_page_count ?? 0;
  if (backlinkCount >= 10)  authSignals.push(`${backlinkCount}+ pages indexed in Common Crawl`);
  const socialCount = offPageData?.social_profiles?.length ?? 0;
  if (socialCount >= 2)     authSignals.push(`${socialCount} social media profiles`);
  if (authSignals.length > 0) {
    sentences.push(`Independent sources confirm ${authSignals.slice(0, 3).join(', ')}.`);
  }

  // Don't render the card if there's nothing factual to say
  if (sentences.length === 0) return;

  // ── Badges (all verifiable) ───────────────────────────────────────────────
  const badges = [];
  if (registrationYear) {
    badges.push(`<span class="bg-slate-100 text-slate-600 border border-slate-200 text-xs px-2.5 py-1 rounded-full">Est. ${registrationYear}</span>`);
  }
  if (ageYrs !== null) {
    const ageBg = ageYrs >= 10 ? 'bg-green-50 text-green-700 border-green-200'
      : ageYrs >= 5 ? 'bg-blue-50 text-blue-700 border-blue-200'
      : 'bg-amber-50 text-amber-700 border-amber-200';
    badges.push(`<span class="${ageBg} border text-xs px-2.5 py-1 rounded-full">${ageYrs} yr domain</span>`);
  }
  if (authData.wikipedia) {
    badges.push('<span class="bg-green-50 text-green-700 border border-green-200 text-xs px-2.5 py-1 rounded-full font-medium">✓ Wikipedia</span>');
  }
  if (authData.wikidata_id) {
    badges.push('<span class="bg-blue-50 text-blue-700 border border-blue-200 text-xs px-2.5 py-1 rounded-full font-medium">✓ Wikidata</span>');
  }
  if (authData.page_rank != null) {
    const oprBg = authData.page_rank >= 7 ? 'bg-green-50 text-green-700 border-green-200'
      : authData.page_rank >= 4 ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-slate-100 text-slate-600 border-slate-200';
    badges.push(`<span class="${oprBg} border text-xs px-2.5 py-1 rounded-full">OPR ${authData.page_rank.toFixed(1)}/10</span>`);
  }

  const el = document.createElement('div');
  el.id = 'card-site-intro';
  el.className = 'bg-white rounded-xl border border-slate-200 p-5 fade-in';
  el.dataset.category = 'all';
  el.style.order = cardOrder('card-site-intro');

  const wikiSummary = authData.wikipedia_summary
    ? `<div class="mt-3 pt-3 border-t border-slate-100">
        <div class="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
          <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>
          Wikipedia summary
        </div>
        <p class="text-xs text-slate-500 leading-relaxed italic">${esc(authData.wikipedia_summary.slice(0, 240))}${authData.wikipedia_summary.length > 240 ? '…' : ''}</p>
      </div>` : '';

  el.innerHTML = `
    <div class="flex items-center gap-3 mb-3">
      <div class="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0 overflow-hidden">
        <img src="https://www.google.com/s2/favicons?sz=32&domain_url=${esc(data.domain)}" alt="" class="w-5 h-5" onerror="this.style.display='none';this.parentElement.innerHTML='<svg class=\\'w-5 h-5 text-blue-400\\' fill=\\'none\\' viewBox=\\'0 0 24 24\\' stroke=\\'currentColor\\'><circle cx=\\'12\\' cy=\\'12\\' r=\\'10\\'/></svg>'">
      </div>
      <div>
        <div class="font-semibold text-sm text-slate-800">About ${esc(data.domain)}</div>
        <div class="text-[10px] text-slate-400 mt-0.5">Verified signals only · no AI inference</div>
      </div>
    </div>
    <div class="space-y-1.5 text-sm text-slate-600 leading-relaxed">
      ${sentences.map(s => `<p class="flex gap-2"><span class="text-blue-300 shrink-0 mt-1">›</span><span>${s}</span></p>`).join('')}
    </div>
    ${badges.length > 0 ? `<div class="flex flex-wrap gap-1.5 mt-4">${badges.join('')}</div>` : ''}
    ${wikiSummary}
  `;

  document.getElementById('modules').appendChild(el);
  applyActiveCatFilter(el);
}

function renderFullAudit(data) {
  if (!data?.domain) return;
  currentAuditData = data;
  currentAuditId = data.audit_id ?? currentAuditId;
  if (!reportLanguageManuallySet) {
    reportLanguage = REPORT_UI?.inferReportLanguage(data, UI_LANGUAGE) ?? UI_LANGUAGE;
  }
  applyReportLanguageLabels();
  renderEvidenceFirstSummary(data);
  const scoreSummary = REPORT_UI?.normalizeScoreSummary(data) ?? {
    present: false,
    overall: typeof data.overall_score === 'number' ? data.overall_score : null,
    seo: typeof data.seo_score === 'number' ? data.seo_score : null,
    geo: typeof data.geo_score === 'number' ? data.geo_score : null,
    aeo: typeof data.aeo_score === 'number' ? data.aeo_score : null,
    coverage: null,
    confidence: null,
  };
  const auditDate = data.created_at
    ? new Date(data.created_at).toLocaleString(UI_LANGUAGE === 'zh' ? 'zh-CN' : 'en-US')
    : new Date().toLocaleString(UI_LANGUAGE === 'zh' ? 'zh-CN' : 'en-US');
  // Track recent audits in localStorage
  saveRecentAudit(data.domain);
  renderRecentAudits();

  // Update domain header
  const nameEl = document.getElementById('domain-name');
  const dateEl = document.getElementById('audit-date');
  const faviconEl = document.getElementById('domain-favicon');
  if (nameEl) nameEl.textContent = data.domain;
  // Show age of cached result so users know if it's stale
  let dateLabel = UI_LANGUAGE === 'zh' ? `审查完成 · ${auditDate}` : `Audit complete · ${auditDate}`;
  if (data.created_at) {
    const ageMs = Date.now() - new Date(data.created_at).getTime();
    const ageH = Math.round(ageMs / 3600000);
    const ageD = Math.floor(ageMs / 86400000);
    const ageStr = UI_LANGUAGE === 'zh'
      ? (ageD >= 1 ? `${ageD} 天前` : ageH >= 1 ? `${ageH} 小时前` : '刚刚')
      : (ageD >= 1 ? `${ageD}d ago` : ageH >= 1 ? `${ageH}h ago` : 'just now');
    dateLabel = UI_LANGUAGE === 'zh' ? `审查完成 · ${ageStr}` : `Audit complete · ${ageStr}`;
    if (ageH >= 6 && dateEl) {
      dateEl.title = UI_LANGUAGE === 'zh'
        ? `这是 ${auditDate} 的缓存结果；点击重新审查获取最新数据`
        : `Cached result from ${auditDate} — click Fresh Audit for fresh data`;
      dateEl.classList.add('text-amber-500');
    }
  }
  if (dateEl) dateEl.textContent = dateLabel;
  if (faviconEl && !faviconEl.querySelector('img')) {
    faviconEl.innerHTML = `<img src="https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(data.domain)}" alt="" class="w-6 h-6" onerror="this.style.display='none'">`;
  }
  // Set data-domain on score-header for print header
  const hdr = document.getElementById('score-header');
  if (hdr) hdr.dataset.domain = data.domain;

  // Score rings
  const hasScoreArea = scoreSummary.present
    || [scoreSummary.overall, scoreSummary.seo, scoreSummary.geo, scoreSummary.aeo].some(score => typeof score === 'number');
  if (hasScoreArea) {
    const scoresEl = document.getElementById('scores');
    scoresEl.classList.remove('hidden');
    // Brief pop-in animation on reveal
    scoresEl.classList.remove('score-reveal');
    void scoresEl.offsetWidth; // reflow to re-trigger
    scoresEl.classList.add('score-reveal');

    const coverageContext = scoreSummary.coverage != null
      ? `${reportLanguage === 'zh' ? '覆盖率' : 'Coverage'} ${Math.round(scoreSummary.coverage)}%`
      : '';
    if (scoreSummary.overall !== null) setScoreCircle('overall', scoreSummary.overall, '#2563eb');
    else setUnavailableScoreCircle('overall', coverageContext);
    if (scoreSummary.seo !== null) setScoreCircle('seo', scoreSummary.seo, '#2563eb');
    else setUnavailableScoreCircle('seo', coverageContext);
    if (scoreSummary.geo !== null) setScoreCircle('geo', scoreSummary.geo, '#7c3aed');
    else setUnavailableScoreCircle('geo', coverageContext);

    // AEO score (Answer Engine Optimisation — 5th metric)
    if (scoreSummary.aeo !== null) {
      const aeoWrap = document.getElementById('aeo-circle-wrap');
      if (aeoWrap) aeoWrap.style.display = '';   // always show when data present
      setScoreCircle('aeo', scoreSummary.aeo, '#f59e0b');
      const aeoCtx = document.getElementById('aeo-context');
      if (aeoCtx) {
        const geoHigh = (scoreSummary.geo ?? 0) >= 65;
        if (scoreSummary.aeo >= 70) {
          aeoCtx.textContent = reportLanguage === 'zh' ? '适合答案抽取' : 'AI-answer ready';
        } else if (scoreSummary.aeo >= 40) {
          aeoCtx.textContent = reportLanguage === 'zh' ? '部分适配' : 'Partially optimised';
        } else if (geoHigh) {
          aeoCtx.textContent = reportLanguage === 'zh' ? '实体清晰，结构待加强' : 'Known entity · improve structure';
        } else {
          aeoCtx.textContent = reportLanguage === 'zh' ? '加强可提取的答案结构' : 'Improve extractable answers';
        }
      }
    } else if (scoreSummary.present) {
      const aeoWrap = document.getElementById('aeo-circle-wrap');
      if (aeoWrap) aeoWrap.style.display = '';
      setUnavailableScoreCircle('aeo', coverageContext);
    } else {
      const aeoWrap = document.getElementById('aeo-circle-wrap');
      if (aeoWrap) aeoWrap.style.display = 'none';
    }

    // Cross-metric insight appended to overall context
    const _seo = scoreSummary.seo, _geo = scoreSummary.geo;
    // setScoreCircle already sets overall-context; we enrich it after
    if (scoreSummary.overall !== null && _seo !== null && _geo !== null) requestAnimationFrame(() => {
      const ctxEl = document.getElementById('overall-context');
      if (!ctxEl) return;
      const delta = Math.abs(_seo - _geo);
      if (delta >= 20) {
        const weaker = _seo < _geo ? 'SEO' : 'AI visibility';
        ctxEl.textContent = scoreContext(scoreSummary.overall) + ` · improve ${weaker}`;
      }
    });

    // Performance score: Lighthouse mobile → desktop → PageSpeed → CrUX composite
    const ps = data.modules?.on_page_seo?.data?.page_speed;
    const cruxData = data.modules?.crux?.data;
    const lighthouseData = data.modules?.lighthouse?.data;
    const perfScore = lighthouseData?.mobile_score
      ?? lighthouseData?.desktop_score
      ?? ps?.performance
      ?? (cruxData?.has_data ? cruxData.performance_score : null);
    if (perfScore !== null && perfScore !== undefined) {
      setScoreCircle('perf', perfScore, '#16a34a');
      updatePerformanceContext(data);
    } else {
      // No performance data — hide the entire performance circle so there's no empty ring
      const perfWrap = document.getElementById('perf-circle-wrap');
      if (perfWrap) perfWrap.style.display = 'none';
    }

    // Score insight callout (plain-English summary below the gauges)
    const insightEl = document.getElementById('score-insight');
    const insightText = document.getElementById('score-insight-text');
    const insightSub = document.getElementById('score-insight-sub');
    if (insightEl && insightText && !scoreSummary.present && scoreSummary.overall !== null) {
      const _iseo = scoreSummary.seo ?? 0, _igeo = scoreSummary.geo ?? 0;
      const pctLabel = scoreContext(scoreSummary.overall);
      insightText.textContent = `${scoreSummary.overall}/100 overall · ${pctLabel}`;
      // Dynamic colour tint based on score
      const s = scoreSummary.overall;
      const [bg, border, textCls] = s >= 80 ? ['#f0fdf4','#bbf7d0','#15803d']
                                   : s >= 60 ? ['#eff6ff','#bfdbfe','#1d4ed8']
                                   :           ['#fffbeb','#fde68a','#92400e'];
      insightEl.style.cssText = `background:${bg};border:1px solid ${border};border-radius:12px;`;
      insightText.style.color = textCls;
      let sub = '';
      if (_iseo > _igeo + 15) {
        sub = `SEO fundamentals are solid (${_iseo}/100) but AI search visibility lags behind (${_igeo}/100). Adding structured data, E-E-A-T signals, and llms.txt can close the gap.`;
      } else if (_igeo > _iseo + 15) {
        sub = `Strong AI visibility signals (${_igeo}/100). Shoring up technical SEO (${_iseo}/100) will unlock top-tier ranking performance across both traditional and AI search.`;
      } else if (scoreSummary.overall >= 80) {
        sub = `Excellent foundation — fine-tune the highest-impact signals below to enter the top tier.`;
      } else if (scoreSummary.overall >= 60) {
        sub = `Good base to build from. The prioritised action plan below shows where each fix will move your score most.`;
      } else {
        sub = `Multiple foundational issues found. Follow the ranked action plan below — even fixing the top 3 will noticeably improve your visibility.`;
      }
      insightSub.textContent = sub;
      insightEl.classList.remove('hidden');
      document.getElementById('data-provenance-row')?.classList.remove('hidden');
    }

    // CWV pill row — Lighthouse primary, PageSpeed fallback, CrUX p75 last
    const cwvRow = document.getElementById('cwv-row');
    if (cwvRow) {
      let pills = '';
      if (lighthouseData?.lcp_ms != null) {
        // Lighthouse lab data
        const ld = lighthouseData;
        pills = [
          ld.lcp_ms != null && cwvPill('LCP',  (ld.lcp_ms/1000).toFixed(1)+'s', ld.lcp_ms <= 2500 ? 'good' : ld.lcp_ms <= 4000 ? 'needs' : 'poor'),
          ld.cls    != null && cwvPill('CLS',  ld.cls.toFixed(3),                ld.cls    <= 0.1  ? 'good' : ld.cls    <= 0.25  ? 'needs' : 'poor'),
          ld.fcp_ms != null && cwvPill('FCP',  (ld.fcp_ms/1000).toFixed(1)+'s', ld.fcp_ms <= 1800 ? 'good' : ld.fcp_ms <= 3000  ? 'needs' : 'poor'),
          ld.tbt_ms != null && cwvPill('TBT',  Math.round(ld.tbt_ms)+'ms',       ld.tbt_ms <= 200  ? 'good' : ld.tbt_ms <= 600   ? 'needs' : 'poor'),
          ld.desktop_score != null && cwvPill('Desktop', ld.desktop_score+'/100', ld.desktop_score >= 90 ? 'good' : ld.desktop_score >= 50 ? 'needs' : 'poor'),
        ].filter(Boolean).join('');
      } else if (ps) {
        pills = [
          ps.lcp_s  != null && cwvPill('LCP',  ps.lcp_s.toFixed(1)  + 's', ps.lcp_s  <= 2.5 ? 'good' : ps.lcp_s  <= 4   ? 'needs' : 'poor'),
          ps.cls    != null && cwvPill('CLS',  ps.cls.toFixed(3),           ps.cls    <= 0.1  ? 'good' : ps.cls    <= 0.25 ? 'needs' : 'poor'),
          ps.fcp_s  != null && cwvPill('FCP',  ps.fcp_s.toFixed(1)  + 's', ps.fcp_s  <= 1.8  ? 'good' : ps.fcp_s  <= 3   ? 'needs' : 'poor'),
          ps.ttfb_s != null && cwvPill('TTFB', ps.ttfb_s.toFixed(2) + 's', ps.ttfb_s <= 0.8  ? 'good' : ps.ttfb_s <= 1.8 ? 'needs' : 'poor'),
          ps.tbt_ms != null && cwvPill('TBT',  ps.tbt_ms + 'ms',           ps.tbt_ms <= 200  ? 'good' : ps.tbt_ms <= 600 ? 'needs' : 'poor'),
        ].filter(Boolean).join('');
      } else if (cruxData?.has_data) {
        // Fall back to CrUX p75 real-user metrics when PageSpeed is unavailable
        const cx = cruxData;
        const lcp  = cx.lcp?.p75;  const cls = cx.cls?.p75;
        const inp  = cx.inp?.p75;  const fcp = cx.fcp?.p75; const ttfb = cx.ttfb?.p75;
        pills = [
          lcp  != null && cwvPill('LCP',  (lcp/1000).toFixed(1)+'s',        lcp  <= 2500 ? 'good' : lcp  <= 4000 ? 'needs' : 'poor'),
          cls  != null && cwvPill('CLS',  Number(cls).toFixed(3),            cls  <= 0.1  ? 'good' : cls  <= 0.25 ? 'needs' : 'poor'),
          inp  != null && cwvPill('INP',  inp+'ms',                          inp  <= 200  ? 'good' : inp  <= 500  ? 'needs' : 'poor'),
          fcp  != null && cwvPill('FCP',  (fcp/1000).toFixed(1)+'s',        fcp  <= 1800 ? 'good' : fcp  <= 3000 ? 'needs' : 'poor'),
          ttfb != null && cwvPill('TTFB', ttfb+'ms',                         ttfb <= 800  ? 'good' : ttfb <= 1800 ? 'needs' : 'poor'),
        ].filter(Boolean).join('');
      }
      if (pills) {
        cwvRow.innerHTML = `<div class="flex flex-wrap gap-2 justify-center">${pills}</div>`;
        cwvRow.classList.remove('hidden');
      }
    }
  }

  renderScoreSummaryNote(data);

  // Score delta from localStorage
  const lsKey = `geoscore:${data.domain}`;
  const prev = (() => { try { return JSON.parse(localStorage.getItem(lsKey) || 'null'); } catch { return null; } })();
  const scoreVersionsMatch = !scoreSummary.scoreVersion
    ? !prev?.scoreVersion
    : prev?.scoreVersion === scoreSummary.scoreVersion;
  if (prev && scoreVersionsMatch && scoreSummary.overall !== null) {
    const delta = scoreSummary.overall - (prev.overall ?? scoreSummary.overall);
    const deltaEl = document.getElementById('overall-delta');
    if (deltaEl && delta !== 0) {
      const sign = delta > 0 ? '▲ +' : '▼ ';
      deltaEl.textContent = `${sign}${delta} since last check`;
      deltaEl.className = `text-[10px] font-semibold mt-0.5 ${delta > 0 ? 'text-green-600' : 'text-orange-500'}`;
      deltaEl.classList.remove('hidden');
    }
  }
  // Save scores for next visit
  if (scoreSummary.overall !== null) {
    const ps = data.modules?.on_page_seo?.data?.page_speed;
    try { localStorage.setItem(lsKey, JSON.stringify({
      overall: scoreSummary.overall, seo: scoreSummary.seo, geo: scoreSummary.geo,
      perf: ps?.performance ?? null, ts: Date.now(),
      scoreVersion: scoreSummary.scoreVersion ?? null,
    })); } catch { /* Safari private mode */ }
  }

  // Wire action buttons
  wireActionButtons(data);

  const evidenceAudit = renderEvidenceReportSections(data);
  if (!evidenceAudit && data.modules) {
    Object.entries(data.modules).forEach(([name, result]) => {
      const el = document.getElementById(`module-${name}`);
      if (!el || el.querySelector('.spinner')) renderSection({ module: name, ...result });
    });
  }

  // Pass/Fail summary bar
  if (evidenceAudit) {
    renderEvidenceCheckSummaryBar(data);
  } else if (data.modules) {
    let passed = 0, warnings = 0, critical = 0;
    Object.values(data.modules).forEach((m) => {
      if (m.status === 'ok') passed++;
      else if (m.status === 'partial') warnings++;
      else if (m.status === 'failed') critical++;
    });
    const bar = document.getElementById('summary-bar');
    if (bar) {
      bar.innerHTML = [
        passed   ? `<span class="flex items-center gap-1.5 text-green-700 font-medium"><span class="w-4 h-4 rounded-full bg-green-100 flex items-center justify-center text-[10px]">✓</span>${passed} passed</span>` : '',
        warnings ? `<span class="flex items-center gap-1.5 text-amber-700 font-medium"><span class="w-4 h-4 rounded-full bg-amber-100 flex items-center justify-center text-[10px]">⚠</span>${warnings} warnings</span>` : '',
        critical ? `<span class="flex items-center gap-1.5 text-orange-700 font-medium"><span class="w-4 h-4 rounded-full bg-orange-100 flex items-center justify-center text-[10px]">✗</span>${critical} critical</span>` : '',
      ].filter(Boolean).join('<span class="text-slate-300">·</span>');
      bar.classList.remove('hidden');
    }
  }

  if (!evidenceAudit && data.modules?.recommendations?.data?.length) {
    renderRecommendations(data.modules.recommendations.data);
  }

  if (!evidenceAudit) {
    renderSiteIntro(data);
    renderComputedSections(data);
  }

  // Update category tab counts once all cards are inserted
  setTimeout(updateCatTabCounts, 350);

  // Show embed CTA after audit
  document.getElementById('embed-cta')?.classList.remove('hidden');
}

function cwvPill(label, value, status) {
  const cls = { good: 'cwv-good', needs: 'cwv-needs', poor: 'cwv-poor' }[status] ?? 'cwv-needs';
  const icon = status === 'good' ? '✓' : status === 'poor' ? '✗' : '~';
  const tips = {
    LCP:  'Largest Contentful Paint — how long the biggest visible element takes to load. Good: ≤2.5s',
    CLS:  'Cumulative Layout Shift — how much the page jumps around while loading. Good: ≤0.1',
    FCP:  'First Contentful Paint — time until first content appears on screen. Good: ≤1.8s',
    TTFB: 'Time to First Byte — how fast the server responds. Good: ≤0.8s',
    TBT:  'Total Blocking Time — how long the browser is stuck before it can respond to input. Good: ≤200ms',
  };
  const tip = tips[label] ? ` class="tech-tip" title="${tips[label]}"` : '';
  return `<span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full ${cls}">
    ${icon} <span class="font-bold"${tip}>${label}</span> ${esc(value)}
  </span>`;
}

function wireActionButtons(data) {
  const scoreSummary = REPORT_UI?.normalizeScoreSummary(data) ?? {
    seo: Number.isFinite(data?.seo_score) ? data.seo_score : null,
    geo: Number.isFinite(data?.geo_score) ? data.geo_score : null,
    overall: Number.isFinite(data?.overall_score) ? data.overall_score : null,
    scoreVersion: null,
  };
  // Nav "Start Fresh" button — show it now that we have a domain, wire once
  const navFreshBtn = document.getElementById('nav-fresh-btn');
  if (navFreshBtn) {
    navFreshBtn.classList.remove('hidden');
    navFreshBtn.classList.add('flex');
    if (!navFreshBtn.dataset.wired) {
      navFreshBtn.dataset.wired = '1';
      navFreshBtn.addEventListener('click', () => {
        computedSectionsRendered = false;
        document.getElementById('modules').innerHTML = '';
        document.getElementById('scores').classList.add('hidden');
        navFreshBtn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> ${UI_LANGUAGE === 'zh' ? '重新审查' : 'Start Fresh'}`;
        navFreshBtn.dataset.wired = '';
        openAuditStream(currentAuditRequest ?? { domain: currentDomain, mode: 'site', targetUrl: null, archetypeHint: null }, 0, true);
      });
    }
  }


  // Share link — copies current URL (already has ?d=domain from pushState)
  const shareBtn = document.getElementById('share-btn');
  if (shareBtn && !shareBtn.dataset.wired) {
    shareBtn.dataset.wired = '1';
    shareBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(window.location.href).then(() => {
        const orig = shareBtn.innerHTML;
        shareBtn.textContent = '✓ Link copied!';
        shareBtn.classList.add('text-green-600', 'border-green-300');
        setTimeout(() => { shareBtn.innerHTML = orig; shareBtn.classList.remove('text-green-600', 'border-green-300'); }, 2500);
      }).catch(() => {
        prompt('Copy this link:', window.location.href);
      });
    });
  }

  // Deterministic full repair report. This path never calls /api/fix.
  const agentBtn = document.getElementById('agent-btn');
  if (agentBtn && !agentBtn.dataset.wired) {
    agentBtn.dataset.wired = '1';
    agentBtn.addEventListener('click', () => {
      const orig = agentBtn.innerHTML;
      agentBtn.textContent = uiText('status.building');
      setTimeout(() => {
        downloadAgentMarkdown(data);
        agentBtn.textContent = uiText('status.downloaded');
        setTimeout(() => { agentBtn.innerHTML = orig; }, 2000);
      }, 50);
    });
  }

  // PDF export — opens a formatted report in a new window (print/save as PDF from there)
  const exportBtn = document.getElementById('export-btn');
  if (exportBtn && !exportBtn.dataset.wired) {
    exportBtn.dataset.wired = '1';
    exportBtn.addEventListener('click', () => openReportWindow(data));
  }

  // (shareBtn already wired above — duplicate block removed)

  // Re-audit diff — load history and show score deltas in the header
  if (scoreSummary.seo !== null && scoreSummary.geo !== null) {
    loadAndShowDiff(data.domain, scoreSummary);
  }

  // Tweet / X share
  const tweetBtn = document.getElementById('tweet-btn');
  if (tweetBtn && !tweetBtn.dataset.wired) {
    tweetBtn.dataset.wired = '1';
    tweetBtn.addEventListener('click', () => {
      const score = scoreSummary.overall;
      const seo = scoreSummary.seo;
      const geo = scoreSummary.geo;
      const text = score === null
        ? `${data.domain} has insufficient evidence for a defensible GeoScore yet.\n\nCheck the evidence coverage and audit yours:`
        : `My ${data.domain} scored ${Math.round(score)}/100 on GeoScore\n\nSEO: ${seo === null ? 'insufficient evidence' : Math.round(seo)} · AI Visibility: ${geo === null ? 'insufficient evidence' : Math.round(geo)}\n\nCheck yours:`;
      const url = `https://geo.sayori.org/?d=${encodeURIComponent(data.domain)}`;
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank', 'noopener');
    });
  }

  // Embed
  const showEmbedBtn = document.getElementById('show-embed-btn');
  if (showEmbedBtn && !showEmbedBtn.dataset.wired) {
    showEmbedBtn.dataset.wired = '1';
    showEmbedBtn.addEventListener('click', () => showEmbedCode(data.domain));
  }
}


function showEmbedCode(domain) {
  const existing = document.getElementById('card-embed-code');
  if (existing) { existing.scrollIntoView({ behavior: 'smooth' }); return; }
  const embedUrl = `https://geo.sayori.org/?d=${encodeURIComponent(domain)}`;
  const scriptTag = `<script src="https://geo-api.sayori.org/embed.js" data-domain="${domain}" async><\/script>`;
  const el = document.createElement('div');
  el.id = 'card-embed-code';
  el.className = 'bg-white rounded-xl border border-slate-200 p-4 fade-in';
  el.style.order = cardOrder('card-embed-code');
  el.dataset.category = 'previews';
  el.innerHTML = `
    <div class="font-semibold text-sm mb-3">🔗 Embed Widget</div>
    <p class="text-xs text-slate-500 mb-3">Add a live GeoScore badge to any website or documentation:</p>
    <div class="space-y-2">
      <div>
        <div class="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Script embed (badge)</div>
        <div class="relative">
          <pre class="text-[10px] bg-slate-900 text-green-300 p-3 rounded-lg overflow-x-auto leading-relaxed">${esc(scriptTag)}</pre>
          <button data-copy="${esc(scriptTag)}"
            class="absolute top-2 right-2 text-[10px] bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-0.5 rounded transition-colors">Copy</button>
        </div>
      </div>
      <div>
        <div class="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Direct link</div>
        <a href="${esc(embedUrl)}" target="_blank" class="text-xs text-blue-600 underline break-all">${esc(embedUrl)}</a>
      </div>
    </div>`;
  document.getElementById('modules').appendChild(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function updateModuleProgress(name, status, detail) {
  if (name === 'cache') return; // cache is internal — never show as a card
  // These modules are rendered by renderComputedSections, not as streaming cards.
  // Without this guard, they'd get a permanent spinner that never resolves.
  if (name === 'recommendations' || name === 'keywords' || name === 'competitor_snapshot') return;
  // Update progress status text with descriptive per-module message
  const statusEl = document.getElementById('progress-status');
  if (statusEl) {
    const desc = MODULE_LOADING_KEY[name] ? uiText(MODULE_LOADING_KEY[name]) : null;
    const label = moduleName(name).replace(/^[^a-zA-Z]+/, '').trim();
    const msg = desc || (UI_LANGUAGE === 'zh' ? `正在检查 ${label}…` : `Checking ${label}…`);
    statusEl.innerHTML = `<span class="module-checking"><span class="status-pulse inline-block mr-1.5"></span>${msg}</span>`;
  }
  if (document.getElementById(`module-${name}`)) return;
  const el = document.createElement('div');
  el.id = `module-${name}`;
  el.className = 'bg-white rounded-xl border border-slate-200 p-4 fade-in';
  el.dataset.category = MODULE_CATEGORY[name] || 'seo';
  const srcInfo = MODULE_SOURCE[name];
  const srcBadge = srcInfo ? `<span class="src-badge ${srcInfo.cls} hidden sm:inline-flex mr-1">${srcInfo.label}</span>` : '';
  el.innerHTML = `
    <div class="flex items-center gap-2">
      <svg class="spinner w-3.5 h-3.5 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
      </svg>
      <span class="font-medium text-sm text-slate-700">${moduleName(name)}</span>
      <div class="flex items-center gap-1.5 ml-auto shrink-0">
        ${srcBadge}
        <span class="module-elapsed text-[11px] font-mono text-blue-400" data-start-ms="${Date.now()}">0s</span>
      </div>
    </div>
    <div class="mt-3 space-y-2">
      <div class="skeleton h-2 rounded-full" style="width:85%;opacity:0.5"></div>
      <div class="skeleton h-2 rounded-full" style="width:65%;opacity:0.35"></div>
      <div class="skeleton h-2 rounded-full" style="width:45%;opacity:0.25"></div>
    </div>`;
  el.style.order = cardOrder(el.id);
  document.getElementById('modules').appendChild(el);
  applyActiveCatFilter(el);
}

function renderSection(d) {
  if (d.module === 'recommendations' || d.module === 'keywords' || d.module === 'competitor_snapshot') return;
  if (d.module === 'lighthouse' && REPORT_UI) {
    d = {
      ...d,
      status: REPORT_UI.lighthouseStatus(d.data, d.error, d.strategies, d.status),
    };
    currentLighthouseState = {
      status: d.status,
      data: d.data ?? null,
      error: d.error ?? null,
      strategies: d.strategies ?? [],
      duration_ms: d.duration_ms ?? null,
      domain: currentDomain,
    };
  }
  // Update progress status to show completion
  const statusEl = document.getElementById('progress-status');
  if (statusEl && d.module !== 'bot_blocked') {
    const label = moduleName(d.module).replace(/^[^a-zA-Z]+/, '').trim();
    const statusMeta = d.status === 'ok'
      ? { cls: 'text-green-600', icon: '✓' }
      : d.status === 'partial'
        ? { cls: 'text-amber-600', icon: '⚠' }
        : { cls: 'text-orange-600', icon: '✗' };
    statusEl.innerHTML = `<span class="${statusMeta.cls} font-medium">${statusMeta.icon} ${label}</span>`;
  }

  // ── Bot-challenge / WAF interstitial warning banner ───────────────────────
  // When a site blocks automated fetches (CAPTCHA, Cloudflare challenge, etc.)
  // we emit a 'bot_blocked' section.  Show a prominent amber banner at the
  // top of the results so users understand that module scores are limited,
  // rather than seeing unexplained zeros and trusting them as real findings.
  if (d.module === 'bot_blocked') {
    const data = d.data ?? {};
    const reason = data.reason ?? 'Bot-challenge page detected';
    const note = data.note ?? 'Page content could not be analysed — scores reflect domain-level signals only.';
    let banner = document.getElementById('module-bot_blocked');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'module-bot_blocked';
      // Prepend so it always appears first, above all module cards
      const modulesEl = document.getElementById('modules');
      modulesEl.insertBefore(banner, modulesEl.firstChild);
    }
    banner.className = 'rounded-xl border border-amber-300 bg-amber-50 p-4 fade-in flex gap-3 items-start';
    banner.dataset.category = 'all'; // always visible regardless of active filter
    banner.innerHTML = `
      <span class="text-2xl leading-none mt-0.5" aria-hidden="true">🛡️</span>
      <div class="min-w-0">
        <p class="font-semibold text-amber-800 text-sm">Bot Protection Detected — Limited Analysis</p>
        <p class="text-amber-700 text-sm mt-0.5">${esc(note)}</p>
        <p class="text-amber-600 text-xs mt-1.5 font-mono bg-amber-100 rounded px-2 py-1 inline-block">${esc(reason)}</p>
      </div>`;
    // Mark this audit as bot-blocked and remove any cards that already rendered
    // with unreliable data (security_audit grades the error page headers, the others
    // have no page content and produce empty/zero results).
    window._auditBotBlocked = true;
    ['security_audit','accessibility','schema_audit','on_page_seo','content_quality'].forEach(function(m) {
      const card = document.getElementById('module-' + m);
      if (card) card.remove();
    });
    return;
  }

  // ── Silently suppress AI-unavailable results ──────────────────────────────
  // status='skipped' → AI quota hit / unavailable, no useful data.
  // is_reliable=false → AI failed entirely; only generic template fallback returned.
  // In both cases the user sees nothing rather than a placeholder or stale guess.
  if (d.status === 'skipped' || d.data?.is_reliable === false) {
    const existing = document.getElementById(`module-${d.module}`);
    if (existing) existing.remove();
    return;
  }

  // ── Suppress modules that produce garbage when the site blocks our fetch ──
  // security_audit: grades the 403 error page headers, not the real site.
  // accessibility, schema_audit, on_page_seo, content_quality: no page content
  // to analyse — results are empty zeros that would mislead users.
  const _BOT_SUPPRESS = new Set(['security_audit','accessibility','schema_audit','on_page_seo','content_quality']);
  if (window._auditBotBlocked && _BOT_SUPPRESS.has(d.module)) {
    const existing = document.getElementById(`module-${d.module}`);
    if (existing) existing.remove();
    return;
  }

  let el = document.getElementById(`module-${d.module}`);
  if (!el) {
    el = document.createElement('div');
    el.id = `module-${d.module}`;
    el.className = 'bg-white rounded-xl border border-slate-200 p-5 fade-in';
    document.getElementById('modules').appendChild(el);
  }
  el.style.order = cardOrder(el.id);
  el.dataset.category = MODULE_CATEGORY[d.module] || 'seo';

  const statusIcon = {
    ok:      '<span class="text-green-600 text-lg">✓</span>',
    failed:  '<span class="text-orange-500 text-lg">✗</span>',
    skipped: '<span class="text-slate-400 text-lg">—</span>',
    partial: '<span class="text-yellow-500 text-lg">⚠</span>',
  }[d.status] ?? '<span class="text-slate-400 text-lg">—</span>';
  const data = d.data;
  const ms = d.duration_ms != null ? `<span class="text-sm text-slate-300 ml-auto">${d.duration_ms < 1000 ? d.duration_ms + 'ms' : (d.duration_ms / 1000).toFixed(1) + 's'}</span>` : '';
  let detail = '';

  // Cache each module's data so cross-module fields can be referenced during render
  window._auditModCache = window._auditModCache || {};
  if (d.module && d.data) window._auditModCache[d.module] = d.data;

  if (d.module === 'technical_seo' && data) {
    const issues = (data.issues ?? []).slice(0, 6).map(i =>
      `<li class="text-sm ${i.startsWith('CRITICAL') ? 'text-orange-700 font-semibold' : 'text-blue-600'}">• ${esc(i)}</li>`
    ).join('');

    const sh = data.security_headers ?? {};
    const secScore = sh.score ?? 0;
    const secBar = secScore >= 80 ? 'bg-green-400' : secScore >= 50 ? 'bg-yellow-400' : 'bg-orange-400';
    const secText = secScore >= 80 ? 'text-green-700' : secScore >= 50 ? 'text-yellow-700' : 'text-orange-600';
    const checksTotal = (data.checks ?? []).length;
    const checksPassed = (data.checks ?? []).filter(c => c.passed).length;
    const scoreNum = data.score ?? 0;
    const scoreBar = scoreNum >= 80 ? 'bg-green-400' : scoreNum >= 60 ? 'bg-yellow-400' : 'bg-orange-400';
    const scoreText = scoreNum >= 80 ? 'text-green-700' : scoreNum >= 60 ? 'text-yellow-700' : 'text-orange-600';
    const ttfb = data.response_time_ms ?? 0;
    const ttfbColor = ttfb < 800 ? 'text-green-700' : ttfb < 2000 ? 'text-yellow-700' : 'text-orange-600';
    const llmsView = REPORT_UI?.llmsTxtView?.(data, reportLanguage) ?? {
      state: data.llms_txt_status === 'error' ? 'unknown' : data.llms_txt_present ? 'present' : 'missing',
      badge: data.llms_txt_status === 'error' ? '⚠ llms.txt could not be verified' : data.llms_txt_present ? '✓ llms.txt' : '✗ No llms.txt',
    };
    const llmsBadgeClass = llmsView.state === 'present'
      ? 'bg-green-50 text-green-700 border-green-200'
      : llmsView.state === 'missing'
        ? 'bg-slate-100 text-slate-500 border-slate-200'
        : 'bg-amber-50 text-amber-700 border-amber-200';
    const secHeaderItems = [
      { label: 'HSTS', val: sh.hsts }, { label: 'X-Content', val: sh.xcontent },
      { label: 'X-Frame', val: sh.xframe }, { label: 'CSP', val: sh.csp },
      { label: 'Referrer', val: sh.referrer }, { label: 'Permissions', val: sh.permissions },
    ].map(h => `<div class="flex items-center gap-1.5">
      <span class="${h.val ? 'text-green-600' : 'text-orange-500'} font-semibold">${h.val ? '✓' : '✗'}</span>
      <span class="text-sm text-slate-600">${h.label}</span>
    </div>`).join('');

    detail = `<div class="mt-3 space-y-3">
      <div class="flex items-center gap-3">
        <div class="flex-1 bg-slate-100 rounded-full h-2.5">
          <div class="${scoreBar} h-2.5 rounded-full" style="width:${scoreNum}%"></div>
        </div>
        <span class="text-base font-bold ${scoreText} shrink-0">${scoreNum}/100</span>
        ${checksTotal ? `<span class="text-sm text-slate-400 shrink-0">${checksPassed}/${checksTotal} checks</span>` : ''}
      </div>
      <div class="grid grid-cols-3 gap-2 text-center">
        <div class="bg-slate-50 rounded-lg p-3">
          <div class="text-sm font-bold ${ttfbColor}">${ttfb}ms</div>
          <div class="text-xs text-slate-400 mt-0.5">Response time</div>
        </div>
        <div class="bg-slate-50 rounded-lg p-3">
          <div class="text-sm font-bold text-slate-700">${data.page_weight_kb ?? '—'}KB</div>
          <div class="text-xs text-slate-400 mt-0.5">Page weight</div>
        </div>
        <div class="bg-slate-50 rounded-lg p-3">
          <div class="text-sm font-bold ${(data.sitemap_url_count ?? 0) > 0 ? 'text-green-700' : 'text-orange-600'}">${(data.sitemap_url_count ?? 0) > 0 ? data.sitemap_url_count : '✗'}</div>
          <div class="text-xs text-slate-400 mt-0.5">Sitemap URLs</div>
        </div>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <span class="${(data.blocked_ai_bots?.length ?? 0) > 0 ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-green-50 text-green-700 border-green-200'} border text-xs px-2.5 py-1 rounded-full font-medium">${(data.blocked_ai_bots?.length ?? 0) > 0 ? '🚫 AI bots blocked' : '✓ AI bots allowed'}</span>
        <span class="${llmsBadgeClass} border text-xs px-2.5 py-1 rounded-full font-medium">${esc(llmsView.badge)}</span>
        ${data.compression?.enabled ? `<span class="bg-blue-50 text-blue-700 border border-blue-200 text-xs px-2.5 py-1 rounded-full font-medium">${esc(data.compression.encoding)} ✓</span>` : '<span class="bg-orange-50 text-orange-600 border border-orange-200 text-xs px-2.5 py-1 rounded-full font-medium">No compression</span>'}
        ${(data.render_blocking_scripts ?? 0) > 0 ? `<span class="bg-amber-50 text-amber-700 border border-amber-200 text-xs px-2.5 py-1 rounded-full font-medium">⚠ ${data.render_blocking_scripts} blocking scripts</span>` : ''}
        ${data.dom_element_count ? `<span class="text-xs text-slate-500 border border-slate-200 px-2.5 py-1 rounded-full">${data.dom_element_count} DOM elements</span>` : ''}
        ${data.http3_supported ? `<span class="bg-blue-50 text-blue-700 border border-blue-200 text-xs px-2.5 py-1 rounded-full font-medium">⚡ HTTP/3</span>` : ''}
        ${data.rss_feed_url ? `<span class="bg-green-50 text-green-700 border border-green-200 text-xs px-2.5 py-1 rounded-full font-medium">📡 RSS feed</span>` : ''}
        ${data.pwa?.has_manifest ? `<span class="bg-purple-50 text-purple-700 border border-purple-200 text-xs px-2.5 py-1 rounded-full font-medium">📱 PWA${data.pwa.display === 'standalone' ? ' standalone' : ''}</span>` : ''}
        ${data.ai_training_optout ? `<span class="bg-amber-50 text-amber-700 border border-amber-200 text-xs px-2.5 py-1 rounded-full font-medium">🤖 AI training opt-out</span>` : ''}
      </div>
      <div class="border border-slate-100 rounded-lg p-3 bg-slate-50/50">
        <div class="flex items-center justify-between mb-2.5">
          <span class="text-xs font-semibold text-slate-500 uppercase tracking-wide">Security headers</span>
          <div class="flex items-center gap-2">
            <div class="w-24 bg-slate-200 rounded-full h-1.5"><div class="${secBar} h-1.5 rounded-full" style="width:${secScore}%"></div></div>
            <span class="text-sm font-semibold ${secText}">${secScore}/100</span>
          </div>
        </div>
        <div class="grid grid-cols-3 gap-x-4 gap-y-1.5">${secHeaderItems}</div>
      </div>
      ${issues ? `<ul class="space-y-1">${issues}</ul>` : ''}
    </div>`;

  } else if (d.module === 'schema_audit' && data) {
    const hasOrg = (data.coverage || {}).Organization === true || (data.coverage || {}).Entity === true;
    const missing = Object.entries(data.coverage || {}).filter(([k, v]) => !v && !(k === 'LocalBusiness' && hasOrg)).map(([k]) => k);
    const present = Object.entries(data.coverage || {}).filter(([, v]) => v).map(([k]) => k);
    const scoreNum = data.score ?? 0;
    const scoreBar = scoreNum >= 80 ? 'bg-green-400' : scoreNum >= 50 ? 'bg-yellow-400' : 'bg-orange-400';
    const scoreText = scoreNum >= 80 ? 'text-green-700' : scoreNum >= 50 ? 'text-yellow-700' : 'text-orange-600';
    const foundCount = (data.schemas_found ?? []).length;
    const ecomSection = data.is_ecommerce ? (() => {
      const ecMissing = Object.entries(data.ecommerce_coverage || {}).filter(([, v]) => !v).map(([k]) => k);
      const ecPresent = Object.entries(data.ecommerce_coverage || {}).filter(([, v]) => v).map(([k]) => k);
      return `<div class="p-3 rounded-lg bg-amber-50 border border-amber-200">
        <div class="text-sm font-semibold text-amber-700 mb-1.5">🛒 E-commerce schema audit</div>
        ${ecPresent.length ? `<div class="text-sm text-green-700">✓ Present: ${ecPresent.join(', ')}</div>` : ''}
        ${ecMissing.length ? `<div class="text-sm text-orange-600 mt-1">✗ Missing: ${ecMissing.join(', ')}</div>` : '<div class="text-sm text-green-600 mt-1">All shopping schemas present ✓</div>'}
      </div>`;
    })() : '';
    detail = `<div class="mt-3 space-y-3">
      <div class="flex items-center gap-3">
        <div class="flex-1 bg-slate-100 rounded-full h-2.5">
          <div class="${scoreBar} h-2.5 rounded-full" style="width:${scoreNum}%"></div>
        </div>
        <span class="text-base font-bold ${scoreText} shrink-0">${scoreNum}/100</span>
        <span class="text-sm text-slate-400 shrink-0">${foundCount} schema${foundCount !== 1 ? 's' : ''} found</span>
        ${data.site_type ? `<span class="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">${esc(data.site_type.replace('_', ' '))}</span>` : ''}
      </div>
      ${present.length ? `<div>
        <div class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Present</div>
        <div class="flex flex-wrap gap-1.5">${present.map(s => `<span class="bg-green-50 text-green-700 border border-green-200 text-xs px-2.5 py-1 rounded-full font-medium">✓ ${esc(s)}</span>`).join('')}</div>
      </div>` : ''}
      ${missing.length ? `<div>
        <div class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Missing opportunities</div>
        <div class="flex flex-wrap gap-1.5">${missing.map(s => `<span class="bg-orange-50 text-orange-600 border border-orange-200 text-xs px-2.5 py-1 rounded-full">✗ ${esc(s)}</span>`).join('')}</div>
      </div>` : (present.length > 0 || foundCount > 0) ? '<div class="text-sm text-green-600 font-medium">✓ All recommended schemas present</div>' : `<div class="text-sm text-orange-600 font-medium">✗ No structured data found</div><div class="text-xs text-slate-500 mt-1">Add <span class="font-mono">WebSite</span>, <span class="font-mono">Organization</span>, and page-specific schemas (Article, Product, FAQPage) in a <span class="font-mono">&lt;script type="application/ld+json"&gt;</span> block. AI engines rely on structured data to extract and cite factual information.</div>`}
      ${data.schemas_found?.length ? `<div class="text-sm text-slate-500">Schema types detected: ${data.schemas_found.map(s => `<span class="font-medium text-slate-700">${esc(s)}</span>`).join(', ')}</div>` : ''}
      ${ecomSection}
    </div>`;

  } else if (d.module === 'content_quality' && data) {
    const issues = (data.issues ?? []).slice(0, 5).map(i =>
      `<li class="text-sm ${i.startsWith('CRITICAL') ? 'text-orange-700 font-semibold' : 'text-blue-600'}">• ${tipify(esc(i))}</li>`
    ).join('');
    const scoreNum = data.score ?? 0;
    const scoreBar = scoreNum >= 80 ? 'bg-green-400' : scoreNum >= 60 ? 'bg-yellow-400' : 'bg-orange-400';
    const scoreText = scoreNum >= 80 ? 'text-green-700' : scoreNum >= 60 ? 'text-yellow-700' : 'text-orange-600';
    const wordColor = (data.word_count ?? 0) >= 300 ? 'text-green-700' : (data.word_count ?? 0) >= 150 ? 'text-yellow-700' : 'text-orange-600';
    const readability = REPORT_UI?.readabilityView?.(data.readability, reportLanguage) ?? {
      applicable: data.readability?.applicable !== false && Number.isFinite(data.readability?.flesch_ease),
      score: Number.isFinite(data.readability?.flesch_ease) ? data.readability.flesch_ease : null,
      label: data.readability?.grade_label || 'Unavailable',
    };
    const flesch = readability.score;
    const fleschColor = readability.applicable
      ? (flesch >= 60 ? 'text-green-700' : flesch >= 40 ? 'text-yellow-700' : 'text-orange-600')
      : 'text-slate-500';
    detail = `<div class="mt-3 space-y-3">
      <div class="flex items-center gap-3">
        <div class="flex-1 bg-slate-100 rounded-full h-2.5">
          <div class="${scoreBar} h-2.5 rounded-full" style="width:${scoreNum}%"></div>
        </div>
        <span class="text-base font-bold ${scoreText} shrink-0">${scoreNum}/100</span>
      </div>
      <div class="grid grid-cols-2 gap-2 text-center">
        <div class="bg-slate-50 rounded-lg p-3">
          <div class="text-sm font-bold ${wordColor}">${data.word_count ?? 0}</div>
          <div class="text-xs text-slate-400 mt-0.5">Words</div>
        </div>
        <div class="bg-slate-50 rounded-lg p-3">
          <div class="text-sm font-bold ${fleschColor}">${readability.applicable ? flesch : '—'}</div>
          <div class="text-xs text-slate-400 mt-0.5">${readability.applicable ? 'Reading ease' : esc(readability.label)}</div>
        </div>
      </div>
      <div class="flex flex-wrap gap-1.5">
        ${data.has_email ? '<span class="bg-green-50 text-green-700 border border-green-200 text-xs px-2.5 py-1 rounded-full font-medium">✉ Email present</span>' : ''}
        ${data.language ? `<span class="bg-slate-100 text-slate-600 border border-slate-200 text-xs px-2.5 py-1 rounded-full">🌐 ${esc(data.language)}</span>` : ''}
      </div>
      ${issues ? `<ul class="space-y-1">${issues}</ul>` : ''}
    </div>`;

  } else if (d.module === 'authority' && data) {
    const ageYrs = data.domain_age_years ?? 0;
    const ageBar = ageYrs >= 10 ? 'bg-green-400' : ageYrs >= 5 ? 'bg-yellow-400' : ageYrs >= 2 ? 'bg-blue-400' : 'bg-orange-400';
    const ageText = ageYrs >= 10 ? 'text-green-700' : ageYrs >= 5 ? 'text-yellow-700' : ageYrs >= 2 ? 'text-blue-600' : 'text-orange-600';
    const opr = data.page_rank;
    const oprBar = opr != null ? (opr >= 7 ? 'bg-green-400' : opr >= 4 ? 'bg-yellow-400' : 'bg-orange-400') : '';
    const oprText = opr != null ? (opr >= 7 ? 'text-green-700' : opr >= 4 ? 'text-yellow-700' : 'text-orange-600') : '';
    const backlinks = data.indexed_page_count ?? 0;
    detail = `<div class="mt-3 space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <div class="bg-slate-50 rounded-lg p-3">
          <div class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Domain age</div>
          <div class="flex items-center gap-2 mb-1.5">
            <div class="flex-1 bg-slate-200 rounded-full h-2"><div class="${ageBar} h-2 rounded-full" style="width:${Math.min(100, ageYrs * 5)}%"></div></div>
            <span class="text-sm font-bold ${ageText} shrink-0">${ageYrs} yrs</span>
          </div>
          <div class="text-xs text-slate-400">${ageYrs >= 10 ? 'Highly established' : ageYrs >= 5 ? 'Established' : ageYrs >= 2 ? 'Growing' : 'New domain'}</div>
        </div>
        ${opr != null ? `<div class="bg-slate-50 rounded-lg p-3">
          <div class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Open PageRank</div>
          <div class="flex items-center gap-2 mb-1.5">
            <div class="flex-1 bg-slate-200 rounded-full h-2"><div class="${oprBar} h-2 rounded-full" style="width:${opr * 10}%"></div></div>
            <span class="text-sm font-bold ${oprText} shrink-0">${opr.toFixed(1)}/10</span>
          </div>
          <div class="text-xs text-slate-400">${opr >= 7 ? 'High authority' : opr >= 4 ? 'Moderate authority' : 'Low authority'}</div>
        </div>` : '<div class="bg-slate-50 rounded-lg p-3 flex items-center justify-center text-sm text-slate-400">OPR not available</div>'}
      </div>
      <div class="flex flex-wrap gap-1.5">
        <span class="${data.wikipedia ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-100 text-slate-500 border-slate-200'} border text-xs px-2.5 py-1 rounded-full font-medium">${data.wikipedia ? '✓ Wikipedia' : '✗ No Wikipedia'}</span>
        <span class="${data.wikidata_id ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-100 text-slate-500 border-slate-200'} border text-xs px-2.5 py-1 rounded-full font-medium">${data.wikidata_id ? '✓ Wikidata entity' : '✗ No Wikidata'}</span>
        <span class="bg-slate-100 text-slate-600 border border-slate-200 text-xs px-2.5 py-1 rounded-full font-medium">~${backlinks} pages indexed</span>
        ${data.wikidata_id ? `<span class="text-xs text-slate-400 self-center font-mono">${esc(data.wikidata_id)}</span>` : ''}
      </div>
    </div>`;

  } else if (d.module === 'geo_predicted' && data) {
    const confPct = Math.round((data.avg_confidence ?? 0) * 100);
    const rate    = Math.round((data.citation_rate   ?? 0) * 100);
    const queries = data.queries ?? [];
    const citedCount = queries.filter(q => q.cited).length;
    const totalQ = queries.length || 1;

    // Visibility score: blend citation rate + avg confidence
    const visScore = Math.round(rate * 0.6 + confPct * 0.4);
    const visColor = visScore >= 60 ? '#16a34a' : visScore >= 35 ? '#d97706' : '#ea580c';
    const visLabel = visScore >= 60 ? 'Good' : visScore >= 35 ? 'Needs work' : 'Poor';
    const visLabelColor = visScore >= 60 ? 'text-green-700' : visScore >= 35 ? 'text-yellow-700' : 'text-orange-600';
    const visLabelBg = visScore >= 60 ? 'bg-green-50 border-green-200' : visScore >= 35 ? 'bg-amber-50 border-amber-200' : 'bg-orange-50 border-orange-200';

    // SVG arc for the big circular gauge
    const circumference = 2 * Math.PI * 38;
    const dashOffset = circumference * (1 - visScore / 100);

    // Simulated AI "search result" query cards
    const queryCards = queries.map((q, i) => {
      const qConf  = Math.round((q.confidence ?? 0) * 100);
      const isCited = q.cited;
      const borderCls = isCited ? 'border-green-200 bg-green-50/40' : 'border-slate-200 bg-white';
      const iconSvg = isCited
        ? `<svg class="w-4 h-4 text-green-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`
        : `<svg class="w-4 h-4 text-slate-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 9l-6 6M9 9l6 6"/></svg>`;
      const badge = isCited
        ? `<span class="text-[10px] font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full shrink-0">Cited · ${qConf}%</span>`
        : `<span class="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full shrink-0">Not cited · ${qConf}%</span>`;
      return `
        <div class="border ${borderCls} rounded-xl p-3">
          <div class="flex items-start gap-2 mb-1.5">
            ${iconSvg}
            <div class="flex-1 min-w-0">
              <div class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-0.5">Query ${i + 1}</div>
              <div class="text-sm font-medium text-slate-800">&ldquo;${esc(q.query)}&rdquo;</div>
            </div>
            ${badge}
          </div>
          ${q.reasoning ? (() => {
            const isHeuristic = q.reasoning.startsWith('AI unavailable');
            return isHeuristic
              ? `<div class="text-xs text-slate-400 leading-relaxed ml-6 italic" title="The prediction provider was unavailable — this result is estimated from observable page signals, not a live citation">⚠ ${esc(q.reasoning)}</div>`
              : `<div class="text-xs text-slate-500 leading-relaxed ml-6">${esc(q.reasoning)}</div>`;
          })() : ''}
        </div>`;
    }).join('');

    // Verdict copy
    const verdict = citedCount === totalQ
      ? `Predicted visibility was positive for all ${totalQ} simulated questions. This is not an observed citation result.`
      : citedCount === 0
      ? `The simulation found no positive visibility signal across ${totalQ} questions. Treat this as directional evidence only.`
      : `The simulation found a positive visibility signal for ${citedCount} of ${totalQ} questions. This is not an observed citation result.`;

    const overrideApplied = !!data.vertical_override_applied;
    const verticalBadge = data.vertical ? `
      <span class="text-[10px] font-medium px-2 py-0.5 rounded-full border
        ${overrideApplied ? 'bg-green-50 text-green-700 border-green-200' : 'bg-blue-50 text-blue-700 border-blue-200'}">
        ${esc(data.vertical)}${overrideApplied ? ' ✓' : ''}
      </span>
    ` : '';

    detail = `<div class="mt-4 space-y-4">

      <!-- Hero: circular gauge + summary stats -->
      <div class="flex items-center gap-5">
        <!-- Radial gauge -->
        <div class="relative w-24 h-24 shrink-0">
          <svg viewBox="0 0 100 100" class="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r="38" fill="none" stroke="#e2e8f0" stroke-width="10" stroke-linecap="round"/>
            <circle cx="50" cy="50" r="38" fill="none" stroke="${visColor}" stroke-width="10" stroke-linecap="round"
              stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${dashOffset.toFixed(2)}"
              class="score-ring"/>
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center">
            <span class="text-xl font-extrabold text-slate-900 leading-none">${visScore}</span>
            <span class="text-[9px] text-slate-400">/100</span>
          </div>
        </div>
        <!-- Stats -->
        <div class="flex-1 space-y-2">
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-900">AI Visibility</span>
            <span class="text-xs font-semibold px-2 py-0.5 rounded-full border ${visLabelColor} ${visLabelBg}">${visLabel}</span>
          </div>
          <p class="text-xs text-slate-500 leading-relaxed">${verdict}</p>
          <div class="flex flex-wrap gap-2 text-[10px]">
            <span class="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200">
              ${citedCount}/${totalQ} queries cited
            </span>
            <span class="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200">
              ${confPct}% avg confidence
            </span>
            ${verticalBadge}
            ${data.location && data.location !== 'your area' ? `<span class="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200">📍 ${esc(data.location)}</span>` : ''}
          </div>
        </div>
      </div>

      <!-- Query cards: only show when confidence is meaningful (≥25%) -->
      ${queryCards && confPct >= 25 ? `
        <div>
          <div class="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Simulated AI search queries</div>
          <div class="space-y-2">${queryCards}</div>
        </div>` : queryCards && confPct < 25 ? `
        <div class="text-xs text-slate-400 italic bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
          AI confidence too low (${confPct}%) for reliable query-level predictions. Build domain authority, add structured data, and deepen your content to improve this score.
        </div>` : ''}

    </div>`;

  } else if (d.module === 'on_page_seo' && data) {
    const ps = data.page_speed;
    const cwv = ps ? [
      ps.lcp_s != null && scoreVitals(ps.lcp_s, 2.5, 4, 'LCP', ps.lcp_s.toFixed(1) + 's'),
      ps.cls != null && scoreVitals(ps.cls, 0.1, 0.25, 'CLS', ps.cls.toFixed(3)),
      ps.fcp_s != null && scoreVitals(ps.fcp_s, 1.8, 3, 'FCP', ps.fcp_s.toFixed(1) + 's'),
      ps.ttfb_s != null && scoreVitals(ps.ttfb_s, 0.8, 1.8, 'TTFB', ps.ttfb_s.toFixed(2) + 's'),
    ].filter(Boolean).join('') : '';
    const issues = (data.issues ?? []).slice(0, 6).map(i =>
      `<li class="text-sm text-blue-600${i.startsWith('No H1') || i.startsWith('LCP') ? ' font-semibold text-orange-600' : ''}">• ${tipify(esc(i))}</li>`
    ).join('');
    const headings = data.headings ?? {};
    const imgs = data.images ?? {};
    const content = data.content ?? {};
    // Cross-module enrichment — all data already fetched by parallel modules
    const techCache  = window._auditModCache?.technical_seo;
    const cqCache    = window._auditModCache?.content_quality;
    const kwCache    = window._auditModCache?.keywords;
    const pageMeta   = techCache?.page_meta ?? {};
    // Decode HTML entities (e.g. &amp; → &) before rendering — the server returns raw HTML-encoded strings.
    const titleText  = pageMeta.title ? decodeHTMLEntities(pageMeta.title) : null;
    const titleLen   = titleText ? titleText.length : 0;
    const titleColor = titleLen >= 50 && titleLen <= 60 ? 'text-green-600' : 'text-amber-600';
    const metaDesc   = pageMeta.description ? decodeHTMLEntities(pageMeta.description) : null;
    const metaLen    = metaDesc ? metaDesc.length : 0;
    const metaColor  = metaLen >= 120 && metaLen <= 160 ? 'text-green-600' : 'text-amber-600';
    const canonUrl   = pageMeta.canonical_url; // null = no canonical; undefined = not yet loaded
    const rdbl       = cqCache?.readability ?? {};
    const rdblView   = REPORT_UI?.readabilityView?.(rdbl, reportLanguage) ?? {
      applicable: rdbl.applicable !== false && Number.isFinite(rdbl.flesch_ease),
      score: Number.isFinite(rdbl.flesch_ease) ? rdbl.flesch_ease : null,
    };
    const gradeLabel = rdbl.grade_label;
    const gradeLevel = rdbl.grade_level;
    const freshDate  = pageMeta.article_modified_time ?? pageMeta.article_published_time ?? null;
    const opAuthor   = pageMeta.article_author ?? null;
    const topKws     = (kwCache?.is_reliable && Array.isArray(kwCache?.keywords)) ? kwCache.keywords.slice(0, 4) : [];
    detail = `<div class="mt-3 space-y-3">
      ${ps ? `<div class="grid grid-cols-2 gap-2">
        <div class="bg-slate-50 rounded-lg p-3">
          <div class="text-xs text-slate-400 mb-1">Performance</div>
          <div class="text-base font-bold ${ps.performance >= 90 ? 'text-green-700' : ps.performance >= 50 ? 'text-yellow-700' : 'text-orange-600'}">${ps.performance}/100</div>
        </div>
        <div class="bg-slate-50 rounded-lg p-3">
          <div class="text-xs text-slate-400 mb-1">Accessibility</div>
          <div class="text-base font-bold ${ps.accessibility >= 90 ? 'text-green-700' : ps.accessibility >= 70 ? 'text-yellow-700' : 'text-orange-600'}">${ps.accessibility}/100</div>
        </div>
      </div>` : ''}
      ${titleText ? `<div class="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 flex items-center gap-2"><span class="text-slate-400 shrink-0">Title:</span><span class="text-slate-600 font-medium truncate">"${esc(titleText.slice(0, 65))}${titleText.length > 65 ? '…' : ''}"</span><span class="shrink-0 ${titleColor} font-semibold">${titleLen}ch</span></div>` : ''}
      ${metaDesc ? `<div class="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 flex items-center gap-2"><span class="text-slate-400 shrink-0">Meta:</span><span class="text-slate-500 truncate">"${esc(metaDesc.slice(0, 65))}${metaDesc.length > 65 ? '…' : ''}"</span><span class="shrink-0 ${metaColor} font-semibold">${metaLen}ch</span></div>` : ''}
      ${headings.h1_texts?.[0] ? `<div class="text-xs text-slate-500 italic bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 truncate">H1: "${esc(headings.h1_texts[0].slice(0, 90))}${headings.h1_texts[0].length > 90 ? '…' : ''}"</div>` : ''}
      <div class="flex flex-wrap gap-2 text-sm text-slate-600">
        ${headings.h1 != null ? `<span class="bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg">H1: <strong>${headings.h1}</strong></span>` : ''}
        ${headings.h2 != null ? `<span class="bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg">H2: <strong>${headings.h2}</strong></span>` : ''}
        ${headings.h3 != null ? `<span class="bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg">H3: <strong>${headings.h3}</strong></span>` : ''}
        ${(content.reading_time_min != null || content.paragraph_count != null) ? `<span class="bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg"><strong>${content.reading_time_min ?? 0}</strong>min · <strong>${content.paragraph_count ?? 0}</strong>§</span>` : ''}
        ${data.links ? `<span class="bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg"><strong>${data.links.internal}</strong> internal · <strong>${data.links.external}</strong> ext${data.links.nofollow > 0 ? ` · <strong>${data.links.nofollow}</strong> nofollow` : ''}</span>` : ''}
      </div>
      <div class="flex flex-wrap gap-1.5">
        ${canonUrl !== undefined ? (canonUrl ? `<span class="bg-green-50 text-green-700 border border-green-200 text-xs px-2.5 py-1 rounded-full font-medium" title="${esc(canonUrl)}">✓ Canonical</span>` : `<span class="bg-amber-50 text-amber-700 border border-amber-200 text-xs px-2.5 py-1 rounded-full">✗ No canonical</span>`) : ''}
        ${rdblView.applicable && gradeLabel && gradeLabel !== 'N/A' && gradeLabel !== 'Insufficient content' ? `<span class="bg-blue-50 text-blue-700 border border-blue-200 text-xs px-2.5 py-1 rounded-full" title="Flesch reading ease: ${rdblView.score}">Grade ${gradeLevel} · ${esc(gradeLabel)}</span>` : ''}
        ${opAuthor ? `<span class="bg-slate-50 text-slate-600 border border-slate-200 text-xs px-2.5 py-1 rounded-full">✍ ${esc(opAuthor.slice(0, 30))}${opAuthor.length > 30 ? '…' : ''}</span>` : ''}
        ${freshDate ? `<span class="bg-slate-50 text-slate-500 border border-slate-200 text-xs px-2.5 py-1 rounded-full">📅 ${esc(freshDate.slice(0, 10))}</span>` : ''}
      </div>
      ${topKws.length > 0 ? `<div><div class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Top keywords</div><div class="flex flex-wrap gap-1.5">${topKws.map(k => `<span class="text-xs bg-slate-100 text-slate-700 border border-slate-200 px-2.5 py-1 rounded-full">${esc(k.keyword)}${k.intent ? ` <span class="text-slate-400 font-normal">${esc(k.intent)}</span>` : ''}</span>`).join('')}</div></div>` : ''}
      ${imgs.total > 0 ? `<div class="flex flex-wrap gap-1.5">
        ${imgs.modern_format > 0 ? `<span class="bg-green-50 text-green-700 border border-green-200 text-xs px-2.5 py-1 rounded-full font-medium">✓ ${imgs.modern_format} WebP/AVIF</span>` : `<span class="bg-amber-50 text-amber-700 border border-amber-200 text-xs px-2.5 py-1 rounded-full">✗ No WebP/AVIF</span>`}
        ${imgs.lazy_loaded > 0 ? `<span class="bg-green-50 text-green-700 border border-green-200 text-xs px-2.5 py-1 rounded-full font-medium">✓ ${imgs.lazy_loaded} lazy-loaded</span>` : `<span class="bg-amber-50 text-amber-700 border border-amber-200 text-xs px-2.5 py-1 rounded-full">✗ No lazy loading</span>`}
        ${imgs.responsive > 0 ? `<span class="bg-blue-50 text-blue-700 border border-blue-200 text-xs px-2.5 py-1 rounded-full font-medium">✓ ${imgs.responsive} responsive</span>` : ''}
        ${imgs.missing_dimensions > 0 ? `<span class="bg-amber-50 text-amber-700 border border-amber-200 text-xs px-2.5 py-1 rounded-full">⚠ ${imgs.missing_dimensions} no dimensions</span>` : ''}
      </div>` : ''}
      <div class="flex flex-wrap gap-1.5">
        ${content.has_faq != null ? (content.has_faq ? '<span class="bg-green-50 text-green-700 border border-green-200 text-xs px-2.5 py-1 rounded-full font-medium">✓ FAQ section</span>' : '<span class="bg-amber-50 text-amber-700 border border-amber-200 text-xs px-2.5 py-1 rounded-full">✗ No FAQ</span>') : ''}
        ${content.has_table ? '<span class="bg-blue-50 text-blue-700 border border-blue-200 text-xs px-2.5 py-1 rounded-full font-medium">✓ Table</span>' : ''}
        ${content.has_video ? '<span class="bg-green-50 text-green-700 border border-green-200 text-xs px-2.5 py-1 rounded-full font-medium">✓ Video content</span>' : ''}
      </div>
      ${cwv ? `<div class="flex flex-wrap gap-2">${cwv}</div>` : ''}
      ${ps?.opportunities?.length ? `<div class="text-sm text-slate-500">⚡ ${ps.opportunities.slice(0, 2).map(esc).join(' · ')}</div>` : ''}
      ${issues ? `<ul class="space-y-1">${issues}</ul>` : ''}
    </div>`;

  } else if (d.module === 'off_page_seo' && data) {
    const socials = (data.social_profiles ?? []);
    const em = data.email_security ?? {};
    const brand = data.brand_presence ?? {};
    const issues = (data.issues ?? []).slice(0, 5).map(i =>
      `<li class="text-sm text-blue-600">• ${tipify(esc(i))}</li>`
    ).join('');
    const socialBadges = socials.map(s =>
      `<a href="${esc(s.url)}" target="_blank" rel="noopener" class="text-xs border border-slate-200 px-2.5 py-1 rounded-full hover:bg-slate-50 transition-colors font-medium">${esc(s.platform)} <span class="text-slate-400 font-normal">${esc(s.handle)}</span></a>`
    ).join('');
    // Pull Wayback first-seen from authority module cache (avoids duplicate CDX call)
    const authCache = window._auditModCache?.authority;
    const wbDateStr = authCache?.wayback_first_seen ?? data.wayback_first_year;
    const waybackYear = typeof wbDateStr === 'number' ? wbDateStr
      : (typeof wbDateStr === 'string' && wbDateStr.length >= 4 ? parseInt(wbDateStr.slice(0, 4)) : null);
    // Cross-module: content_quality for NAP signals
    const cqCacheOff   = window._auditModCache?.content_quality;
    detail = `<div class="mt-3 space-y-3" id="off-page-detail">
      ${brand.ddg_entity || brand.ddg_abstract ? `<div class="border border-blue-100 rounded-lg p-3 bg-blue-50/30">
        ${brand.ddg_entity ? `<div class="text-sm font-semibold text-slate-700 mb-1">${esc(brand.ddg_entity)}</div>` : ''}
        ${brand.ddg_abstract ? `<div class="text-xs text-slate-500 italic leading-relaxed">${esc(brand.ddg_abstract.slice(0, 250))}${brand.ddg_abstract.length > 250 ? '…' : ''}</div>` : ''}
      </div>` : ''}
      <div class="flex flex-wrap gap-2 text-sm text-slate-600">
        ${waybackYear ? `<span class="bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg" data-wb-year>📦 Archived since <strong>${waybackYear}</strong></span>` : ''}
        ${brand.has_knowledge_panel ? `<span class="bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-lg text-xs font-medium">✓ Knowledge panel</span>` : `<span class="bg-slate-50 text-slate-400 border border-slate-200 px-2.5 py-1 rounded-lg text-xs">✗ No knowledge panel</span>`}
        ${socials.length > 0 ? `<span class="bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg"><strong>${socials.length}</strong> social profile${socials.length !== 1 ? 's' : ''}</span>` : ''}
        <span class="${em.has_mx ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'} border px-2.5 py-1 rounded-lg text-xs font-medium">📧 Mail server ${em.has_mx ? '✓' : '✗'}</span>
        <span class="${em.has_spf ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'} border px-2.5 py-1 rounded-lg text-xs font-medium">SPF ${em.has_spf ? '✓' : '✗'}</span>
        <span class="${em.has_dkim ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'} border px-2.5 py-1 rounded-lg text-xs font-medium">DKIM ${em.has_dkim ? `✓ <span class="font-normal opacity-70">${esc(em.dkim_selector ?? '')}</span>` : '✗'}</span>
        <span class="${em.has_dmarc ? (em.dmarc_policy === 'reject' || em.dmarc_policy === 'quarantine' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200') : 'bg-red-50 text-red-700 border-red-200'} border px-2.5 py-1 rounded-lg text-xs font-medium">DMARC ${em.has_dmarc ? `✓ <span class="font-normal opacity-70">${esc(em.dmarc_policy ?? 'none')}</span>` : '✗'}</span>
      </div>
      ${socialBadges ? `<div>
        <div class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Social profiles</div>
        <div class="flex flex-wrap gap-1.5">${socialBadges}</div>
      </div>` : ''}
      ${cqCacheOff ? `<div class="border border-slate-100 rounded-lg p-3 bg-slate-50/50">
        <div class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">NAP signals</div>
        <div class="flex flex-wrap gap-1.5">
          ${cqCacheOff.has_phone ? `<span class="bg-green-50 text-green-700 border border-green-200 text-xs px-2.5 py-1 rounded-full font-medium">✓ Phone</span>` : `<span class="bg-amber-50 text-amber-700 border border-amber-200 text-xs px-2.5 py-1 rounded-full">✗ No phone</span>`}
          ${cqCacheOff.has_address ? `<span class="bg-green-50 text-green-700 border border-green-200 text-xs px-2.5 py-1 rounded-full font-medium">✓ Address</span>` : `<span class="bg-amber-50 text-amber-700 border border-amber-200 text-xs px-2.5 py-1 rounded-full">✗ No address</span>`}
        </div>
      </div>` : ''}
      ${issues ? `<ul class="space-y-1">${issues}</ul>` : ''}
    </div>`;

  } else if (d.module === 'site_intel' && data) {
    const hosting = data.hosting;
    const dns = data.dns ?? {};
    const tp = data.third_party ?? {};
    const issues = (data.issues ?? []).slice(0, 4).map(i =>
      `<li class="text-sm text-blue-600">• ${tipify(esc(i))}</li>`
    ).join('');

    const tpCats = Object.entries(tp.categories ?? {}).map(([cat, domains]) =>
      `<span class="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full border border-slate-200">${esc(cat)} (${Array.isArray(domains) ? domains.length : 0})</span>`
    ).join('');

    const hostingProvider = hosting?.org_label || hosting?.org;
    const hostingLocation = hosting ? [hosting.city, hosting.country].filter(Boolean).join(', ') : '';
    const hostingCell = hostingProvider ? `<div class="bg-slate-50 rounded-lg p-3">
          <div class="text-xs text-slate-400 mb-1">Hosting provider</div>
          <div class="text-sm font-semibold text-slate-700">${esc(hostingProvider)}</div>
        </div>` : '';
    const locationCell = hostingLocation ? `<div class="bg-slate-50 rounded-lg p-3">
          <div class="text-xs text-slate-400 mb-1">Server location</div>
          <div class="text-sm font-semibold text-slate-700">${esc(hostingLocation)}</div>
        </div>` : '';
    const hostingGrid = (hostingCell || locationCell) ? `<div class="grid grid-cols-2 gap-2">${hostingCell}${locationCell}</div>` : '';
    detail = `<div class="mt-3 space-y-3">
      ${hostingGrid}
      <div class="flex flex-wrap gap-2 text-sm text-slate-600">
        ${data.ip ? `<span class="font-mono bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg text-xs">${esc(data.ip)}</span>` : ''}
        <span class="${dns.has_ipv6 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-50 text-slate-400 border-slate-200'} border text-xs px-2.5 py-1 rounded-full">IPv6 ${dns.has_ipv6 ? '✓' : '✗'}</span>
        ${(dns.ns ?? []).length ? `<span class="text-xs text-slate-500 border border-slate-200 px-2.5 py-1 rounded-full">NS: ${(dns.ns ?? []).slice(0,2).map(esc).join(', ')}</span>` : ''}
        ${hosting?.timezone ? `<span class="text-xs text-slate-400 border border-slate-200 px-2.5 py-1 rounded-full">${esc(hosting.timezone)}</span>` : ''}
      </div>
      ${tp.total_third_party_domains > 0 && tpCats ? `<div>
        <div class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Third-party services (${tp.total_third_party_domains} domains)</div>
        <div class="flex flex-wrap gap-1.5">${tpCats}</div>
      </div>` : ''}
      ${issues ? `<ul class="space-y-1">${issues}</ul>` : ''}
    </div>`;

  } else if (d.module === 'redirect_chain' && data) {
    const hops = data.hops ?? [];
    const statusColor = s => s < 300 ? 'bg-green-100 text-green-800 border-green-200' : s < 400 ? 'bg-amber-100 text-amber-800 border-amber-200' : 'bg-orange-100 text-orange-800 border-orange-200';
    const hopChain = hops.map((h, i) => `
      ${i > 0 ? '<div class="flex justify-start pl-1 py-0.5"><div class="w-px h-4 bg-slate-200 ml-3.5"></div></div>' : ''}
      <div class="flex items-center gap-3">
        <span class="text-xs font-bold border ${statusColor(h.status)} px-2 py-1 rounded-lg shrink-0 min-w-[3rem] text-center">${h.status}</span>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-mono text-slate-700 truncate">${esc(h.url)}</div>
          <div class="text-xs text-slate-400 mt-0.5">${h.duration_ms}ms</div>
        </div>
      </div>`).join('');
    const cleanBadge = data.is_clean
      ? '<span class="bg-green-50 text-green-700 border border-green-200 text-xs px-2.5 py-1 rounded-full font-medium">✓ Clean redirect</span>'
      : `<span class="bg-amber-50 text-amber-700 border border-amber-200 text-xs px-2.5 py-1 rounded-full font-medium">⚠ ${data.chain_length} redirect hops</span>`;
    const issues = (data.issues ?? []).map(i => `<li class="text-sm text-blue-600">• ${tipify(esc(i))}</li>`).join('');
    detail = `<div class="mt-3 space-y-3">
      <div class="flex items-center gap-2 flex-wrap">
        ${cleanBadge}
        ${data.has_https_redirect ? '<span class="bg-blue-50 text-blue-700 border border-blue-200 text-xs px-2.5 py-1 rounded-full">HTTPS redirect ✓</span>' : ''}
        ${data.has_www_change ? '<span class="bg-slate-100 text-slate-600 border border-slate-200 text-xs px-2.5 py-1 rounded-full">www normalisation</span>' : ''}
      </div>
      ${hops.length ? `<div class="space-y-0">${hopChain}</div>` : ''}
      ${issues ? `<ul class="space-y-1">${issues}</ul>` : ''}
    </div>`;

  } else if (d.module === 'accessibility' && data) {
    const checks = data.wcag_checks ?? [];
    const passed = checks.filter(c => c.passed).length;
    const total = checks.length;
    const wcagPct = total ? Math.round(passed / total * 100) : 0;
    const wcagBar = wcagPct >= 80 ? 'bg-green-400' : wcagPct >= 60 ? 'bg-yellow-400' : 'bg-orange-400';
    const wcagText = wcagPct >= 80 ? 'text-green-700' : wcagPct >= 60 ? 'text-yellow-700' : 'text-orange-600';
    const dcwv = data.desktop_cwv;
    const dCwvChips = dcwv ? [
      dcwv.lcp_s != null && scoreVitals(dcwv.lcp_s, 2.5, 4, 'LCP desktop', dcwv.lcp_s.toFixed(1) + 's'),
      dcwv.cls != null && scoreVitals(dcwv.cls, 0.1, 0.25, 'CLS desktop', dcwv.cls.toFixed(3)),
      dcwv.fcp_s != null && scoreVitals(dcwv.fcp_s, 1.8, 3, 'FCP desktop', dcwv.fcp_s.toFixed(1) + 's'),
    ].filter(Boolean).join('') : '';
    const checkList = checks.slice(0, 8).map(c =>
      `<div class="flex items-start gap-2 text-sm py-1 border-t border-slate-100 first:border-t-0">
        <span class="${c.passed ? 'text-green-600' : 'text-orange-500'} shrink-0 font-semibold mt-0.5">${c.passed ? '✓' : '✗'}</span>
        <span class="${c.passed ? 'text-slate-500' : 'text-slate-700'} flex-1">${esc(c.rule)}${c.detail && c.detail !== '(no detail)' ? ` — <span class="text-blue-600">${esc(c.detail)}</span>` : ''}</span>
        <span class="text-xs text-slate-300 shrink-0">${c.level}</span>
      </div>`
    ).join('');
    const issues = (data.issues ?? []).slice(0, 4).map(i => `<li class="text-sm text-blue-600">• ${tipify(esc(i))}</li>`).join('');
    detail = `<div class="mt-3 space-y-3">
      <div class="flex items-center gap-3">
        <div class="flex-1 bg-slate-100 rounded-full h-2.5">
          <div class="${wcagBar} h-2.5 rounded-full" style="width:${wcagPct}%"></div>
        </div>
        <span class="text-base font-bold ${wcagText} shrink-0">${passed}/${total}</span>
        <span class="text-sm text-slate-400 shrink-0">WCAG checks</span>
      </div>
      ${dcwv ? `<div class="grid grid-cols-2 gap-2">
        <div class="bg-slate-50 rounded-lg p-3">
          <div class="text-xs text-slate-400 mb-1">Desktop performance</div>
          <div class="text-base font-bold ${dcwv.performance >= 90 ? 'text-green-700' : dcwv.performance >= 50 ? 'text-yellow-700' : 'text-orange-600'}">${dcwv.performance}/100</div>
        </div>
        <div class="bg-slate-50 rounded-lg p-3">
          <div class="text-xs text-slate-400 mb-1">Accessibility score</div>
          <div class="text-base font-bold ${dcwv.accessibility_score >= 90 ? 'text-green-700' : dcwv.accessibility_score >= 70 ? 'text-yellow-700' : 'text-orange-600'}">${dcwv.accessibility_score}/100</div>
        </div>
      </div>` : ''}
      <div class="flex flex-wrap gap-1.5">
        ${data.has_skip_link ? '<span class="bg-green-50 text-green-700 border border-green-200 text-xs px-2.5 py-1 rounded-full font-medium">✓ Skip link</span>' : '<span class="bg-slate-100 text-slate-500 border border-slate-200 text-xs px-2.5 py-1 rounded-full">✗ No skip link</span>'}
        ${data.has_aria_landmarks ? '<span class="bg-green-50 text-green-700 border border-green-200 text-xs px-2.5 py-1 rounded-full font-medium">✓ ARIA landmarks</span>' : '<span class="bg-slate-100 text-slate-500 border border-slate-200 text-xs px-2.5 py-1 rounded-full">✗ No ARIA landmarks</span>'}
      </div>
      ${dCwvChips ? `<div class="flex flex-wrap gap-2">${dCwvChips}</div>` : ''}
      <div class="border border-slate-100 rounded-lg p-3 bg-slate-50/50">${checkList}</div>
      ${issues ? `<ul class="space-y-1">${issues}</ul>` : ''}
    </div>`;

  } else if (d.module === 'security_audit' && data) {
    const gradeColor = (g) => {
      if (!g || g === 'N/A') return 'text-slate-400 bg-slate-100 border-slate-200';
      if (g.startsWith('A')) return 'text-green-700 bg-green-50 border-green-200';
      if (g.startsWith('B')) return 'text-blue-700 bg-blue-50 border-blue-200';
      if (g.startsWith('C')) return 'text-yellow-700 bg-yellow-50 border-yellow-200';
      return 'text-slate-600 bg-slate-100 border-slate-200';
    };
    const barColor = data.score >= 80 ? 'bg-green-400' : data.score >= 60 ? 'bg-blue-400' : data.score >= 40 ? 'bg-yellow-400' : 'bg-slate-300';

    const allTests   = data.tests ?? [];
    const failed     = allTests.filter(t => !t.passed);
    const passed     = allTests.filter(t =>  t.passed);

    const severityMeta = {
      critical: { label: 'Critical',  dot: 'bg-orange-500',    text: 'text-orange-700',    badge: 'bg-orange-100 text-orange-700',    border: 'border-orange-200 bg-orange-50' },
      high:     { label: 'High',      dot: 'bg-orange-500', text: 'text-orange-700', badge: 'bg-orange-100 text-orange-700', border: 'border-orange-200 bg-orange-50' },
      medium:   { label: 'Medium',    dot: 'bg-yellow-500', text: 'text-yellow-700', badge: 'bg-yellow-100 text-yellow-700', border: 'border-yellow-200 bg-yellow-50' },
      low:      { label: 'Low',       dot: 'bg-slate-400',  text: 'text-slate-600',  badge: 'bg-slate-100 text-slate-600',  border: 'border-slate-200 bg-slate-50' },
    };

    // Count by severity for the summary row
    const sevCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    failed.forEach(t => { if (t.severity && t.severity !== 'pass') sevCounts[t.severity]++; });

    const sevSummary = Object.entries(sevCounts)
      .filter(([, n]) => n > 0)
      .map(([s, n]) => {
        const m = severityMeta[s];
        return `<span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${m.badge}">
          <span class="w-1.5 h-1.5 rounded-full ${m.dot}"></span>${n} ${m.label}
        </span>`;
      }).join('');

    // Render each failed test as an expanded card
    const failedCards = failed.map(t => {
      const m = severityMeta[t.severity] ?? severityMeta.low;
      const pts = t.score_modifier < 0 ? `<span class="ml-auto shrink-0 text-[11px] font-semibold ${m.text}">${t.score_modifier} pts</span>` : '';
      const desc = t.description ? `<p class="text-xs text-slate-600 mt-1 leading-relaxed">${esc(t.description)}</p>` : '';
      const rec  = t.recommendation ? `<div class="mt-2 pt-2 border-t border-slate-200">
          <span class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">How to fix</span>
          <p class="text-xs text-slate-700 mt-0.5 leading-relaxed">${esc(t.recommendation)}</p>
        </div>` : '';
      return `<div class="rounded-lg border ${m.border} p-3">
        <div class="flex items-start gap-2">
          <span class="w-2 h-2 rounded-full ${m.dot} mt-1 shrink-0"></span>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-semibold text-slate-800">${esc(t.name)}</span>
              <span class="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${m.badge}">${m.label}</span>
              ${pts}
            </div>
            ${desc}
            ${rec}
          </div>
        </div>
      </div>`;
    }).join('');

    // Render passing tests as verbose cards showing what was measured + why it matters
    const passedCards = passed.map(t => {
      const det = t.detail
        ? `<div class="text-[11px] font-mono text-green-800 bg-green-50 border border-green-100 rounded px-2 py-1 mt-1 break-all leading-relaxed">${esc(t.detail)}</div>`
        : '';
      const desc = t.description
        ? `<p class="text-[11px] text-slate-500 mt-1 leading-relaxed">${esc(t.description)}</p>`
        : '';
      return `<div class="flex items-start gap-2 border border-green-100 bg-green-50/40 rounded-lg p-2.5">
        <span class="text-green-500 font-bold text-sm mt-0.5 shrink-0">✓</span>
        <div class="flex-1 min-w-0">
          <span class="text-xs font-semibold text-slate-700">${esc(t.name)}</span>
          ${det}
          ${desc}
        </div>
      </div>`;
    }).join('');

    // Gaps that this scan cannot detect — always relevant, especially for perfect scores
    const scanGaps = failed.length === 0 ? `<div class="mt-1 border border-amber-100 bg-amber-50/60 rounded-lg p-3">
      <div class="text-[11px] font-semibold text-amber-800 mb-1.5">Potential gaps not covered by this header scan</div>
      <ul class="space-y-1 text-[11px] text-amber-700 leading-relaxed list-disc list-inside">
        <li>Login-flow cookies — session &amp; auth cookies set post-login are not visible on the homepage</li>
        <li>API endpoints — only the root page was analysed; API routes may have different headers</li>
        <li>Third-party JS supply chain — even with SRI, first-party code can still carry vulnerabilities</li>
        <li>Browser fingerprinting &amp; timing side-channels (e.g. Spectre) are not detectable via HTTP headers</li>
        <li>OAuth / popup flows — Cross-Origin-Opener-Policy can silently break these; test login popups manually</li>
      </ul>
    </div>` : '';

    // Auto-open the passing section when all tests pass; collapsed when some failed
    const autoOpen = failed.length === 0 ? 'open' : '';

    detail = `<div class="mt-3 space-y-3">
      <!-- Grade + score bar -->
      <div class="flex items-center gap-3 flex-wrap">
        <span class="text-xl font-bold border-2 px-3 py-1 rounded-xl ${gradeColor(data.grade)}">${esc(data.grade)}</span>
        <div class="flex-1 min-w-32">
          <div class="flex items-center gap-2 mb-1">
            <div class="flex-1 bg-slate-100 rounded-full h-2.5">
              <div class="${barColor} h-2.5 rounded-full transition-all" style="width:${data.score}%"></div>
            </div>
            <span class="text-sm font-bold text-slate-700 shrink-0">${data.score}/100</span>
          </div>
          <div class="text-xs text-slate-400">${data.tests_passed} of ${data.tests_quantity} checks passed · Mozilla Observatory</div>
        </div>
      </div>
      ${data.score >= 100 && failed.length > 0 ? `<div class="text-[11px] text-slate-400 -mt-1 leading-relaxed">Score is capped at 100 — Observatory's bonus/penalty system can offset deductions; the flagged issues below still represent real risks.</div>` : ''}

      <!-- Severity summary pills or all-pass banner -->
      ${sevSummary
        ? `<div class="flex flex-wrap gap-1.5">${sevSummary}</div>`
        : `<div class="flex items-center gap-2 text-xs text-green-700 font-medium bg-green-50 border border-green-100 rounded-lg px-3 py-2">
            <span class="text-base">🏆</span>All ${passed.length} security controls passed
          </div>`}

      <!-- HSTS preload + security.txt status pills -->
      ${(() => {
        const preload = data.hsts_preload_status;
        const secTxt  = data.security_txt;
        const preloadChip = preload === 'preloaded'
          ? `<span class="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-green-50 text-green-700 border border-green-200">🔒 HSTS preloaded</span>`
          : preload === 'pending'
          ? `<span class="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">⏳ HSTS preload pending</span>`
          : `<span class="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 border border-slate-200">✗ Not HSTS preloaded</span>`;
        const secTxtChip = secTxt?.present && !secTxt?.is_expired
          ? `<span class="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-green-50 text-green-700 border border-green-200">✓ security.txt${secTxt.contact ? ` · ${esc(secTxt.contact.slice(0,40))}` : ''}</span>`
          : secTxt?.present && secTxt?.is_expired
          ? `<span class="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">⚠ security.txt expired</span>`
          : `<span class="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 border border-slate-200">✗ No security.txt</span>`;
        return `<div class="flex flex-wrap gap-1.5">${preloadChip}${secTxtChip}</div>`;
      })()}

      <!-- Failed tests with detail -->
      ${failedCards ? `<div class="space-y-2">${failedCards}</div>` : ''}

      <!-- Passing tests — verbose cards, auto-open when all pass -->
      ${passed.length > 0 ? `<details ${autoOpen} class="group">
        <summary class="cursor-pointer text-xs font-semibold text-slate-500 hover:text-slate-700 list-none flex items-center gap-1.5 select-none py-0.5">
          <span class="group-open:hidden">▸</span><span class="hidden group-open:inline">▾</span>
          ${passed.length} passing control${passed.length !== 1 ? 's' : ''} — what was measured &amp; why it matters
        </summary>
        <div class="mt-2 space-y-2">
          ${passedCards}
        </div>
      </details>` : ''}

      ${scanGaps}
    </div>`;

  } else if (d.module === 'ssl_cert' && data) {
    const daysLeft = data.days_remaining ?? -1;
    const isValid = data.is_valid;
    const daysKnown = daysLeft >= 0; // -1 = cert valid but expiry details unavailable
    const daysBarPct = daysKnown ? Math.min(100, Math.round(daysLeft / 365 * 100)) : 0;
    const daysBar = !isValid ? 'bg-orange-400' : daysLeft <= 30 ? 'bg-orange-400' : daysLeft <= 90 ? 'bg-yellow-400' : 'bg-green-400';
    const daysText = !isValid ? 'text-orange-600' : daysLeft <= 30 && daysKnown ? 'text-orange-600 font-bold' : daysLeft <= 90 && daysKnown ? 'text-yellow-700' : 'text-green-700';
    const statusMsg = !isValid ? (data.issues?.[0] || 'Certificate could not be verified')
      : daysLeft <= 30 && daysKnown ? 'Expires very soon — renew immediately'
      : daysLeft <= 90 && daysKnown ? 'Expiring within 90 days — schedule renewal'
      : 'Certificate valid and healthy';
    // Build grid cells — only include cells with real data (no "Unknown" / placeholder strings)
    const _SSL_PLACEHOLDERS = new Set(['Unknown', 'Unverified', 'Verified (details unavailable)', '']);
    const realIssuer = data.issuer && !_SSL_PLACEHOLDERS.has(data.issuer) ? data.issuer : null;
    const issuerCell = realIssuer ? `<div class="bg-slate-50 rounded-lg p-3">
          <div class="text-xs text-slate-400 mb-1">Issued by</div>
          <div class="text-sm font-semibold text-slate-700">${esc(realIssuer)}</div>
        </div>` : '';
    const validFromCell = data.valid_from ? `<div class="bg-slate-50 rounded-lg p-3">
          <div class="text-xs text-slate-400 mb-1">Valid from</div>
          <div class="text-sm font-medium text-slate-700">${esc(data.valid_from)}</div>
        </div>` : '';
    const validToCell = data.valid_to ? `<div class="bg-slate-50 rounded-lg p-3">
          <div class="text-xs text-slate-400 mb-1">Expires</div>
          <div class="text-sm font-medium ${daysText}">${esc(data.valid_to)}</div>
        </div>` : '';
    const gridCells = issuerCell + `<div class="bg-slate-50 rounded-lg p-3">
          <div class="text-xs text-slate-400 mb-1">Status</div>
          <div class="text-sm font-semibold ${isValid ? 'text-green-700' : 'text-orange-600'}">${isValid ? '✓ Valid' : '✗ Invalid'}</div>
        </div>` + validFromCell + validToCell;
    // If cert is valid but we have zero extra detail (no issuer, no dates), show a concise summary only
    const hasDetail = realIssuer || data.valid_from || data.valid_to;
    detail = `<div class="mt-3 space-y-3">
      ${isValid && daysKnown ? `<div class="flex items-center gap-3">
        <div class="flex-1 bg-slate-100 rounded-full h-2.5">
          <div class="${daysBar} h-2.5 rounded-full" style="width:${daysBarPct}%"></div>
        </div>
        <span class="text-base font-bold ${daysText} shrink-0">${daysLeft}d</span>
        <span class="text-sm text-slate-400 shrink-0">remaining</span>
      </div>` : ''}
      ${hasDetail ? `<div class="grid grid-cols-2 gap-2">${gridCells}</div>` : ''}
      <div class="text-sm ${isValid ? 'text-green-700' : 'text-orange-600'}">${esc(statusMsg)}</div>
      ${!hasDetail && isValid ? '<div class="text-xs text-slate-400">Full certificate details not retrievable from crt.sh — verify expiry and issuer manually at <a href="https://www.ssllabs.com/ssltest/" target="_blank" rel="noopener" class="underline hover:text-blue-500">SSL Labs</a>.</div>' : ''}
    </div>`;

  } else if (d.module === 'domain_intel' && data) {
    const emailPct = data.email_security_score ?? 0;
    const emailBar = emailPct >= 90 ? 'bg-green-400' : emailPct >= 55 ? 'bg-yellow-400' : 'bg-orange-400';
    const emailText = emailPct >= 90 ? 'text-green-700' : emailPct >= 55 ? 'text-yellow-700' : 'text-orange-600';
    const expiryColor = data.days_until_expiry != null && data.days_until_expiry < 60 ? 'text-orange-600 font-semibold' : 'text-slate-700';
    const dkimList = (data.dkim_selectors_found ?? []).join(', ') || '—';
    const hasDkim = (data.dkim_selectors_found ?? []).length > 0;
    const statusBadges = (data.domain_status ?? []).slice(0, 3).map(s =>
      `<span class="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full border border-slate-200">${esc(s)}</span>`
    ).join('');
    const issues = (data.issues ?? []).slice(0, 4).map(i =>
      `<li class="text-sm text-blue-600">• ${tipify(esc(i))}</li>`
    ).join('');
    detail = `<div class="mt-3 space-y-3">
      <div class="grid grid-cols-2 gap-2">
        ${data.registrar ? `<div class="bg-slate-50 rounded-lg p-3">
          <div class="text-xs text-slate-400 mb-1">Registrar</div>
          <div class="text-sm font-semibold text-slate-700">${esc(data.registrar)}</div>
        </div>` : ''}
        ${data.expiry_date ? `<div class="bg-slate-50 rounded-lg p-3">
          <div class="text-xs text-slate-400 mb-1">Domain expiry</div>
          <div class="text-sm font-semibold ${expiryColor}">${esc(data.expiry_date.slice(0,10))}</div>
          <div class="text-xs text-slate-400 mt-0.5">${data.days_until_expiry}d remaining</div>
        </div>` : ''}
      </div>
      <div class="flex flex-wrap gap-1.5">
        <span class="${data.dnssec ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-100 text-slate-500 border-slate-200'} border text-xs px-2.5 py-1 rounded-full font-medium">DNSSEC ${data.dnssec ? '✓' : '✗'}</span>
        ${data.caa?.present
          ? `<span class="bg-green-50 text-green-700 border border-green-200 text-xs px-2.5 py-1 rounded-full font-medium">✓ CAA: ${esc((data.caa.issue ?? []).slice(0,2).join(', ') || 'restricted')}</span>`
          : `<span class="bg-slate-100 text-slate-500 border border-slate-200 text-xs px-2.5 py-1 rounded-full font-medium">✗ No CAA records</span>`}
        ${statusBadges}
      </div>
      <div class="border border-slate-100 rounded-lg p-3 bg-slate-50/50">
        <div class="flex items-center justify-between mb-2.5">
          <span class="text-xs font-semibold text-slate-500 uppercase tracking-wide">Email security</span>
          <div class="flex items-center gap-2">
            <div class="w-24 bg-slate-200 rounded-full h-1.5"><div class="${emailBar} h-1.5 rounded-full" style="width:${emailPct}%"></div></div>
            <span class="text-sm font-semibold ${emailText}">${emailPct}/100</span>
          </div>
        </div>
        <div class="grid grid-cols-3 gap-2 text-center">
          <div class="bg-white rounded-lg p-2 border border-slate-100">
            <div class="text-sm font-bold ${data.spf ? 'text-green-600' : 'text-orange-500'}">${data.spf ? '✓' : '✗'}</div>
            <div class="text-xs text-slate-400 mt-0.5">SPF</div>
          </div>
          <div class="bg-white rounded-lg p-2 border border-slate-100">${(() => {
            const dmarcPolicy = data.dmarc?.match(/p=([^;\s]+)/i)?.[1]?.toLowerCase();
            const dmarcColor = !data.dmarc ? 'text-orange-500' : dmarcPolicy === 'none' ? 'text-amber-600' : 'text-green-600';
            const dmarcLabel = !data.dmarc ? '✗' : dmarcPolicy === 'none' ? 'none' : '✓';
            return `<div class="text-sm font-bold ${dmarcColor}">${dmarcLabel}</div>`;
          })()}
            <div class="text-xs text-slate-400 mt-0.5">DMARC</div>
          </div>
          <div class="bg-white rounded-lg p-2 border border-slate-100">
            <div class="text-sm font-bold ${hasDkim ? 'text-green-600' : 'text-orange-500'}">${hasDkim ? '✓' : '✗'}</div>
            <div class="text-xs text-slate-400 mt-0.5">DKIM</div>
          </div>
        </div>
        ${hasDkim ? `<div class="text-xs font-mono text-slate-400 mt-2">Selectors: ${esc(dkimList)}</div>` : ''}
        ${data.spf ? `<div class="text-xs font-mono text-slate-400 mt-1 truncate">SPF: ${esc(data.spf)}</div>` : ''}
      </div>
      ${issues ? `<ul class="space-y-1">${issues}</ul>` : ''}
    </div>`;

  } else if (d.module === 'crux' && data) {
    if (!data.has_data) {
      // No real Chrome user data (rate limit hit, or domain has no CrUX record).
      // Remove the card completely — showing a "temporarily unavailable" message
      // adds noise without any actionable information.
      if (el.parentNode) el.remove();
      return;
    } else {
      const perfScore = data.performance_score ?? 0;
      const perfColor = perfScore >= 80 ? 'bg-green-400' : perfScore >= 50 ? 'bg-yellow-400' : 'bg-orange-400';
      const perfText  = perfScore >= 80 ? 'text-green-700' : perfScore >= 50 ? 'text-yellow-700' : 'text-orange-700';

      const METRICS = [
        { key: 'lcp',  abbr: 'LCP',  name: 'Largest Contentful Paint', desc: 'How fast the main content loads',          good: 2500, poor: 4000, fmt: v => (v/1000).toFixed(2)+'s', target: '≤2.5s good · ≤4s needs improvement' },
        { key: 'cls',  abbr: 'CLS',  name: 'Cumulative Layout Shift',  desc: 'Visual stability — how much the page jumps', good: 0.1,  poor: 0.25, fmt: v => Number(v).toFixed(3),    target: '≤0.1 good · ≤0.25 needs improvement' },
        { key: 'inp',  abbr: 'INP',  name: 'Interaction to Next Paint', desc: 'Responsiveness to clicks and taps',         good: 200,  poor: 500,  fmt: v => v+'ms',                  target: '≤200ms good · ≤500ms needs improvement' },
        { key: 'fcp',  abbr: 'FCP',  name: 'First Contentful Paint',   desc: 'When text or images first appear',           good: 1800, poor: 3000, fmt: v => (v/1000).toFixed(2)+'s', target: '≤1.8s good · ≤3s needs improvement' },
        { key: 'ttfb', abbr: 'TTFB', name: 'Time to First Byte',       desc: 'Server response time',                       good: 800,  poor: 1800, fmt: v => v+'ms',                  target: '≤800ms good · ≤1.8s needs improvement' },
      ];

      const metricRows = METRICS.map(m => {
        const metric = data[m.key];
        if (!metric) return '';
        const val = Number(metric.p75);
        const isGood  = val <= m.good;
        const isPoor  = val > m.poor;
        const statusLabel = isGood ? 'Good' : isPoor ? 'Poor' : 'Needs Improvement';
        const statusColor = isGood ? 'text-green-700 bg-green-50 border-green-200'
                          : isPoor ? 'text-orange-700 bg-orange-50 border-orange-200'
                          :          'text-yellow-700 bg-yellow-50 border-yellow-200';
        const valColor = isGood ? 'text-green-700' : isPoor ? 'text-orange-600' : 'text-yellow-700';
        const good = metric.good_rate ?? 0;
        const ni   = metric.needs_improvement_rate ?? 0;
        const poor = metric.poor_rate ?? 0;
        return `
          <div class="py-2 border-t border-slate-100 first:border-t-0">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <span class="font-semibold text-sm text-slate-800">${m.abbr}</span>
                <span class="text-xs text-slate-500 ml-1.5">${m.name}</span>
                <div class="text-[11px] text-slate-400 mt-0.5">${m.desc}</div>
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <span class="text-sm font-bold ${valColor}">${m.fmt(val)}</span>
                <span class="text-[10px] font-medium border rounded px-1.5 py-0.5 ${statusColor}">${statusLabel}</span>
              </div>
            </div>
            <div class="mt-1.5 flex rounded-full overflow-hidden h-1.5 bg-slate-100">
              <div class="bg-green-400 h-full" style="width:${good}%"></div>
              <div class="bg-yellow-400 h-full" style="width:${ni}%"></div>
              <div class="bg-orange-400 h-full" style="width:${poor}%"></div>
            </div>
            <div class="flex items-center gap-3 mt-1.5 text-xs text-slate-400 flex-wrap">
              <span><span class="inline-block w-2 h-2 rounded-full bg-green-400 mr-1"></span>${good}% good</span>
              <span><span class="inline-block w-2 h-2 rounded-full bg-yellow-400 mr-1"></span>${ni}% needs improvement</span>
              <span><span class="inline-block w-2 h-2 rounded-full bg-orange-400 mr-1"></span>${poor}% poor</span>
              <span class="ml-auto text-slate-300">Target: ${m.target}</span>
            </div>
          </div>`;
      }).join('');

      detail = `<div class="mt-2 space-y-0">
        <div class="flex items-center gap-2 mb-2">
          <div class="flex-1 bg-slate-100 rounded-full h-2">
            <div class="${perfColor} h-2 rounded-full transition-all" style="width:${perfScore}%"></div>
          </div>
          <span class="text-sm font-bold ${perfText} w-16 text-right">${perfScore}/100</span>
        </div>
        <div class="text-xs text-slate-400 mb-3">Real Chrome user data · Mobile · 75th percentile · 28-day rolling window</div>
        ${metricRows}
      </div>`;
    }

  } else if (d.module === 'lighthouse' && REPORT_UI) {
    detail = REPORT_UI.renderLighthouse({
      data,
      error: d.error,
      strategies: d.strategies,
      status: d.status,
      domain: currentDomain,
      lang: reportLanguage,
    });

  } else if (d.module === 'robots_sitemap' && data) {
    const rt = data.robots_txt ?? {};
    const sm = data.sitemap ?? {};
    const issues = (data.issues ?? []).slice(0, 5).map(i => `<li class="text-sm text-blue-600">• ${esc(i)}</li>`).join('');
    const robDot = rt.exists ? (rt.blocks_all || rt.blocks_googlebot ? '🔴' : '🟢') : '🟡';
    const smDot  = sm.exists ? '🟢' : '🔴';
    detail = `<div class="mt-3 space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <div class="bg-slate-50 rounded-lg p-3">
          <div class="text-xs font-semibold text-slate-500 mb-2">robots.txt ${robDot}</div>
          ${rt.exists
            ? `<div class="space-y-1">
               <div class="flex items-center gap-1.5 text-xs"><span class="${rt.blocks_all ? 'text-orange-600' : 'text-green-600'}">${rt.blocks_all ? '✗' : '✓'}</span> Block all crawlers</div>
               <div class="flex items-center gap-1.5 text-xs"><span class="${rt.blocks_googlebot ? 'text-orange-600' : 'text-green-600'}">${rt.blocks_googlebot ? '✗' : '✓'}</span> Block Googlebot</div>
               <div class="flex items-center gap-1.5 text-xs"><span class="${rt.sitemap_refs?.length ? 'text-green-600' : 'text-amber-600'}">${rt.sitemap_refs?.length ? '✓' : '!'}</span> Sitemap directive</div>
               ${rt.crawl_delay ? `<div class="text-xs text-amber-600 mt-1">Crawl-Delay: ${rt.crawl_delay}s</div>` : ''}
               </div>`
            : '<div class="text-xs text-orange-600">Not found</div>'}
        </div>
        <div class="bg-slate-50 rounded-lg p-3">
          <div class="text-xs font-semibold text-slate-500 mb-2">Sitemap ${smDot}</div>
          ${sm.exists
            ? `<div class="space-y-1">
               <div class="text-xs text-slate-700 truncate font-mono">${esc(sm.url?.replace(/^https?:\/\/[^/]+/, '') ?? '')}</div>
               ${sm.page_count ? `<div class="text-xs text-slate-500">${sm.page_count} URL${sm.page_count !== 1 ? 's' : ''} found</div>` : ''}
               <div class="flex items-center gap-1.5 text-xs"><span class="${sm.has_lastmod ? 'text-green-600' : 'text-amber-600'}">${sm.has_lastmod ? '✓' : '!'}</span> lastmod dates</div>
               <div class="flex items-center gap-1.5 text-xs"><span class="${sm.is_index ? 'text-blue-600' : 'text-slate-400'}">${sm.is_index ? '≡' : '·'}</span> ${sm.is_index ? 'Sitemap index' : 'Single sitemap'}</div>
               </div>`
            : '<div class="text-xs text-orange-600">Not found</div>'}
        </div>
      </div>
      ${issues ? `<ul class="space-y-1 pt-1">${issues}</ul>` : '<div class="text-xs text-green-600">✓ No crawlability issues detected</div>'}
    </div>`;

  } else if (d.module === 'broken_links' && data) {
    const broken  = data.broken ?? [];
    const unverifiable = data.unverifiable ?? 0;
    const issues  = (data.issues ?? []).slice(0, 5).map(i => `<li class="text-sm text-blue-600">• ${esc(i)}</li>`).join('');
    const brokenRows = broken.slice(0, 8).map(b => {
      const statusColor = b.status >= 500 ? 'text-red-600' : 'text-orange-600';
      const typeChip = b.type === 'internal'
        ? '<span class="text-[9px] bg-red-50 text-red-600 border border-red-200 px-1.5 py-0.5 rounded-full font-semibold">internal</span>'
        : '<span class="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">external</span>';
      return `<div class="flex items-start gap-2 py-1.5 border-b border-slate-100 last:border-0">
        <span class="${statusColor} font-mono text-xs font-semibold w-10 shrink-0">${b.status}</span>
        ${typeChip}
        <div class="min-w-0">
          <div class="text-xs text-slate-700 truncate">${esc(b.text || '(no text)')}</div>
          <div class="text-[10px] text-slate-400 font-mono truncate mt-0.5">${esc(b.url)}</div>
        </div>
      </div>`;
    }).join('');
    // Show 4-column grid when there are unverifiable links worth surfacing
    const showUnverifiable = unverifiable > 0 && broken.length < unverifiable;
    const gridCols = showUnverifiable ? 'grid-cols-4' : 'grid-cols-3';
    detail = `<div class="mt-3 space-y-3">
      <div class="grid ${gridCols} gap-2 text-center">
        <div class="bg-slate-50 rounded-lg p-3">
          <div class="text-lg font-bold text-slate-700">${data.total_links_checked ?? 0}</div>
          <div class="text-xs text-slate-400 mt-0.5">Checked</div>
        </div>
        <div class="bg-slate-50 rounded-lg p-3">
          <div class="text-lg font-bold ${broken.length > 0 ? 'text-red-600' : 'text-green-700'}">${broken.length}</div>
          <div class="text-xs text-slate-400 mt-0.5">Broken</div>
        </div>
        <div class="bg-slate-50 rounded-lg p-3">
          <div class="text-lg font-bold ${(data.redirects ?? 0) > 3 ? 'text-amber-600' : 'text-slate-700'}">${data.redirects ?? 0}</div>
          <div class="text-xs text-slate-400 mt-0.5">Redirects</div>
        </div>
        ${showUnverifiable ? `<div class="bg-slate-50 rounded-lg p-3">
          <div class="text-lg font-bold text-slate-400">${unverifiable}</div>
          <div class="text-xs text-slate-400 mt-0.5">Blocked</div>
        </div>` : ''}
      </div>
      ${showUnverifiable && broken.length === 0 ? `<div class="text-xs text-slate-500 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">⚠ ${unverifiable} link${unverifiable > 1 ? 's' : ''} could not be verified — the site blocks automated HTTP checks (bot protection). Check manually.</div>` : ''}
      ${brokenRows ? `<div class="bg-slate-50 rounded-lg p-3"><div class="text-xs font-semibold text-slate-500 mb-2">Broken links</div>${brokenRows}</div>` : ''}
      ${issues && broken.length > 0 ? `<ul class="space-y-1">${issues}</ul>` : broken.length === 0 && !showUnverifiable ? '<div class="text-xs text-green-600">✓ No broken links detected</div>' : ''}
    </div>`;

  } else if (d.module === 'mobile_audit' && data) {
    const issues = (data.issues ?? []).slice(0, 5).map(i => `<li class="text-sm text-blue-600">• ${esc(i)}</li>`).join('');
    const checks = [
      { label: 'Viewport meta',        ok: data.has_viewport_meta,       note: data.viewport_content ? data.viewport_content.slice(0, 40) : 'Missing' },
      { label: 'Responsive images',    ok: data.has_responsive_images,   note: data.has_responsive_images ? 'srcset detected' : 'No srcset found' },
      { label: 'Touch icons',          ok: data.has_touch_icons,         note: data.has_touch_icons ? 'Found' : 'Not found' },
      { label: 'Font sizes',           ok: data.font_size_ok,            note: data.font_size_ok ? 'OK' : 'Very small text detected' },
      { label: 'Tap targets',          ok: data.tap_target_issues === 0, note: data.tap_target_issues > 0 ? `${data.tap_target_issues} small target(s)` : 'OK' },
    ];
    const checkRows = checks.map(c => `<div class="flex items-center gap-2 py-1.5 border-b border-slate-100 last:border-0">
      <span class="${c.ok ? 'text-green-500' : 'text-amber-500'} text-base">${c.ok ? '✓' : '⚠'}</span>
      <span class="text-xs text-slate-600 w-36 shrink-0">${c.label}</span>
      <span class="text-xs text-slate-400 truncate">${esc(c.note)}</span>
    </div>`).join('');
    detail = `<div class="mt-3 space-y-3">
      <div class="bg-slate-50 rounded-lg p-3">${checkRows}</div>
      ${issues ? `<ul class="space-y-1">${issues}</ul>` : '<div class="text-xs text-green-600">✓ Mobile-ready</div>'}
    </div>`;

  } else if (d.error) {
    detail = `<div class="mt-2 text-sm text-slate-400">${esc(d.error)}</div>`;
  }

  // Collapsible card: header toggles the detail body
  const srcMeta = MODULE_SOURCE[d.module];
  const srcTag = srcMeta ? `<span class="src-badge ${srcMeta.cls} hidden sm:inline-flex">${srcMeta.label}</span>` : '';
  const predictionTag = d.module === 'geo_predicted'
    ? `<span class="text-[10px] font-semibold uppercase border border-purple-200 bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded">${reportLanguage === 'zh' ? '预测结果' : 'Predicted'}</span>`
    : '';
  if (detail) {
    el.innerHTML = `
      <div class="flex items-center gap-2 mb-1 cursor-pointer select-none card-collapse-toggle" data-action="toggle-card">
        <span>${statusIcon}</span>
        <span class="font-semibold text-sm">${moduleName(d.module)}</span>
        ${predictionTag}
        <div class="flex items-center gap-1.5 ml-auto shrink-0">
          ${srcTag}
          ${ms}
          <svg class="chevron w-4 h-4 text-slate-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
        </div>
      </div>
      <div class="card-body">${detail}</div>`;
  } else {
    el.innerHTML = `
      <div class="flex items-center gap-2 mb-1">
        <span>${statusIcon}</span>
        <span class="font-semibold text-sm">${moduleName(d.module)}</span>
        ${predictionTag}
        <div class="flex items-center gap-1.5 ml-auto shrink-0">
          ${srcTag}
          ${ms}
        </div>
      </div>`;
  }

  // Left-border accent colour by status — instant visual scanning
  const statusBorderColor = { ok: '#4ade80', partial: '#fbbf24', failed: '#fb923c' };
  if (statusBorderColor[d.status]) {
    el.style.borderLeftWidth = '3px';
    el.style.borderLeftColor = statusBorderColor[d.status];
  }

  // Keep active category filter in sync during live streaming
  applyActiveCatFilter(el);
}

function wireCopyReport(data) {
  const btn = document.getElementById('copy-report-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const summary = REPORT_UI?.normalizeScoreSummary(data) ?? {};
    const scoreText = value => value == null ? 'evidence insufficient' : `${Math.round(value)}/100`;
    const lines = [
      `GeoScore Audit — ${data.domain}`,
      `Date: ${new Date(data.created_at).toLocaleString()}`,
      '',
      `Overall: ${scoreText(summary.overall)}  |  SEO: ${scoreText(summary.seo)}  |  GEO·AI: ${scoreText(summary.geo)}`,
      '',
    ];
    const tech = data.modules?.technical_seo?.data;
    if (tech) {
      lines.push('── Technical SEO ──');
      lines.push(`Score: ${tech.score}/100`);
      (tech.issues || []).forEach(i => lines.push(`  • ${i}`));
      if (tech.tech_stack?.cms) lines.push(`  CMS: ${tech.tech_stack.cms}`);
      if (tech.security_headers) lines.push(`  Security headers: ${tech.security_headers.score}/100`);
      lines.push('');
    }
    const geo = data.modules?.geo_predicted?.data;
    if (geo && geo.is_reliable !== false) {
      lines.push('── GEO / Predicted Visibility Simulation ──');
      lines.push(`Predicted positive rate: ${Math.round((geo.citation_rate || 0) * 100)}%  |  Avg confidence: ${Math.round((geo.avg_confidence || 0) * 100)}%`);
      (geo.queries || []).forEach(q => lines.push(`  ${q.cited ? '✓' : '✗'} ${q.query}`));
      lines.push('');
    }
    const kw = data.modules?.keywords?.data;
    if (kw?.keywords?.length && kw.is_reliable !== false) {
      lines.push('── Top Keywords ──');
      kw.keywords.slice(0, 15).forEach(k => lines.push(`  [${k.intent}] ${k.keyword}${k.geo_potential ? ' ✦' : ''}`));
      lines.push('');
    }
    const onPage = data.modules?.on_page_seo?.data;
    if (onPage?.page_speed) {
      lines.push('── Core Web Vitals (Mobile) ──');
      const ps = onPage.page_speed;
      lines.push(`  Performance: ${ps.performance}/100  |  Accessibility: ${ps.accessibility}/100`);
      if (ps.lcp_s) lines.push(`  LCP: ${ps.lcp_s}s  CLS: ${ps.cls ?? '—'}  FCP: ${ps.fcp_s}s`);
      lines.push('');
    }
    const offPage = data.modules?.off_page_seo?.data;
    if (offPage) {
      lines.push('── Off-Page SEO ──');
      if (offPage.social_profiles?.length) lines.push(`  Social: ${offPage.social_profiles.map(s => s.platform).join(', ')}`);
      const em = offPage.email_security;
      if (em) lines.push(`  Email security: MX ${em.has_mx ? '✓' : '✗'}  SPF ${em.has_spf ? '✓' : '✗'}  DMARC ${em.has_dmarc ? em.dmarc_policy ?? '✓' : '✗'}`);
      lines.push('');
    }
    const siteIntel = data.modules?.site_intel?.data;
    if (siteIntel) {
      lines.push('── Site Intelligence ──');
      if (siteIntel.hosting?.org) lines.push(`  Host: ${siteIntel.hosting.org_label || siteIntel.hosting.org} (${[siteIntel.hosting.city, siteIntel.hosting.country].filter(Boolean).join(', ')})`);
      if (siteIntel.ip) lines.push(`  IP: ${siteIntel.ip}`);
      if ((siteIntel.fonts?.google_fonts ?? []).length) lines.push(`  Fonts: ${siteIntel.fonts.google_fonts.join(', ')}`);
      if (siteIntel.carbon) lines.push(`  Carbon: ${siteIntel.carbon.grams_per_view}g CO₂/view (rating ${siteIntel.carbon.rating})`);
      lines.push('');
    }
    const redirect = data.modules?.redirect_chain?.data;
    if (redirect) {
      lines.push('── Redirect Chain ──');
      lines.push(`  Hops: ${redirect.chain_length}  |  HTTPS: ${redirect.has_https_redirect ? '✓' : '✗'}  |  Clean: ${redirect.is_clean ? '✓' : '✗'}`);
      (redirect.issues ?? []).forEach(i => lines.push(`  • ${i}`));
      lines.push('');
    }
    const access = data.modules?.accessibility?.data;
    if (access) {
      lines.push('── Accessibility ──');
      lines.push(`  WCAG score: ${access.score}/100`);
      if (access.desktop_cwv) lines.push(`  Desktop Perf: ${access.desktop_cwv.performance}/100  A11y: ${access.desktop_cwv.accessibility_score}/100`);
      // Derive failing checks from wcag_checks[] (issues[] is intentionally empty now — checklist is the single source)
      (access.wcag_checks ?? []).filter(c => !c.passed).slice(0, 3).forEach(c => lines.push(`  • ${c.rule}${c.detail ? ' — ' + c.detail : ''}`));
      lines.push('');
    }
    const recs = data.modules?.recommendations?.data;
    if (recs?.length) {
      lines.push('── Recommendations ──');
      recs.forEach((r, i) => lines.push(`  ${i + 1}. ${r.title} (Impact ${r.impact}/5, Effort ${r.effort}/5)`));
      lines.push('');
    }
    lines.push(`Generated by GeoScore — https://geo.sayori.org/?d=${data.domain}`);
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      btn.textContent = '✓ Copied!';
      setTimeout(() => { btn.innerHTML = '<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy report'; }, 2000);
    });
  }, { once: true });
}


function renderRecommendations(recs) {
  if (!recs?.length) return;
  const existing = document.getElementById('recs-section');
  if (existing) existing.remove();

  recMap.clear();
  const slice = recs.slice(0, 8);
  slice.forEach((r, i) => recMap.set(i, r));

  const el = document.createElement('div');
  el.id = 'recs-section';
  el.className = 'bg-white rounded-xl border border-orange-200 p-4 fade-in mt-3';
  el.style.order = cardOrder('recs-section');
  el.style.display = '';
  const doneSet = getRecDoneSet(currentDomain);
  const effortBadge = (n) => {
    const map = { 1: 'bg-green-50 text-green-700', 2: 'bg-green-50 text-green-700', 3: 'bg-amber-50 text-amber-700', 4: 'bg-orange-50 text-orange-700', 5: 'bg-orange-50 text-orange-700' };
    return `<span class="text-xs ${map[n] || 'bg-slate-100 text-slate-600'} px-2 py-0.5 rounded-full border border-slate-200">${effortTime(n)}</span>`;
  };
  el.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <div>
        <div class="font-bold text-sm text-slate-900">📋 Action Plan</div>
        <div class="text-[10px] text-slate-400 mt-0.5">Ranked by impact-to-effort ratio · check off as you fix</div>
      </div>
      <span class="text-xs font-medium text-slate-500 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full" id="recs-done-count"></span>
    </div>
    <ol class="space-y-2" id="recs-list">
      ${slice.map((r, i) => {
        const isDone = doneSet.has(r.title);
        const impactDots = Array.from({length: 5}, (_, n) =>
          `<span class="inline-block w-1.5 h-1.5 rounded-full ${n < r.impact ? (r.impact >= 4 ? 'bg-orange-500' : r.impact >= 3 ? 'bg-amber-500' : 'bg-blue-400') : 'bg-slate-200'}"></span>`
        ).join('');
        const rankColor = i === 0 ? 'bg-orange-500 text-white' : i <= 2 ? 'bg-amber-400 text-white' : 'bg-slate-100 text-slate-500';
        return `
        <li class="text-sm border border-slate-100 rounded-xl p-3.5 transition-all hover:border-slate-200 hover:shadow-sm ${isDone ? 'rec-done' : ''}" id="rec-item-${i}">
          <div class="flex items-start gap-3">
            <div class="flex flex-col items-center gap-2 shrink-0">
              <span class="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${rankColor}">${i + 1}</span>
              <input type="checkbox" class="rec-checkbox w-4 h-4 rounded accent-green-600 cursor-pointer"
                data-title="${esc(r.title)}" ${isDone ? 'checked' : ''}>
            </div>
            <div class="flex-1 min-w-0">
              <div class="font-semibold text-sm rec-body text-slate-800">${esc(r.title)}</div>
              <div class="text-xs text-slate-500 mt-0.5 leading-relaxed">${esc(r.why)}</div>
              <div class="flex gap-2 mt-2.5 items-center flex-wrap">
                <div class="flex items-center gap-1" title="Impact score ${r.impact}/5">${impactDots}</div>
                <span class="text-[10px] font-medium text-slate-500">Impact ${r.impact}/5</span>
                ${effortBadge(r.effort)}
                <button class="text-xs text-blue-500 hover:text-blue-700 ml-auto transition-colors font-medium" data-action="toggle-fix" data-rec-index="${i}">How to fix ▾</button>
              </div>
              <div class="hidden mt-3 what-to-do"></div>
            </div>
          </div>
        </li>`;
      }).join('')}
    </ol>`;
  // Update done count
  const updateRecsCount = () => {
    const total = slice.length;
    const done = document.querySelectorAll('#recs-list .rec-checkbox:checked').length;
    const countEl = document.getElementById('recs-done-count');
    if (countEl) countEl.textContent = done > 0 ? `${done}/${total} done` : `${total} action${total !== 1 ? 's' : ''}`;
  };
  updateRecsCount();
  // Keep count live as user checks boxes
  document.getElementById('recs-list')?.addEventListener('change', updateRecsCount);
  document.getElementById('modules').appendChild(el);
}

async function toggleWhatToDo(btn) {
  const li = btn.closest('li');
  const box = li && li.querySelector('.what-to-do');
  if (!box) return;

  const isHidden = box.classList.toggle('hidden');
  btn.textContent = isHidden ? uiText('fix.show') : uiText('fix.hide');
  if (isHidden || box.dataset.loaded) return;

  const recommendationId = btn.dataset.recommendationId;
  const rec = recommendationId
    ? recMap.get(String(recommendationId))
    : recMap.get(Number(btn.dataset.recIndex));
  if (!rec) return;

  // First open — fetch AI-generated fix guide
  box.dataset.loaded = '1';
  const fixStart = Date.now();
  const fixTimerEl = document.createElement('div');
  fixTimerEl.className = 'text-xs text-slate-400 italic flex items-center gap-2';
  fixTimerEl.innerHTML = `${esc(uiText('fix.generating'))} <span class="font-mono text-blue-400">0s</span>`;
  box.innerHTML = '';
  box.appendChild(fixTimerEl);
  const fixTimerInterval = setInterval(() => {
    const s = fixTimerEl.querySelector('span');
    if (s) s.textContent = fmtSecs(Date.now() - fixStart);
  }, 1000);

  try {
    if (!currentAuditId || !recommendationId) throw new Error('Fix pack requires an evidence audit');
    const res = await fetch(`${API}/api/fix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audit_id: currentAuditId,
        recommendation_id: recommendationId,
        language: reportLanguage,
        output: 'full',
      }),
    });
    const pack = await res.json().catch(() => null);
    if (!res.ok || !pack) throw new Error(pack?.error?.message || 'Fix pack unavailable');
    clearInterval(fixTimerInterval);
    box.innerHTML = renderFixPack(pack) +
      `<div class="text-[10px] text-slate-300 mt-2 text-right">${fmtSecs(Date.now() - fixStart)}</div>`;
  } catch {
    clearInterval(fixTimerInterval);
    box.innerHTML = `<div class="text-xs text-blue-500">${esc(uiText('fix.failed'))}</div>`;
    delete box.dataset.loaded;
  }
}

function renderFixPack(pack) {
  const sections = [];
  const evidence = pack?.evidence;
  if (evidence) {
    sections.push(`<div><div class="font-semibold text-slate-700 mb-1">${reportLanguage === 'zh' ? '证据摘要' : 'Evidence summary'}</div><div class="text-xs text-slate-500">${esc((evidence.observed ?? []).join(' · ') || evidence.why || '')}</div></div>`);
  }
  if (pack?.code_snippets?.length) {
    sections.push(pack.code_snippets.map(item => `<div><div class="font-semibold text-slate-700 mb-1">${esc(item.label || 'Code')}</div><pre class="bg-slate-900 text-green-300 rounded p-2 text-xs overflow-x-auto whitespace-pre-wrap">${esc(item.code || '')}</pre></div>`).join(''));
  }
  if (pack?.fix_steps?.length) {
    sections.push(`<div><div class="font-semibold text-slate-700 mb-1">${reportLanguage === 'zh' ? '修改步骤' : 'Fix steps'}</div><ol class="list-decimal ml-5 text-xs text-slate-600 space-y-1">${pack.fix_steps.map(item => `<li>${esc(item)}</li>`).join('')}</ol></div>`);
  }
  if (pack?.verify?.length) {
    sections.push(`<div><div class="font-semibold text-slate-700 mb-1">${reportLanguage === 'zh' ? '复验清单' : 'Verification'}</div><ul class="list-disc ml-5 text-xs text-slate-600 space-y-1">${pack.verify.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div>`);
  }
  if (pack?.handoff_prompt) {
    sections.push(`<div><div class="flex items-center justify-between gap-2 mb-1"><div class="font-semibold text-slate-700">${reportLanguage === 'zh' ? '交给开发 AI' : 'Developer AI handoff'}</div><button type="button" data-copy="${esc(pack.handoff_prompt)}" class="text-[10px] text-blue-600 border border-blue-200 rounded px-2 py-1">${esc(uiText('common.copy'))}</button></div><pre class="bg-slate-50 border border-slate-200 rounded p-2 text-xs overflow-x-auto whitespace-pre-wrap text-slate-600">${esc(pack.handoff_prompt)}</pre></div>`);
  }
  return `<div class="space-y-3">${sections.join('')}</div>`;
}

function renderFixMarkdown(text) {
  const escaped = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const html = escaped
    // code blocks ```...```
    .replace(/```[\w]*\n?([\s\S]*?)```/g, (_, c) =>
      `<pre class="bg-slate-900 text-green-300 rounded p-2 my-2 text-xs overflow-x-auto whitespace-pre-wrap">${c.trim()}</pre>`)
    // inline code `...`
    .replace(/`([^`]+)`/g, '<code class="bg-slate-100 text-pink-700 px-1 rounded text-xs">$1</code>')
    // bold **...**
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // headings ## ...
    .replace(/^#{1,3} (.+)$/gm, '<div class="font-semibold text-slate-700 mt-3 mb-1">$1</div>')
    // numbered list items "1. ..."
    .replace(/^(\d+)\. (.+)$/gm, (_, n, content) =>
      `<div class="flex gap-2 mt-2"><span class="shrink-0 font-bold text-blue-600 w-4">${n}.</span><span>${content}</span></div>`)
    // bullet list items "- ..."
    .replace(/^[-•] (.+)$/gm, '<div class="flex gap-2 mt-1 ml-4"><span class="shrink-0 text-slate-400">•</span><span>$1</span></div>')
    // blank lines → spacing
    .replace(/\n{2,}/g, '<div class="mt-2"></div>')
    .replace(/\n/g, ' ');

  return `<div class="text-xs text-slate-700 leading-relaxed space-y-0.5">${html}</div>`;
}

function appendError(msg, temporary = false) {
  const el = document.createElement('div');
  el.className = `${temporary ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-blue-50 border-blue-200 text-blue-700'} border rounded-xl p-4 text-sm fade-in`;
  el.textContent = msg;
  document.getElementById('modules').appendChild(el);
  if (temporary) setTimeout(() => el.remove(), 5000);
}

// ── Chat ────────────────────────────────────────────────────────────────────

function enableChat() {
  const bubble = document.getElementById('chat-bubble');
  if (bubble) bubble.classList.replace('hidden', 'flex');
  const main = document.getElementById('main-content');
  if (main) main.style.paddingBottom = '76px';
}

function openChat() {
  document.getElementById('chat-bubble')?.classList.replace('flex', 'hidden');
  document.getElementById('chat-section')?.classList.remove('hidden');
  const main = document.getElementById('main-content');
  if (main) main.style.paddingBottom = '180px';
  document.getElementById('chat-input')?.focus();
}

function minimizeChat() {
  document.getElementById('chat-section')?.classList.add('hidden');
  const bubble = document.getElementById('chat-bubble');
  if (bubble) bubble.classList.replace('hidden', 'flex');
  const main = document.getElementById('main-content');
  if (main) main.style.paddingBottom = '76px';
}

document.getElementById('chat-bubble')?.addEventListener('click', openChat);
document.getElementById('chat-minimize')?.addEventListener('click', minimizeChat);

function clearChat() {
  const msgs = document.getElementById('chat-messages');
  if (msgs) { msgs.innerHTML = ''; msgs.style.maxHeight = '0'; }
  const clearBtn = document.getElementById('chat-clear');
  if (clearBtn) { clearBtn.classList.add('hidden'); clearBtn.classList.remove('flex'); }
  const sugg = document.getElementById('chat-suggestions');
  if (sugg) sugg.classList.remove('hidden');
}

const chatInput = document.getElementById('chat-input');
const chatSend  = document.getElementById('chat-send');
const chatClear = document.getElementById('chat-clear');

if (chatSend)  chatSend.addEventListener('click', sendChat);
if (chatInput) chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
if (chatClear) chatClear.addEventListener('click', clearChat);

document.querySelectorAll('.chat-suggestion').forEach(btn => {
  btn.addEventListener('click', () => {
    chatInput.value = btn.textContent.trim();
    chatInput.focus();
    sendChat();
  });
});

async function sendChat() {
  const q = chatInput.value.trim();
  if (!q || !currentAuditId) return;
  chatInput.value = '';
  chatSend.disabled = true;

  appendChatMessage('user', q);
  const assistantEl = appendChatMessage('assistant', '…');
  const chatStart = Date.now();
  const chatTimerInterval = setInterval(() => {
    if (!assistantEl.textContent || assistantEl.textContent === '…') {
      assistantEl.textContent = `… ${fmtSecs(Date.now() - chatStart)}`;
    }
  }, 1000);

  try {
    const res = await fetch(`${API}/api/chat/${currentAuditId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, session_id: sessionId }),
    });

    if (!res.ok) { clearInterval(chatTimerInterval); assistantEl.textContent = 'Error getting response.'; return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    assistantEl.textContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value).split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.response) { buffer += data.response; assistantEl.textContent = buffer; }
        } catch { /* skip */ }
      }
    }
    clearInterval(chatTimerInterval);
    document.getElementById('chat-messages').scrollTop = 9999;
  } catch {
    clearInterval(chatTimerInterval);
    assistantEl.textContent = 'Network error. Please try again.';
  } finally {
    chatSend.disabled = false;
  }
}

function appendChatMessage(role, text) {
  const msgs = document.getElementById('chat-messages');
  if (!msgs.children.length) {
    msgs.style.maxHeight = '220px';
    // Show clear button and hide suggestion chips once conversation begins
    const clearBtn = document.getElementById('chat-clear');
    if (clearBtn) { clearBtn.classList.remove('hidden'); clearBtn.classList.add('flex'); }
    document.getElementById('chat-suggestions')?.classList.add('hidden');
  }
  const el = document.createElement('div');
  el.className = role === 'user'
    ? 'text-sm bg-blue-50 text-blue-900 px-3 py-2 rounded-xl self-end ml-8'
    : 'text-sm bg-slate-100 text-slate-800 px-3 py-2 rounded-xl mr-8';
  el.textContent = text;
  msgs.appendChild(el);
  msgs.scrollTop = 9999;
  return el;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Decode HTML entities from server-returned strings (e.g. &amp; → &) before rendering in the UI.
// The server returns raw HTML values extracted from <title> / meta tags that are already HTML-encoded.
// Without this, esc('&amp;') would double-encode to &amp;amp;.
function decodeHTMLEntities(str) {
  const el = document.createElement('textarea');
  el.innerHTML = String(str ?? '');
  return el.value;
}

const TECH_TIPS = {
  'HSTS': 'HTTP Strict Transport Security — forces browsers to always use HTTPS',
  'CSP': 'Content Security Policy — controls which scripts and resources the browser can load',
  'X-Frame-Options': 'Prevents your page from being embedded in iframes (clickjacking protection)',
  'canonical': 'Tells search engines which URL is the preferred version of a page',
  'DMARC': 'Email authentication policy that prevents spoofing of your domain in emails',
  'SPF': 'Sender Policy Framework — verifies which servers can send email for your domain',
  'MX': 'Mail Exchange — DNS record that routes email to your mail server',
  'robots\\.txt': 'File that tells search engine crawlers which pages to skip',
  'sitemap\\.xml': 'Map of all your URLs — helps search engines discover your content',
  'JSON-LD': "Google's preferred structured data format, embedded in a script tag",
  'WebP': 'Modern image format — 25–34% smaller than JPEG/PNG with same quality',
  'AVIF': 'Next-gen image format — even smaller file sizes than WebP',
  'alt text': 'Text description of an image, used by screen readers and search engines',
  'WCAG': 'Web Content Accessibility Guidelines — international standards for accessible websites',
  'GEO': 'Generative Engine Optimization — optimizing content to appear in AI-generated answers',
  'E-E-A-T': 'Experience, Expertise, Authoritativeness, Trustworthiness — Google\'s quality signals',
  'llms\\.txt': 'A file that helps AI models like ChatGPT and Claude understand your site',
  'Open Graph': 'Meta tags that control how your page looks when shared on social media',
  'schema markup': 'Structured data code that helps search engines understand your content',
  'backlinks': 'Links from other websites to yours — a major Google ranking factor',
  'SERP': 'Search Engine Results Page — what users see after a Google search',
  'CLS': 'Cumulative Layout Shift — measures unexpected layout shifts while the page loads',
  'LCP': 'Largest Contentful Paint — time for the main content block to appear on screen',
  'FCP': 'First Contentful Paint — time until the browser first shows any content',
  'TTFB': 'Time to First Byte — how fast the server starts sending a response',
  'IPv6': 'Latest internet protocol version with a much larger address space than IPv4',
  'CDN': 'Content Delivery Network — servers around the world that serve your site faster',
  'hreflang': 'HTML attribute telling search engines which language and region a page targets',
  'Core Web Vitals': "Google's key page experience metrics that affect search rankings",
};

function tipify(escapedHtml) {
  let result = escapedHtml;
  for (const [rawTerm, desc] of Object.entries(TECH_TIPS)) {
    const re = new RegExp(`\\b(${rawTerm})\\b`, 'gi');
    result = result.replace(re, `<abbr class="tech-tip" title="${desc.replace(/"/g, '&quot;')}">$1</abbr>`);
  }
  return result;
}

function renderSummaryBullets(text) {
  if (!text) return '';
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let bullets;
  if (lines.some(l => /^[-•*]|\d+\./.test(l))) {
    bullets = lines.map(l => l.replace(/^[-•*]\s*|\d+\.\s*/, '')).filter(Boolean);
  } else {
    bullets = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 10);
  }
  return `<ul class="space-y-2">${bullets.map(b =>
    `<li class="flex gap-2 text-sm leading-relaxed"><span class="text-blue-400 shrink-0 mt-0.5">•</span><span class="text-blue-900">${tipify(esc(b))}</span></li>`
  ).join('')}</ul>`;
}

function scoreVitals(value, good, poor, label, display) {
  const color = value <= good ? 'text-green-600 border-green-200 bg-green-50'
              : value <= poor ? 'text-amber-600 border-amber-200 bg-amber-50'
              : 'text-blue-600 border-blue-200 bg-blue-50';
  return `<span class="text-[10px] border px-1.5 py-0.5 rounded-full font-medium ${color}">${label}: ${display}</span>`;
}

function moduleName(key) {
  const names = {
    technical_seo:        '⚙️ Technical SEO',
    schema_audit:         '🗂️ Schema Markup',
    content_quality:      '📝 Content Quality',
    authority:            '🏛️ Domain Authority',
    geo_predicted:        '🤖 AI Visibility · Predicted Citation Simulation',
    recommendations:      '📋 Recommendations',
    keywords:             '🔑 Keyword Opportunities',
    on_page_seo:          '📄 On-Page SEO · Core Web Vitals',
    off_page_seo:         '🔗 Off-Page SEO · Social & Email',
    site_intel:           '🌐 Site Intelligence · Hosting & Fonts',
    redirect_chain:       '↪️ Redirect Chain Audit',
    accessibility:        '♿ Accessibility · WCAG Audit',
    security_audit:       '🛡️ Security Audit · Mozilla Observatory',
    ssl_cert:             '🔒 SSL Certificate',
    domain_intel:         '🔍 Domain Intel · WHOIS & Email Security',
    crux:                 '📊 Core Web Vitals · Real-User Data (CrUX)',
    ai_content_insights:  '🧠 AI Content Insights',
    robots_sitemap:       '🕷️ Crawlability · robots.txt & Sitemap',
    broken_links:         '🔗 Broken Link Checker',
    mobile_audit:         '📱 Mobile Readiness',
    lighthouse:           '⚡ Lighthouse · Performance Scores',
    cache:                'Cache',
  };
  return names[key] || key.replace(/_/g, ' ');
}

// ── Computed sections rendered after full audit data arrives ────────────────

function renderComputedSections(data) {
  // Guard: only run once per audit (cache-hit + complete both call renderFullAudit)
  if (computedSectionsRendered) return;
  computedSectionsRendered = true;
  const evidenceContract = Boolean(data?.score_summary?.score_version);

  const mods = data.modules ?? {};
  const techData = mods.technical_seo?.data;
  const schemaData = mods.schema_audit?.data;
  const authData = mods.authority?.data;
  const contentData = mods.content_quality?.data;
  const offPageData = mods.off_page_seo?.data;
  const onPageData = mods.on_page_seo?.data;
  const geoData = mods.geo_predicted?.data;
  const kwData = mods.keywords?.data;
  // Business name used in data- attributes for schema/geo generators
  const businessName = schemaData?.org_name ?? onPageData?.site_name ?? data.domain ?? '';

  const addCard = (id, category, html) => {
    if (document.getElementById(id)) return;
    const el = document.createElement('div');
    el.id = id;
    el.className = 'bg-white rounded-xl border border-slate-200 p-5 fade-in';
    el.dataset.category = category;
    el.innerHTML = html;
    el.style.order = cardOrder(id);
    document.getElementById('modules').appendChild(el);
    applyActiveCatFilter(el);
  };

  // ── SERP Preview ──────────────────────────────────────────────────────────
  if (techData?.page_meta) {
    const pm = techData.page_meta;
    // Decode HTML entities from server-extracted meta values (e.g. &amp; → &) before rendering.
    // The server returns raw HTML-encoded strings; esc() re-encodes them, so we decode first.
    const serpTitle = decodeHTMLEntities(pm.title || pm.og_title || data.domain);
    const serpDesc = decodeHTMLEntities(pm.description || pm.og_description || 'No meta description found.');
    const serpUrl = pm.canonical_url || `https://${data.domain}/`;
    const titleLen = (pm.title || '').length;
    const descLen = (pm.description || '').length;
    const titleColor = titleLen > 70 ? 'text-blue-600' : titleLen < 30 ? 'text-amber-600' : 'text-green-700';
    const descColor = descLen > 170 ? 'text-blue-600' : descLen < 100 ? 'text-amber-600' : 'text-green-700';

    addCard('card-serp-preview', 'previews', `
      <div class="flex items-center justify-between mb-3">
        <div class="font-semibold text-sm">🔍 SERP Snippet Preview</div>
        <div class="flex gap-3 text-[10px]">
          <span class="${titleColor}">Title: ${titleLen} chars</span>
          <span class="${descColor}">Desc: ${descLen} chars</span>
        </div>
      </div>
      <div class="border border-slate-200 rounded-xl p-4 bg-white max-w-2xl font-sans">
        <div class="text-xs text-slate-500 mb-1 truncate">${esc(serpUrl)}</div>
        <div class="text-blue-700 text-lg leading-snug hover:underline cursor-pointer font-normal" style="font-family: arial, sans-serif; font-size: 20px; color: #1a0dab; line-clamp: 1; overflow: hidden; white-space: nowrap;">${esc(serpTitle)}</div>
        <div class="text-slate-700 text-sm mt-1 leading-snug" style="font-family: arial, sans-serif; font-size: 14px; color: #4d5156; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${esc(serpDesc)}</div>
      </div>
      ${titleLen > 70 ? '<p class="text-xs text-blue-500 mt-2">⚠ Title too long — Google will truncate it at ~60 chars</p>' : ''}
      ${descLen > 170 ? '<p class="text-xs text-blue-500 mt-1">⚠ Description too long — will be cut off in SERP</p>' : ''}
      ${descLen < 100 ? '<p class="text-xs text-amber-600 mt-1">⚠ Description too short — aim for 100–170 chars</p>' : ''}
      <div class="mt-3">
        <button id="serp-gen-btn"
          data-title="${esc(serpTitle)}"
          data-desc="${esc(serpDesc)}"
          data-domain="${esc(data.domain)}"
          class="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors font-medium">
          ✨ Generate optimal snippet
        </button>
      </div>
      <div id="serp-gen-output" class="hidden mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
        <div class="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1">Optimised snippet</div>
        <div>
          <div class="flex items-baseline gap-1.5 mb-0.5">
            <span class="text-[10px] text-slate-400">Title</span>
            <span id="serp-gen-title-len" class="text-[10px] text-slate-400"></span>
          </div>
          <div id="serp-gen-title" class="text-sm text-slate-800 font-medium leading-snug"></div>
        </div>
        <div>
          <div class="flex items-baseline gap-1.5 mb-0.5">
            <span class="text-[10px] text-slate-400">Description</span>
            <span id="serp-gen-desc-len" class="text-[10px] text-slate-400"></span>
          </div>
          <div id="serp-gen-desc" class="text-sm text-slate-600 leading-snug"></div>
        </div>
        <div class="flex gap-2 pt-1">
          <button id="serp-copy-title-btn" class="text-xs border border-slate-200 bg-white px-2 py-1 rounded hover:bg-slate-100 transition-colors">Copy title</button>
          <button id="serp-copy-desc-btn" class="text-xs border border-slate-200 bg-white px-2 py-1 rounded hover:bg-slate-100 transition-colors">Copy description</button>
        </div>
      </div>
    `);
  }

  // ── Social Card Preview ───────────────────────────────────────────────────
  if (techData?.page_meta) {
    const pm = techData.page_meta;
    const cardTitle = decodeHTMLEntities(pm.og_title || pm.title || data.domain);
    const cardDesc = decodeHTMLEntities(pm.og_description || pm.description || 'No description');
    const domainDisplay = data.domain.toUpperCase();
    let ogImageUrl = pm.og_image || '';
    if (ogImageUrl && !ogImageUrl.startsWith('http')) {
      ogImageUrl = `https://${data.domain}${ogImageUrl.startsWith('/') ? '' : '/'}${ogImageUrl}`;
    }

    const imgPlaceholder = (h, label) =>
      `<div class="h-${h} bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-slate-400 text-xs">${label}</div>`;
    const imgTag = (h, url) =>
      url ? `<div class="bg-slate-100 h-${h} overflow-hidden"><img src="${esc(url)}" alt="OG preview" class="w-full h-full object-cover og-preview-img"></div>`
           : imgPlaceholder(h, 'No og:image set');

    // OG completeness audit
    const ogFields = [
      { tag: 'og:title',       val: pm.og_title },
      { tag: 'og:description', val: pm.og_description },
      { tag: 'og:image',       val: pm.og_image },
      { tag: 'og:type',        val: pm.og_type },
      { tag: 'og:site_name',   val: pm.og_site_name },
    ];
    const ogAuditRows = ogFields.map(({ tag, val }) => {
      const ok = !!val;
      const dot = ok ? '<span class="text-green-500">●</span>' : '<span class="text-amber-400">●</span>';
      const value = val ? `<span class="text-slate-500 font-mono truncate max-w-[180px] inline-block align-bottom">${esc(String(val).slice(0, 60))}${val.length > 60 ? '…' : ''}</span>` : `<span class="text-amber-600">not set</span>`;
      return `<div class="flex items-center gap-2 py-0.5">${dot}<span class="text-slate-600 w-28 shrink-0">${tag}</span>${value}</div>`;
    }).join('');

    // Social profiles — use off_page_seo (richer: platform + handle) rather than
    // technical_seo's page_meta.social_profiles (URL strings only, now removed)
    const profiles = offPageData?.social_profiles ?? [];
    const profileChips = profiles.map(s =>
      `<a href="${esc(s.url)}" target="_blank" rel="noopener" class="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded-full font-medium transition-colors">${esc(s.platform)} <span class="opacity-60">${esc(s.handle)}</span></a>`
    ).join('');

    // lang badge
    const langBadge = pm.lang
      ? `<span class="text-[10px] bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full">lang="${esc(pm.lang)}" ✓</span>`
      : `<span class="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">lang attribute missing</span>`;

    addCard('card-social-preview', 'previews', `
      <div class="flex items-center justify-between mb-3">
        <div class="font-semibold text-sm">📱 Social Share &amp; Meta Tags</div>
        ${ogImageUrl ? `<button id="og-download-btn" data-image-url="${esc(ogImageUrl)}" data-domain="${esc(data.domain)}" class="text-xs border border-slate-200 px-2.5 py-1.5 rounded-lg hover:bg-slate-50 transition-colors text-slate-600 flex items-center gap-1.5 shrink-0">⬇ Download OG image</button>` : ''}
      </div>
      <div class="flex gap-3 flex-wrap mb-3">
        <div class="flex-1 min-w-52 max-w-xs">
          <div class="text-[10px] text-slate-400 mb-1.5 font-medium">𝕏 Twitter / X Card</div>
          <div class="border border-slate-200 rounded-xl overflow-hidden bg-white">
            ${imgTag(36, ogImageUrl)}
            <div class="p-3">
              <div class="text-[11px] text-slate-500 uppercase tracking-wide">${esc(domainDisplay)}</div>
              <div class="text-sm font-semibold text-slate-900 leading-snug mt-0.5 truncate">${esc(cardTitle)}</div>
              <div class="text-xs text-slate-500 mt-0.5 line-clamp-2">${esc(cardDesc)}</div>
            </div>
          </div>
        </div>
        <div class="flex-1 min-w-52 max-w-xs">
          <div class="text-[10px] text-slate-400 mb-1.5 font-medium">LinkedIn Post</div>
          <div class="border border-slate-200 rounded-xl overflow-hidden bg-white">
            ${imgTag(32, ogImageUrl)}
            <div class="p-3 bg-slate-50 border-t border-slate-100">
              <div class="text-sm font-semibold text-slate-900 leading-snug line-clamp-2">${esc(cardTitle)}</div>
              <div class="text-[11px] text-slate-500 mt-0.5">${esc(data.domain)}</div>
            </div>
          </div>
        </div>
      </div>
      <div class="border border-slate-100 rounded-lg p-3 bg-slate-50 mb-3">
        <div class="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Open Graph completeness</div>
        <div class="text-xs space-y-0">${ogAuditRows}</div>
      </div>
      ${profiles.length ? `<div class="mb-2"><div class="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Social profiles found</div><div class="flex flex-wrap gap-1.5">${profileChips}</div></div>` : '<div class="text-xs text-amber-600 mb-2">⚠ No social profile links detected — add links to your LinkedIn, Twitter/X, Facebook, etc.</div>'}
      ${(pm.article_published_time || pm.article_modified_time || pm.article_author) ? `
      <div class="border border-slate-100 rounded-lg p-3 bg-slate-50 mb-2">
        <div class="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Article metadata</div>
        <div class="text-xs space-y-0.5">
          ${pm.article_published_time ? `<div class="flex items-center gap-2"><span class="text-green-500">●</span><span class="text-slate-500 w-28 shrink-0">Published</span><span class="text-slate-700 font-mono">${esc(new Date(pm.article_published_time).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'}))}</span></div>` : ''}
          ${pm.article_modified_time ? `<div class="flex items-center gap-2"><span class="text-green-500">●</span><span class="text-slate-500 w-28 shrink-0">Last updated</span><span class="text-slate-700 font-mono">${esc(new Date(pm.article_modified_time).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'}))}</span></div>` : ''}
          ${pm.article_author ? `<div class="flex items-center gap-2"><span class="text-green-500">●</span><span class="text-slate-500 w-28 shrink-0">Author</span><span class="text-slate-700">${esc(pm.article_author)}</span></div>` : ''}
        </div>
      </div>` : ''}
      <div class="flex items-center gap-2 flex-wrap mt-1">
        ${langBadge}
        ${pm.twitter_card ? `<span class="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">twitter:card = ${esc(pm.twitter_card)}</span>` : '<span class="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">twitter:card missing</span>'}
        ${pm.og_type ? `<span class="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">og:type = ${esc(pm.og_type)}</span>` : ''}
      </div>
    `);
  }

  // ── Structured Data Viewer ────────────────────────────────────────────────
  if (schemaData?.schemas_raw?.length) {
    const blocks = schemaData.schemas_raw.slice(0, 5);
    const blockHtml = blocks.map((schema, i) => {
      const formatted = JSON.stringify(schema, null, 2);
      const type = (schema['@type'] || 'Schema') + '';
      return `<details class="border border-slate-200 rounded-lg overflow-hidden">
        <summary class="px-3 py-2 bg-slate-50 hover:bg-slate-100 cursor-pointer text-xs font-medium flex items-center gap-2">
          <span class="text-blue-600">{ }</span> ${esc(type)}
        </summary>
        <pre class="text-[10px] bg-slate-900 text-green-300 p-3 overflow-x-auto leading-relaxed whitespace-pre-wrap" style="max-height:200px">${esc(formatted)}</pre>
      </details>`;
    }).join('');
    addCard('card-structured-data', 'previews', `
      <div class="font-semibold text-sm mb-3">🔬 Structured Data Viewer</div>
      <div class="space-y-1.5">${blockHtml}</div>
      ${schemaData.schemas_raw.length > 5 ? `<div class="text-xs text-slate-400 mt-2">+ ${schemaData.schemas_raw.length - 5} more schema blocks</div>` : ''}
    `);
  }

  // ── E-E-A-T Scorecard ─────────────────────────────────────────────────────
  if (!evidenceContract) {
    const eeat = computeEeat({ techData, schemaData, authData, contentData, offPageData, onPageData });
    addCard('card-eeat', 'geo', `
    <div class="font-semibold text-sm mb-3">🏅 E-E-A-T Scorecard
      <span class="text-xs text-slate-400 font-normal ml-2">Google quality evaluator signals</span>
    </div>
    <div class="space-y-2.5">
      ${renderEeatBar('Experience', 'E', eeat.experience, 'Content depth, FAQs, rich media, freshness signals')}
      ${renderEeatBar('Expertise', 'E', eeat.expertise, 'Schema completeness, author signals, content quality')}
      ${renderEeatBar('Authoritativeness', 'A', eeat.authority, 'Domain age, Wikipedia/Wikidata, backlinks, social presence')}
      ${renderEeatBar('Trustworthiness', 'T', eeat.trustworthiness, 'HTTPS, security headers, DMARC/SPF, canonical, privacy policy')}
    </div>
    <div class="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2">
      <div class="flex-1 bg-slate-100 rounded-full h-2">
        <div class="${eeat.total >= 70 ? 'bg-green-500' : eeat.total >= 40 ? 'bg-yellow-400' : 'bg-blue-400'} h-2 rounded-full transition-all" style="width:${eeat.total}%"></div>
      </div>
      <span class="text-sm font-bold ${eeat.total >= 70 ? 'text-green-600' : eeat.total >= 40 ? 'text-yellow-600' : 'text-blue-500'}">${eeat.total}/100</span>
      <span class="text-xs text-slate-400">Overall E-E-A-T</span>
    </div>
    `);
  }

  // ── SSL Certificate ───────────────────────────────────────────────────────
  // Skip if the richer streaming card (module-ssl_cert) already exists in the DOM —
  // renderSection() for ssl_cert produces a more detailed card with a validity progress bar.
  const sslData = mods.ssl_cert?.data;
  if (sslData && !document.getElementById('module-ssl_cert')) {
    const daysLeft = sslData.days_remaining ?? 0;
    const isValid = sslData.is_valid;
    const statusColor = !isValid ? 'text-slate-600 bg-slate-100 border-slate-200'
      : daysLeft <= 30 ? 'text-orange-600 bg-orange-50 border-orange-200'
      : daysLeft <= 90 ? 'text-amber-600 bg-amber-50 border-amber-200'
      : 'text-green-700 bg-green-50 border-green-200';
    const statusIcon = !isValid ? '⚪' : daysLeft <= 30 ? '🔴' : daysLeft <= 90 ? '🟡' : '🟢';
    addCard('card-ssl-cert', 'seo', `
      <div class="flex items-center justify-between mb-3">
        <div class="font-semibold text-sm">🔒 SSL Certificate</div>
        <span class="text-xs px-2 py-1 rounded-full border font-medium ${statusColor}">${statusIcon} ${isValid ? `${daysLeft} days left` : 'Not found'}</span>
      </div>
      ${isValid ? `
      <div class="grid grid-cols-2 gap-2 text-xs">
        <div class="bg-slate-50 rounded-lg p-2.5">
          <div class="text-slate-400 mb-0.5">Issuer</div>
          <div class="font-medium text-slate-800 truncate">${esc(sslData.issuer || 'Unknown')}</div>
        </div>
        <div class="bg-slate-50 rounded-lg p-2.5">
          <div class="text-slate-400 mb-0.5">Expires</div>
          <div class="font-medium text-slate-800">${esc(sslData.valid_to || '—')}</div>
        </div>
        <div class="bg-slate-50 rounded-lg p-2.5">
          <div class="text-slate-400 mb-0.5">Valid from</div>
          <div class="font-medium text-slate-800">${esc(sslData.valid_from || '—')}</div>
        </div>
        <div class="bg-slate-50 rounded-lg p-2.5">
          <div class="text-slate-400 mb-0.5">Days remaining</div>
          <div class="font-semibold ${daysLeft <= 30 ? 'text-orange-600' : daysLeft <= 90 ? 'text-amber-600' : 'text-green-700'}">${daysLeft}</div>
        </div>
      </div>
      ` : `<div class="text-xs text-slate-600 bg-slate-50 rounded-lg p-3">${esc(sslData.issues?.[0] || 'SSL certificate could not be verified')}</div>`}
    `);
  }

  // ── Readability ───────────────────────────────────────────────────────────
  const readability = contentData?.readability;
  if (readability && contentData?.word_count >= 30) {
    const readabilityState = REPORT_UI?.readabilityView?.(readability, reportLanguage) ?? {
      applicable: readability.applicable !== false && Number.isFinite(readability.flesch_ease),
      score: Number.isFinite(readability.flesch_ease) ? readability.flesch_ease : null,
      label: readability.grade_label || 'Unavailable',
    };
    if (!readabilityState.applicable) {
      addCard('card-readability', 'seo', `
        <div class="font-semibold text-sm mb-2">📖 Readability</div>
        <div class="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">${esc(readabilityState.label)}. No English Flesch score is shown for this content.</div>
        ${readability.reading_time_min ? `<div class="text-xs text-slate-400 mt-2">Estimated read time: ${readability.reading_time_min} min</div>` : ''}
      `);
    } else {
      const ease = readabilityState.score;
      const easeColor = ease >= 70 ? 'text-green-700' : ease >= 50 ? 'text-amber-600' : 'text-orange-600';
      const easeBg = ease >= 70 ? 'bg-green-50 border-green-200' : ease >= 50 ? 'bg-amber-50 border-amber-200' : 'bg-orange-50 border-orange-200';
      const easeBarColor = ease >= 70 ? 'bg-green-500' : ease >= 50 ? 'bg-yellow-400' : 'bg-blue-400';
      addCard('card-readability', 'seo', `
        <div class="flex items-center justify-between mb-3">
          <div class="font-semibold text-sm">📖 Readability Score</div>
          <span class="text-xs px-2 py-1 rounded-full border font-medium ${easeColor} ${easeBg}">${esc(readability.grade_label || '—')}</span>
        </div>
        <div class="mb-3">
          <div class="flex justify-between text-xs text-slate-500 mb-1">
            <span>Flesch Reading Ease</span><span class="font-semibold ${easeColor}">${ease}/100</span>
          </div>
          <div class="bg-slate-100 rounded-full h-2">
            <div class="${easeBarColor} h-2 rounded-full transition-all" style="width:${ease}%"></div>
          </div>
          <div class="flex justify-between text-[10px] text-slate-400 mt-0.5"><span>Very Difficult</span><span>Very Easy</span></div>
        </div>
        <div class="grid grid-cols-3 gap-2 text-xs">
          <div class="bg-slate-50 rounded-lg p-2 text-center">
            <div class="font-semibold text-slate-800">${readability.grade_level ?? '—'}</div>
            <div class="text-slate-400 text-[10px]">Grade level</div>
          </div>
          <div class="bg-slate-50 rounded-lg p-2 text-center">
            <div class="font-semibold text-slate-800">${readability.avg_words_per_sentence ?? '—'}</div>
            <div class="text-slate-400 text-[10px]">Words/sentence</div>
          </div>
          <div class="bg-slate-50 rounded-lg p-2 text-center">
            <div class="font-semibold text-slate-800">${readability.reading_time_min ?? '—'} min</div>
            <div class="text-slate-400 text-[10px]">Read time</div>
          </div>
        </div>
        ${(readability.grade_level ?? 0) >= 12 ? `<p class="mt-2 text-xs text-slate-400">Technical or B2B content naturally scores lower on readability scales — AI engines still index complex content well.</p>` : ''}
      `);
    }
  }

  // ── Technology Stack (Wappalyzer-style grouped categories) ───────────────
  if (techData?.tech_stack) {
    const ts = techData.tech_stack;
    const versions = ts.versions ?? {};
    const siData = mods.site_intel?.data;
    const sslData = mods.ssl_cert?.data;

    const paasLabel = ts.paas || siData?.hosting?.org_label || null;

    const sslCA = (() => {
      const issuer = sslData?.issuer ?? '';
      // Skip placeholder strings that don't represent real CA names
      const _PLACEHOLDERS = new Set(['Unknown', 'Unverified', 'Verified (details unavailable)', '']);
      if (!issuer || _PLACEHOLDERS.has(issuer)) return null;
      if (/digicert/i.test(issuer)) return 'DigiCert';
      if (/letsencrypt|let's encrypt/i.test(issuer)) return "Let's Encrypt";
      if (/comodo|sectigo/i.test(issuer)) return 'Sectigo';
      if (/globalsign/i.test(issuer)) return 'GlobalSign';
      if (/entrust/i.test(issuer)) return 'Entrust';
      if (/godaddy/i.test(issuer)) return 'GoDaddy';
      if (/amazon/i.test(issuer)) return 'Amazon';
      if (/google/i.test(issuer)) return 'Google Trust Services';
      if (/cloudflare/i.test(issuer)) return 'Cloudflare';
      return issuer.split(',')[0]?.replace(/CN=|O=/g, '').trim() || null;
    })();

    const mx0 = siData?.dns?.mx?.[0]?.exchange ?? '';
    const mxEmailProvider = mx0.includes('google') || mx0.includes('gmail') ? 'Google Workspace'
      : mx0.includes('outlook') || mx0.includes('microsoft') ? 'Microsoft 365'
      : mx0.includes('protonmail') ? 'ProtonMail'
      : mx0.includes('mailgun') ? 'Mailgun'
      : mx0.includes('sendgrid') ? 'SendGrid'
      : mx0.includes('mxroute') ? 'MXroute'
      : mx0.includes('zoho') ? 'Zoho Mail'
      // Namecheap email forwarding service
      : mx0.includes('registrar-servers') ? 'Namecheap'
      : mx0 ? mx0.split('.').slice(-2, -1)[0] || null : null;

    // Chip with optional version badge
    const chip = (label, color) => {
      const ver = versions[label];
      const verBadge = ver ? `<span class="ml-1 text-[9px] opacity-60 font-mono">v${esc(ver)}</span>` : '';
      return `<span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-${color}-50 text-${color}-700 border border-${color}-200">${esc(label)}${verBadge}</span>`;
    };

    // Section header for visual grouping
    const sectionHeader = (label) =>
      `<div class="text-[10px] font-semibold text-slate-300 uppercase tracking-wider pt-3 pb-1 first:pt-0">${label}</div>`;

    const row = (label, items, color) => items.length === 0 ? '' :
      `<div class="flex items-start gap-3 py-1.5 border-b border-slate-50 last:border-0">
        <div class="text-[11px] text-slate-400 w-32 shrink-0 pt-0.5">${label}</div>
        <div class="flex flex-wrap gap-1">${items.map(i => chip(i, color)).join('')}</div>
      </div>`;

    const totalThirdParty = siData?.third_party?.total_third_party_domains ?? 0;
    let totalDetected = 0;

    // Count all detected technologies
    const allGroups = [
      ts.web_server, ts.cdn, paasLabel, ts.backend_language,
      ts.cms, ts.ecommerce,
      ...(ts.frameworks ?? []), ...(ts.js_libraries ?? []), ts.css_framework,
      ...(ts.analytics ?? []), ...(ts.tag_manager ?? []), ...(ts.heatmaps ?? []), ...(ts.ab_testing ?? []),
      ts.chat, ...(ts.forms ?? []), ...(ts.video ?? []), ...(ts.maps ?? []),
      ...(ts.payments ?? []), ...(ts.email_marketing ?? []), ...(ts.monitoring ?? []),
      ts.cookie_consent, sslCA, mxEmailProvider,
    ];
    totalDetected = allGroups.filter(Boolean).length;

    const infrastructureRows = [
      row('Web server',   ts.web_server ? [ts.web_server] : [],         'slate'),
      row('CDN',          ts.cdn ? [ts.cdn] : [],                       'blue'),
      row('PaaS / Host',  paasLabel ? [paasLabel] : [],                 'orange'),
      row('Backend',      ts.backend_language ? [ts.backend_language] : [], 'zinc'),
    ].join('');

    const platformRows = [
      row('CMS',          ts.cms ? [ts.cms] : [],                       'purple'),
      row('E-commerce',   ts.ecommerce ? [ts.ecommerce] : [],           'pink'),
    ].join('');

    const frontendRows = [
      row('JS Framework', ts.frameworks ?? [],                          'indigo'),
      row('JS Libraries', ts.js_libraries ?? [],                        'violet'),
      row('CSS Framework',ts.css_framework ? [ts.css_framework] : [],   'fuchsia'),
    ].join('');

    const trackingRows = [
      row('Analytics',    ts.analytics ?? [],                           'green'),
      row('Tag manager',  ts.tag_manager ?? [],                         'teal'),
      row('Heatmaps',     ts.heatmaps ?? [],                            'cyan'),
      row('A/B testing',  ts.ab_testing ?? [],                         'sky'),
    ].join('');

    const engagementRows = [
      row('Live chat',    ts.chat ? [ts.chat] : [],                     'emerald'),
      row('Forms',        ts.forms ?? [],                               'lime'),
      row('Video',        ts.video ?? [],                               'red'),
      row('Maps',         ts.maps ?? [],                                'rose'),
    ].join('');

    const businessRows = [
      row('Payments',     ts.payments ?? [],                            'amber'),
      row('Email mktg',   ts.email_marketing ?? [],                    'yellow'),
      row('Monitoring',   ts.monitoring ?? [],                          'slate'),
    ].join('');

    const complianceRows = [
      row('Cookie consent', ts.cookie_consent ? [ts.cookie_consent] : [], 'amber'),
      row('SSL/TLS CA',   sslCA ? [sslCA] : [],                        'emerald'),
      row('Email host',   mxEmailProvider ? [mxEmailProvider] : [],    'sky'),
    ].join('');

    const buildSection = (header, content) => content.trim()
      ? `${sectionHeader(header)}${content}` : '';

    const allSections = [
      buildSection('Infrastructure', infrastructureRows),
      buildSection('Platform', platformRows),
      buildSection('Frontend', frontendRows),
      buildSection('Tracking & Analytics', trackingRows),
      buildSection('Engagement', engagementRows),
      buildSection('Business', businessRows),
      buildSection('Compliance & Trust', complianceRows),
    ].filter(Boolean).join('');

    addCard('card-tech-stack', 'seo', `
      <div class="flex items-center justify-between mb-3">
        <div class="font-semibold text-sm">⚙️ Technology Stack</div>
        <div class="flex items-center gap-2">
          ${totalDetected > 0 ? `<span class="text-[11px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">${totalDetected} detected</span>` : ''}
          ${totalThirdParty > 0 ? `<span class="text-[11px] text-slate-400">${totalThirdParty} 3rd-party domains</span>` : ''}
        </div>
      </div>
      ${allSections || '<div class="text-xs text-slate-400 py-2">No technology fingerprints detected</div>'}
      <div class="mt-3 pt-2.5 border-t border-slate-100 flex items-center gap-3 flex-wrap text-[11px] text-slate-400">
        <span class="text-slate-300 italic">Fingerprint-based · individual signals may vary</span>
        ${totalThirdParty > 5 ? `<span class="text-amber-600">⚠ ${totalThirdParty} 3rd-party domains — review for privacy impact</span>` : totalThirdParty > 0 ? `<span>${totalThirdParty} 3rd-party domains</span>` : ''}
      </div>
    `);
  }

  // ── DNS & Network ─────────────────────────────────────────────────────────
  const siteIntelData = mods.site_intel?.data;
  if (siteIntelData?.dns) {
    const dns = siteIntelData.dns;
    const mxProvider = dns.mx?.[0]?.exchange
      ? (dns.mx[0].exchange.includes('google') ? 'Google Workspace'
        : dns.mx[0].exchange.includes('outlook') || dns.mx[0].exchange.includes('microsoft') ? 'Microsoft 365'
        : dns.mx[0].exchange.includes('protonmail') ? 'ProtonMail'
        : dns.mx[0].exchange.includes('mailgun') ? 'Mailgun'
        // Namecheap email forwarding service (eforward.registrar-servers.com)
        : dns.mx[0].exchange.includes('registrar-servers') ? 'Namecheap'
        : dns.mx[0].exchange.split('.').slice(-2, -1)[0] || 'Custom')
      : 'None';
    const nsProvider = dns.ns?.[0]
      ? (dns.ns[0].includes('cloudflare') ? 'Cloudflare'
        : dns.ns[0].includes('awsdns') ? 'AWS Route 53'
        : dns.ns[0].includes('google') ? 'Google Cloud DNS'
        : dns.ns[0].includes('azure') ? 'Azure DNS'
        // Hostinger's DNS parking service — live sites using Hostinger nameservers
        : dns.ns[0].includes('dns-parking') ? 'Hostinger DNS'
        // Namecheap's registrar nameservers
        : dns.ns[0].includes('registrar-servers') ? 'Namecheap DNS'
        : dns.ns[0].split('.').slice(-2, -1)[0] || 'Custom')
      : 'Unknown';
    addCard('card-dns', 'site_intel', `
      <div class="font-semibold text-sm mb-3">🌐 DNS & Network</div>
      <div class="grid grid-cols-2 gap-2 text-xs">
        <div class="bg-slate-50 rounded-lg p-2.5">
          <div class="text-slate-400 mb-0.5">IP Address</div>
          <div class="font-medium text-slate-800 font-mono">${esc(dns.a?.[0] || siteIntelData.ip || '—')}</div>
        </div>
        <div class="bg-slate-50 rounded-lg p-2.5">
          <div class="text-slate-400 mb-0.5">IPv6</div>
          <div class="font-medium ${dns.has_ipv6 ? 'text-green-700' : 'text-slate-400'}">${dns.has_ipv6 ? '✓ Enabled' : '✗ Not detected'}</div>
        </div>
        <div class="bg-slate-50 rounded-lg p-2.5">
          <div class="text-slate-400 mb-0.5">Name servers</div>
          <div class="font-medium text-slate-800">${esc(nsProvider)}</div>
        </div>
        <div class="bg-slate-50 rounded-lg p-2.5">
          <div class="text-slate-400 mb-0.5">Email provider</div>
          <div class="font-medium text-slate-800">${esc(mxProvider)}</div>
        </div>
      </div>
    `);
  }

  // ── Font Performance ──────────────────────────────────────────────────────
  if (siteIntelData?.fonts) {
    const fonts = siteIntelData.fonts;
    const allFonts = [
      ...(fonts.google_fonts ?? []).map(f => ({ name: f, source: 'Google Fonts', color: 'blue' })),
      ...(fonts.bunny_fonts ?? []).map(f => ({ name: f, source: 'Bunny Fonts', color: 'purple' })),
      ...(fonts.custom_fonts ?? []).map(f => ({ name: f, source: 'Custom', color: 'slate' })),
      ...(fonts.adobe_fonts ? [{ name: 'Adobe Fonts', source: 'Adobe', color: 'red' }] : []),
    ];
    const perfNote = (fonts.google_fonts ?? []).length > 0
      ? '<div class="text-xs text-amber-600 mt-2">⚠ Google Fonts add external DNS lookups — consider self-hosting or <a href="https://bunny.net/fonts" target="_blank" class="underline">Bunny Fonts</a> for privacy & speed.</div>'
      : fonts.system_only
      ? '<div class="text-xs text-green-700 mt-2">✓ System fonts only — zero external font requests, fastest possible load</div>'
      : '';
    addCard('card-fonts', 'seo', `
      <div class="flex items-center justify-between mb-3">
        <div class="font-semibold text-sm">🔤 Font Performance</div>
        <span class="text-xs text-slate-400">${fonts.total_font_requests} font request${fonts.total_font_requests !== 1 ? 's' : ''}</span>
      </div>
      ${allFonts.length ? `<div class="flex flex-wrap gap-1.5 mb-2">${allFonts.map(f =>
        `<span class="inline-flex flex-col px-2 py-1 rounded-lg bg-${f.color}-50 border border-${f.color}-200 text-[10px]">
          <span class="font-medium text-${f.color}-800">${esc(f.name)}</span>
          <span class="text-${f.color}-500">${f.source}</span>
        </span>`).join('')}</div>`
      : '<div class="text-xs text-slate-400 mb-2">No web fonts detected</div>'}
      ${perfNote}
    `);
  }

  // ── Robots.txt Detail ─────────────────────────────────────────────────────
  const robotsSummary = techData?.robots_summary;
  if (robotsSummary?.user_agent_count > 0 || robotsSummary?.preview) {
    addCard('card-robots', 'seo', `
      <div class="flex items-center justify-between mb-3">
        <div class="font-semibold text-sm">🤖 Robots.txt</div>
        <div class="flex gap-3 text-[10px] text-slate-500">
          <span>${robotsSummary.user_agent_count} user-agent${robotsSummary.user_agent_count !== 1 ? 's' : ''}</span>
          <span>${robotsSummary.disallow_count} disallow rule${robotsSummary.disallow_count !== 1 ? 's' : ''}</span>
          ${robotsSummary.has_sitemap_ref ? '<span class="text-green-600">✓ Sitemap referenced</span>' : '<span class="text-amber-600">⚠ No sitemap ref</span>'}
        </div>
      </div>
      ${robotsSummary.preview ? `<pre class="text-[10px] bg-slate-900 text-green-300 p-3 rounded-lg overflow-x-auto leading-relaxed whitespace-pre-wrap" style="max-height:200px">${esc(robotsSummary.preview)}</pre>` : '<div class="text-xs text-orange-500">robots.txt not found or empty</div>'}
    `);
  }

  // ── llms.txt Generator ───────────────────────────────────────────────────
  const vertical = geoData?.vertical || kwData?.vertical || 'business';
  const keywords = (kwData?.keywords ?? []).slice(0, 12).map(k => k.keyword);
  const schemas = schemaData?.schemas_found ?? [];
  const llmsView = REPORT_UI?.llmsTxtView?.(techData, reportLanguage) ?? {
    state: techData?.llms_txt_status === 'error' ? 'unknown' : techData?.llms_txt_present ? 'present' : 'missing',
    generatorMessage: techData?.llms_txt_status === 'error'
      ? '⚠ Could not verify whether llms.txt exists. Retry the audit or check the file before replacing it.'
      : techData?.llms_txt_present ? '✓ llms.txt already exists on your site' : '⚠ No llms.txt found — generate a draft below',
    generateLabel: techData?.llms_txt_status === 'error' ? 'Generate draft' : techData?.llms_txt_present ? 'Re-generate' : 'Generate llms.txt draft',
    canViewExisting: techData?.llms_txt_present === true,
  };
  addCard('card-llms-gen', 'previews', `
    <div class="font-semibold text-sm mb-2">📄 llms.txt Auto-Generator
      <span class="text-xs text-slate-400 font-normal ml-2">AI-written for ${esc(data.domain)}</span>
    </div>
    <div class="text-xs text-slate-500 mb-3">
      llms.txt is an optional content index for automated readers; it does not guarantee citations or rankings.
      <span class="${llmsView.state === 'present' ? 'text-green-600' : llmsView.state === 'missing' ? 'text-amber-600' : 'text-slate-500'} font-medium">${esc(llmsView.generatorMessage)}</span>
    </div>
    <div id="llms-gen-output" class="hidden mb-3 border border-slate-200 rounded-lg bg-slate-900 p-3">
      <pre id="llms-gen-text" class="text-xs text-green-300 whitespace-pre-wrap leading-relaxed overflow-x-auto" style="max-height:300px"></pre>
    </div>
    <div class="flex gap-2 flex-wrap">
      ${llmsView.canViewExisting
        ? `<button id="llms-view-btn" class="text-xs bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium" data-domain="${esc(data.domain)}">👁 View existing</button>
           <button id="llms-gen-btn" class="text-xs border border-slate-200 px-3 py-2 rounded-lg hover:bg-slate-50 transition-colors text-slate-600"
             data-domain="${esc(data.domain)}" data-vertical="${esc(vertical)}"
             data-keywords="${esc(keywords.join(','))}" data-schemas="${esc(schemas.join(','))}">↻ ${esc(llmsView.generateLabel)}</button>`
        : `<button id="llms-gen-btn" class="text-xs bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium"
             data-domain="${esc(data.domain)}" data-vertical="${esc(vertical)}"
             data-keywords="${esc(keywords.join(','))}" data-schemas="${esc(schemas.join(','))}">✨ ${esc(llmsView.generateLabel)}</button>`
      }
      <button id="llms-copy-btn" class="hidden text-xs border border-slate-200 px-3 py-2 rounded-lg hover:bg-slate-50 transition-colors">Copy</button>
    </div>
  `);

  // ── Schema JSON-LD Generator ──────────────────────────────────────────────
  {
    const schemaTypes = ['LocalBusiness','Restaurant','MedicalBusiness','LegalService','HomeAndConstructionBusiness','FinancialService','Store','SoftwareApplication','WebSite','Organization','NewsArticle','BlogPosting'];
    const opts = schemaTypes.map(t => `<option value="${t}"${t === 'LocalBusiness' ? ' selected' : ''}>${t}</option>`).join('');
    addCard('card-schema-gen', 'previews', `
      <div class="font-semibold text-sm mb-2">🔬 JSON-LD Schema Generator
        <span class="text-xs text-slate-400 font-normal ml-2">AI-written structured data</span>
      </div>
      <div class="text-xs text-slate-500 mb-3">Generate ready-to-paste JSON-LD markup — paste it inside a <code>&lt;script type="application/ld+json"&gt;</code> tag.</div>
      <div class="flex gap-2 mb-3 flex-wrap">
        <select id="schema-type-select" class="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700">${opts}</select>
        <button id="schema-gen-btn"
          data-domain="${esc(data.domain)}"
          data-name="${esc(businessName)}"
          data-city="${esc(data.city || '')}"
          data-country="${esc(data.country || '')}"
          class="text-xs bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium">✨ Generate schema</button>
      </div>
      <div id="schema-gen-output" class="hidden border border-slate-200 rounded-lg bg-slate-900 p-3">
        <pre id="schema-gen-text" class="text-xs text-green-300 whitespace-pre-wrap leading-relaxed overflow-x-auto" style="max-height:320px"></pre>
      </div>
      <button id="schema-copy-btn" class="hidden mt-2 text-xs border border-slate-200 px-3 py-2 rounded-lg hover:bg-slate-50 transition-colors">Copy</button>
    `);
  }

  // ── AI Entity Visibility Probe ────────────────────────────────────────────
  {
    addCard('card-geo-probe', 'geo', `
      <div class="flex items-center justify-between mb-2">
        <div class="font-semibold text-sm">🔭 AI Entity Visibility
          <span class="text-xs text-slate-400 font-normal ml-2">Free · powered by Wikipedia/DuckDuckGo</span>
        </div>
        <button id="geo-probe-btn"
          data-domain="${esc(data.domain)}"
          data-name="${esc(businessName)}"
          class="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors font-medium shrink-0">Check visibility</button>
      </div>
      <div class="text-xs text-slate-500 mb-3">Checks public entity references and structured knowledge signals. Wikipedia/Wikidata presence is treated as supporting evidence, not proof of AI training or citation.</div>
      <div id="geo-probe-output" class="hidden rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div id="geo-probe-result"></div>
      </div>
    `);
  }

  // ── AI Content Insights ───────────────────────────────────────────────────
  // renderSection() has no specific handler for ai_content_insights, so it creates a title-only
  // stub (module-ai_content_insights). Replace it with the rich computed cards below.
  const aiStub = document.getElementById('module-ai_content_insights');
  if (aiStub) aiStub.remove();

  const aiData = data.modules?.ai_content_insights?.data;
  if (aiData && !evidenceContract) {
    const aiScore = aiData.ai_visibility_score ?? 0;
    const aiScoreColor = aiScore >= 70 ? 'green' : aiScore >= 40 ? 'amber' : 'red';
    const trustAvg = Math.round(((aiData.trust_scores?.topical_relevance ?? 0) + (aiData.trust_scores?.subject_expertise ?? 0) + (aiData.trust_scores?.credibility ?? 0)) / 3);

    addCard('card-ai-business', 'ai', `
      <div class="flex items-start justify-between mb-3">
        <div>
          <div class="font-semibold text-sm">🧠 AI Content Insights</div>
          <div class="text-xs text-slate-400 mt-0.5">${esc(aiData.business_context?.industry_niche || 'General')}</div>
        </div>
        <div class="flex flex-col items-center">
          <div class="text-2xl font-bold text-${aiScoreColor}-600">${aiScore}</div>
          <div class="text-[9px] text-slate-400 uppercase tracking-wide">AI Visibility</div>
        </div>
      </div>
      <div class="bg-slate-50 rounded-lg p-3 mb-3">
        <div class="text-xs font-medium text-slate-600 mb-1">Business Description</div>
        <div class="text-xs text-slate-700 leading-relaxed">${esc(aiData.business_context?.description || '—')}</div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div class="bg-slate-50 rounded-lg p-2.5">
          <div class="text-[10px] text-slate-500 mb-1">Target Audience</div>
          <div class="text-xs font-medium text-slate-700">${esc(aiData.business_context?.target_audience || '—')}</div>
        </div>
        <div class="bg-slate-50 rounded-lg p-2.5">
          <div class="text-[10px] text-slate-500 mb-1">Content Summary</div>
          <div class="text-xs text-slate-700 leading-relaxed">${esc((aiData.content_analysis?.summary || '—').slice(0, 120))}</div>
        </div>
      </div>
    `);

    const strengths = aiData.content_analysis?.strengths ?? [];
    const weaknesses = aiData.content_analysis?.weaknesses ?? [];
    addCard('card-ai-content', 'ai', `
      <div class="font-semibold text-sm mb-3">📊 Content Analysis</div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <div class="text-xs font-medium text-green-700 mb-2 flex items-center gap-1"><span>✓</span> Strengths</div>
          ${strengths.length ? `<ul class="space-y-1.5">${strengths.map(s => `<li class="text-xs text-slate-600 flex gap-1.5"><span class="text-green-500 shrink-0 mt-0.5">●</span>${esc(s)}</li>`).join('')}</ul>` : '<div class="text-xs text-slate-400">None identified</div>'}
        </div>
        <div>
          <div class="text-xs font-medium text-orange-700 mb-2 flex items-center gap-1"><span>✗</span> Weaknesses</div>
          ${weaknesses.length ? `<ul class="space-y-1.5">${weaknesses.map(w => `<li class="text-xs text-slate-600 flex gap-1.5"><span class="text-orange-400 shrink-0 mt-0.5">●</span>${esc(w)}</li>`).join('')}</ul>` : '<div class="text-xs text-slate-400">None identified</div>'}
        </div>
      </div>
    `);

    const ts = aiData.trust_scores ?? {};
    addCard('card-ai-trust', 'ai', `
      <div class="font-semibold text-sm mb-3">🏆 Trust & Authority Scores</div>
      <div class="space-y-2.5 mb-3">
        ${[['Topical Relevance', ts.topical_relevance ?? 0], ['Subject Expertise', ts.subject_expertise ?? 0], ['Credibility', ts.credibility ?? 0]].map(([label, val]) => {
          const pct = val;
          const col = pct >= 70 ? 'green' : pct >= 40 ? 'amber' : 'red';
          return `<div>
            <div class="flex justify-between text-xs mb-1"><span class="text-slate-600">${label}</span><span class="font-medium text-${col}-600">${pct}/100</span></div>
            <div class="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div class="h-full bg-${col}-500 rounded-full" style="width:${pct}%"></div></div>
          </div>`;
        }).join('')}
      </div>
      <div class="text-xs text-slate-500 italic leading-relaxed">${esc(ts.summary || '')}</div>
    `);

    const fr = aiData.freshness ?? {};
    const frColor = (fr.score ?? 0) >= 70 ? 'green' : (fr.score ?? 0) >= 40 ? 'amber' : 'red';
    addCard('card-ai-freshness', 'ai', `
      <div class="flex items-center justify-between mb-3">
        <div class="font-semibold text-sm">🕐 Content Freshness</div>
        <span class="text-lg font-bold text-${frColor}-600">${fr.score ?? 0}/100</span>
      </div>
      <div class="h-2 bg-slate-100 rounded-full overflow-hidden mb-3">
        <div class="h-full bg-${frColor}-500 rounded-full" style="width:${fr.score ?? 0}%"></div>
      </div>
      ${(fr.signals ?? []).length ? `<div class="flex flex-wrap gap-1.5 mb-2">${(fr.signals).map(s => `<span class="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">${esc(s)}</span>`).join('')}</div>` : ''}
      <div class="text-xs text-slate-500 italic">${esc(fr.summary || '')}</div>
    `);

    const opp = aiData.opportunities ?? {};
    const wins = opp.quick_wins ?? [];
    addCard('card-ai-opportunities', 'ai', `
      <div class="font-semibold text-sm mb-2">💡 AI Opportunities</div>
      <div class="text-xs text-slate-600 leading-relaxed mb-3">${esc(opp.summary || '')}</div>
      ${wins.length ? `
        <div class="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">Quick Wins</div>
        <ul class="space-y-2">${wins.map((w, i) => `
          <li class="flex items-start gap-2 text-xs text-slate-700">
            <span class="shrink-0 w-4 h-4 rounded-full bg-blue-100 text-blue-700 text-[9px] font-bold flex items-center justify-center">${i + 1}</span>
            ${esc(w)}
          </li>`).join('')}
        </ul>` : ''}
    `);
  }

  // ── Heading Tags ──────────────────────────────────────────────────────────
  const h1Tags = techData?.h1_tags ?? [];
  const h2Tags = techData?.h2_tags ?? [];
  if (h1Tags.length > 0 || h2Tags.length > 0) {
    addCard('card-headings', 'seo', `
      <div class="font-semibold text-sm mb-3">📝 Heading Tags</div>
      <div class="space-y-3">
        <div>
          <div class="flex items-center gap-2 mb-1.5">
            <span class="text-xs font-bold bg-blue-600 text-white px-2 py-0.5 rounded">H1</span>
            <span class="text-xs text-slate-400">${h1Tags.length} tag${h1Tags.length !== 1 ? 's' : ''} ${h1Tags.length === 1 ? '✓' : h1Tags.length === 0 ? '⚠ Missing' : '⚠ Multiple'}</span>
          </div>
          <div class="space-y-1">${h1Tags.slice(0, 3).map(h => `<div class="text-xs bg-blue-50 border border-blue-100 text-blue-800 px-3 py-1.5 rounded-lg leading-snug">${esc(h)}</div>`).join('') || '<div class="text-xs text-slate-400">No H1 found</div>'}</div>
        </div>
        <div>
          <div class="flex items-center gap-2 mb-1.5">
            <span class="text-xs font-bold bg-slate-600 text-white px-2 py-0.5 rounded">H2</span>
            <span class="text-xs text-slate-400">${h2Tags.length} tag${h2Tags.length !== 1 ? 's' : ''}</span>
          </div>
          <div class="space-y-1">${h2Tags.slice(0, 5).map(h => `<div class="text-xs bg-slate-50 border border-slate-100 text-slate-700 px-3 py-1.5 rounded-lg leading-snug">${esc(h)}</div>`).join('') || '<div class="text-xs text-slate-400">No H2 found</div>'}
          ${h2Tags.length > 5 ? `<div class="text-xs text-slate-400">+${h2Tags.length - 5} more H2 tags</div>` : ''}</div>
        </div>
      </div>
    `);
  }

  // ── Image Alt Audit ───────────────────────────────────────────────────────
  const imgAudit = techData?.image_audit;
  if (imgAudit && imgAudit.total > 0) {
    const missingList = imgAudit.missing_alt_srcs ?? [];
    const altOk = imgAudit.missing_alt === 0;
    addCard('card-image-alt', 'seo', `
      <div class="flex items-center justify-between mb-3">
        <div class="font-semibold text-sm">🖼 Image Optimization</div>
        <span class="text-xs px-2 py-0.5 rounded-full ${altOk ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'} font-medium">
          ${imgAudit.total - imgAudit.missing_alt}/${imgAudit.total} have alt text
        </span>
      </div>
      <div class="grid grid-cols-3 gap-3 mb-3">
        <div class="bg-slate-50 rounded-lg p-2.5 text-center">
          <div class="text-lg font-bold text-slate-700">${imgAudit.total}</div>
          <div class="text-[10px] text-slate-400">Total Images</div>
        </div>
        <div class="bg-${imgAudit.missing_alt === 0 ? 'green' : 'red'}-50 rounded-lg p-2.5 text-center">
          <div class="text-lg font-bold text-${imgAudit.missing_alt === 0 ? 'green' : 'red'}-600">${imgAudit.missing_alt}</div>
          <div class="text-[10px] text-slate-400">Missing Alt</div>
        </div>
        <div class="bg-blue-50 rounded-lg p-2.5 text-center">
          <div class="text-lg font-bold text-blue-600">${imgAudit.modern_count}</div>
          <div class="text-[10px] text-slate-400">Modern (WebP/AVIF)</div>
        </div>
      </div>
      ${missingList.length ? `
        <div class="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">Images missing alt text</div>
        <div class="space-y-1 max-h-28 overflow-y-auto">${missingList.slice(0, 10).map(src => `
          <div class="text-[10px] bg-orange-50 text-orange-700 px-2 py-1 rounded truncate">${esc(src)}</div>`).join('')}
          ${missingList.length > 10 ? `<div class="text-[10px] text-slate-400">+${missingList.length - 10} more</div>` : ''}
        </div>` : ''}
    `);
  }

  // ── Speed Optimizations ───────────────────────────────────────────────────
  const comp = techData?.compression;
  const domCount = techData?.dom_element_count;
  const pageKb = techData?.page_weight_kb;
  if (comp !== undefined || domCount !== undefined) {
    const compOk = comp?.enabled;
    const domOk = domCount == null || domCount <= 1500;
    const sizeOk = pageKb == null || pageKb <= 150;
    const speedPassed = [compOk, domOk, sizeOk].filter(Boolean).length;
    addCard('card-speed', 'seo', `
      <div class="flex items-center justify-between mb-3">
        <div class="font-semibold text-sm">⚡ Speed Optimizations</div>
        <span class="text-xs text-slate-400">${speedPassed}/3 passed</span>
      </div>
      <div class="space-y-2">
        <div class="flex items-center justify-between p-2.5 rounded-lg ${compOk ? 'bg-green-50' : 'bg-orange-50'}">
          <div>
            <div class="text-xs font-medium ${compOk ? 'text-green-800' : 'text-orange-800'}">HTML Compression</div>
            <div class="text-[10px] ${compOk ? 'text-green-600' : 'text-orange-500'} mt-0.5">
              ${comp?.enabled ? `${comp.encoding} — ${comp.savings_pct != null ? comp.savings_pct + '% savings' : 'enabled'}` : 'Not enabled — add GZIP or Brotli'}
            </div>
          </div>
          <span class="text-base">${compOk ? '✓' : '✗'}</span>
        </div>
        <div class="flex items-center justify-between p-2.5 rounded-lg ${domOk ? 'bg-green-50' : 'bg-amber-50'}">
          <div>
            <div class="text-xs font-medium ${domOk ? 'text-green-800' : 'text-amber-800'}">DOM Size</div>
            <div class="text-[10px] ${domOk ? 'text-green-600' : 'text-amber-600'} mt-0.5">${(domCount ?? 0).toLocaleString()} elements (target ≤ 1,500)</div>
          </div>
          <span class="text-base">${domOk ? '✓' : '⚠'}</span>
        </div>
        <div class="flex items-center justify-between p-2.5 rounded-lg ${sizeOk ? 'bg-green-50' : 'bg-amber-50'}">
          <div>
            <div class="text-xs font-medium ${sizeOk ? 'text-green-800' : 'text-amber-800'}">Page Weight</div>
            <div class="text-[10px] ${sizeOk ? 'text-green-600' : 'text-amber-600'} mt-0.5">${pageKb ?? 0} KB ${sizeOk ? '— within budget' : '— consider lazy-loading & code-splitting'}</div>
          </div>
          <span class="text-base">${sizeOk ? '✓' : '⚠'}</span>
        </div>
      </div>
    `);
  }

  // ── Mobile Usability ──────────────────────────────────────────────────────
  const hasViewport = techData?.checks?.find(c => c.name === 'Mobile viewport meta')?.passed;
  const hasMQ = techData?.has_media_queries;
  if (hasViewport !== undefined || hasMQ !== undefined) {
    const viewportContent = mods.mobile_audit?.data?.viewport_content ?? (hasViewport ? 'width=device-width, initial-scale=1' : null);
    addCard('card-mobile', 'seo', `
      <div class="font-semibold text-sm mb-3">📱 Mobile Usability</div>
      <div class="space-y-2">
        <div class="flex items-center justify-between p-2.5 rounded-lg ${hasViewport ? 'bg-green-50' : 'bg-orange-50'}">
          <div>
            <div class="text-xs font-medium ${hasViewport ? 'text-green-800' : 'text-orange-800'}">Viewport Meta Tag</div>
            <div class="text-[10px] ${hasViewport ? 'text-green-600' : 'text-orange-500'} mt-0.5 font-mono">${hasViewport ? 'width=device-width, initial-scale=1' : 'Not set — mobile browsers will zoom out'}</div>
          </div>
          <span class="text-base">${hasViewport ? '✓' : '✗'}</span>
        </div>
        <div class="flex items-center justify-between p-2.5 rounded-lg ${hasMQ ? 'bg-green-50' : 'bg-amber-50'}">
          <div>
            <div class="text-xs font-medium ${hasMQ ? 'text-green-800' : 'text-amber-800'}">Responsive CSS (Media Queries)</div>
            <div class="text-[10px] ${hasMQ ? 'text-green-600' : 'text-amber-600'} mt-0.5">${hasMQ ? 'CSS media queries detected — layout adapts to screen size' : 'No media queries found — layout may not adapt to mobile'}</div>
          </div>
          <span class="text-base">${hasMQ ? '✓' : '⚠'}</span>
        </div>
        ${(techData?.deprecated_tags ?? []).length > 0 ? `
        <div class="p-2.5 rounded-lg bg-amber-50">
          <div class="text-xs font-medium text-amber-800 mb-0.5">Deprecated HTML Tags</div>
          <div class="text-[10px] text-amber-600">Found: &lt;${(techData.deprecated_tags).join('&gt;, &lt;')}&gt; — these affect rendering consistency</div>
        </div>` : ''}
        ${techData?.unsafe_cross_origin_links > 0 ? `
        <div class="p-2.5 rounded-lg bg-amber-50">
          <div class="text-xs font-medium text-amber-800 mb-0.5">Unsafe Cross-Origin Links</div>
          <div class="text-[10px] text-amber-600">${techData.unsafe_cross_origin_links} link${techData.unsafe_cross_origin_links > 1 ? 's' : ''} with target="_blank" missing rel="noopener noreferrer"</div>
        </div>` : ''}
      </div>
    `);
  }

  // ── Email & Ads.txt ───────────────────────────────────────────────────────
  const hasAdsTxt = techData?.ads_txt;
  // SPF now read from off_page_seo (which already does a DNS TXT lookup for MX/DKIM/DMARC)
  // rather than technical_seo's standalone DNS fetch — one fewer subrequest per audit.
  const spfRecord = offPageData?.email_security?.spf_record; // string | null | undefined
  const plaintextEmails = techData?.plaintext_emails ?? 0;
  if (hasAdsTxt !== undefined || spfRecord !== undefined || plaintextEmails > 0) {
    addCard('card-email-ads', 'seo', `
      <div class="font-semibold text-sm mb-3">📧 Email & Ads Security</div>
      <div class="space-y-2">
        <div class="flex items-center justify-between p-2.5 rounded-lg ${spfRecord ? 'bg-green-50' : 'bg-orange-50'}">
          <div>
            <div class="text-xs font-medium ${spfRecord ? 'text-green-800' : 'text-orange-800'}">SPF Email Record</div>
            <div class="text-[10px] ${spfRecord ? 'text-green-600 font-mono' : 'text-orange-500'} mt-0.5 truncate max-w-[220px]">${spfRecord ? esc(spfRecord) : 'Missing — emails can be spoofed from your domain'}</div>
          </div>
          <span class="text-base">${spfRecord ? '✓' : '✗'}</span>
        </div>
        <div class="flex items-center justify-between p-2.5 rounded-lg ${hasAdsTxt ? 'bg-green-50' : 'bg-slate-50'}">
          <div>
            <div class="text-xs font-medium ${hasAdsTxt ? 'text-green-800' : 'text-slate-600'}">Ads.txt File</div>
            <div class="text-[10px] ${hasAdsTxt ? 'text-green-600' : 'text-slate-400'} mt-0.5">${hasAdsTxt ? 'Present — authorized digital sellers declared' : 'Not found — only relevant for ad-supported sites'}</div>
          </div>
          <span class="text-base">${hasAdsTxt ? '✓' : '—'}</span>
        </div>
        ${plaintextEmails > 0 ? `
        <div class="p-2.5 rounded-lg bg-amber-50">
          <div class="text-xs font-medium text-amber-800 mb-0.5">Plaintext Email Links</div>
          <div class="text-[10px] text-amber-600">${plaintextEmails} mailto: link${plaintextEmails > 1 ? 's' : ''} — email addresses visible to scrapers and spam bots</div>
        </div>` : ''}
      </div>
    `);
  }

  // ── International SEO ─────────────────────────────────────────────────────
  if (techData) {
    const langVal = techData.page_meta?.lang ?? null;
    const hreflangPassed = techData.checks?.find(c => c.name === 'hreflang for multilingual')?.passed ?? false;
    const siHosting = mods.site_intel?.data?.hosting;

    // ccTLD → country map (most common ones globally)
    const ccTldMap = {
      uk: 'United Kingdom', de: 'Germany', fr: 'France', es: 'Spain', it: 'Italy',
      nl: 'Netherlands', au: 'Australia', ca: 'Canada', jp: 'Japan', kr: 'South Korea',
      cn: 'China', ru: 'Russia', br: 'Brazil', mx: 'Mexico', ar: 'Argentina',
      in: 'India', sg: 'Singapore', ae: 'United Arab Emirates', za: 'South Africa',
      nz: 'New Zealand', ie: 'Ireland', se: 'Sweden', no: 'Norway', dk: 'Denmark',
      fi: 'Finland', pl: 'Poland', pt: 'Portugal', be: 'Belgium', ch: 'Switzerland',
      at: 'Austria', gr: 'Greece', tr: 'Turkey', id: 'Indonesia', th: 'Thailand',
      my: 'Malaysia', ph: 'Philippines', vn: 'Vietnam', ng: 'Nigeria', ke: 'Kenya',
      eg: 'Egypt', sa: 'Saudi Arabia', pk: 'Pakistan', bd: 'Bangladesh',
    };
    // Also handle co.uk, com.au, org.uk, etc.
    const parts = data.domain.split('.');
    const tld = parts[parts.length - 1];
    const sld = parts[parts.length - 2];
    const isCcTld = tld in ccTldMap;
    const isPseudoCcTld = (sld === 'co' || sld === 'com' || sld === 'org' || sld === 'net') && tld in ccTldMap;
    const ccCountry = isCcTld ? ccTldMap[tld] : (isPseudoCcTld ? ccTldMap[tld] : null);

    // BCP-47 lang → readable name (common subset)
    const langNames = {
      'en': 'English', 'en-gb': 'English (UK)', 'en-us': 'English (US)', 'en-au': 'English (AU)',
      'de': 'German', 'de-de': 'German (Germany)', 'de-at': 'German (Austria)', 'de-ch': 'German (Switzerland)',
      'fr': 'French', 'fr-fr': 'French (France)', 'fr-be': 'French (Belgium)', 'fr-ch': 'French (Switzerland)',
      'es': 'Spanish', 'es-es': 'Spanish (Spain)', 'es-mx': 'Spanish (Mexico)', 'es-ar': 'Spanish (Argentina)',
      'it': 'Italian', 'nl': 'Dutch', 'pt': 'Portuguese', 'pt-br': 'Portuguese (Brazil)',
      'pt-pt': 'Portuguese (Portugal)', 'ru': 'Russian', 'zh': 'Chinese', 'zh-cn': 'Chinese (Simplified)',
      'zh-tw': 'Chinese (Traditional)', 'ja': 'Japanese', 'ko': 'Korean', 'ar': 'Arabic',
      'hi': 'Hindi', 'tr': 'Turkish', 'pl': 'Polish', 'sv': 'Swedish', 'da': 'Danish',
      'fi': 'Finnish', 'no': 'Norwegian', 'el': 'Greek', 'cs': 'Czech', 'ro': 'Romanian',
      'hu': 'Hungarian', 'bg': 'Bulgarian', 'hr': 'Croatian', 'sk': 'Slovak', 'sl': 'Slovenian',
      'uk': 'Ukrainian', 'id': 'Indonesian', 'ms': 'Malay', 'th': 'Thai', 'vi': 'Vietnamese',
    };
    const langName = langVal ? (langNames[langVal.toLowerCase()] ?? langVal) : null;

    const row = (icon, label, value, cls = '') =>
      `<div class="flex items-center gap-2 py-1.5 border-b border-slate-50 last:border-0">
        <span class="text-base w-5 text-center">${icon}</span>
        <span class="text-xs text-slate-500 w-36 shrink-0">${label}</span>
        <span class="text-xs font-medium ${cls || 'text-slate-800'}">${value}</span>
      </div>`;

    const geoLoc = geoData?.location;

    addCard('card-international-seo', 'seo', `
      <div class="font-semibold text-sm mb-3">🌍 International SEO</div>
      <div class="divide-y divide-slate-50">
        ${row(langName ? '✓' : '⚠', 'HTML lang attribute',
          langVal ? `<code class="bg-slate-100 px-1.5 py-0.5 rounded font-mono text-[11px]">${esc(langVal)}</code> — ${esc(langName ?? langVal)}` : '<span class="text-amber-600">Not set — add lang to &lt;html&gt;</span>')}
        ${row(hreflangPassed ? '✓' : '—', 'hreflang tags',
          hreflangPassed
            ? '<span class="text-green-700">Present — multilingual/regional targeting active</span>'
            : '<span class="text-slate-400">Not detected — add only if serving multiple languages/regions</span>')}
        ${ccCountry ? row('🏳', 'Country-code TLD', `<span class="text-blue-700">.${esc(tld)} → ${esc(ccCountry)}</span>`) : ''}
        ${siHosting?.country ? row('🖥', 'Server location',
          `${esc([siHosting.city, siHosting.country].filter(Boolean).join(', '))}`) : ''}
        ${geoLoc && geoLoc !== 'your area' ? row('📍', 'Detected audience',
          `<span class="text-purple-700">${esc(geoLoc)}</span>`) : ''}
      </div>
      ${!hreflangPassed && (isCcTld || isPseudoCcTld) ? `
        <div class="mt-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          ⚠ Country-code TLD detected but no hreflang found. If you serve multiple regions or languages,
          add <code class="bg-amber-100 px-1 rounded font-mono">rel="alternate" hreflang="..."</code> tags to signal each region to Google.
        </div>` : ''}
      ${hreflangPassed ? `
        <div class="mt-3 p-2.5 bg-green-50 border border-green-200 rounded-lg text-xs text-green-800">
          ✓ hreflang detected — ensure each page has a reciprocal tag and includes <code class="bg-green-100 px-1 rounded font-mono">x-default</code> for language-neutral URLs.
        </div>` : ''}
    `);
  }

  // ── Keyword Research ──────────────────────────────────────────────────────
  // Skip if AI was unavailable — template-generated keywords are too generic to be useful.
  if (kwData?.keywords?.length && kwData.is_reliable !== false) {
    // Filter autocomplete noise: company-name suffixes (ltd, inc, corp, etc.) slip through
    const _SUFFIX_RE = /\b(ltd|inc|corp|plc|llc|gmbh|ag|bv|pty|s\.a\.|co\.)\.?\s*$/i;
    const kws = kwData.keywords.filter(k => !_SUFFIX_RE.test(k.keyword)).slice(0, 25);
    if (!kws.length) return; // nothing valid to show
    const intentMeta = {
      transactional: { label: 'Transactional', cls: 'bg-orange-100 text-orange-700 border-orange-200' },
      commercial:    { label: 'Commercial',    cls: 'bg-blue-100 text-blue-700 border-blue-200' },
      informational: { label: 'Informational', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
      local:         { label: 'Local',         cls: 'bg-green-100 text-green-700 border-green-200' },
    };
    const seeds = kwData.seed_queries ?? [];
    // Only show GEO column if at least one keyword has geo_potential
    const hasGeo = kws.some(k => k.geo_potential);

    addCard('card-keyword-research', 'geo', `
      <div class="flex items-start justify-between mb-3">
        <div>
          <div class="font-semibold text-sm">🔑 Keyword Opportunities</div>
          <div class="text-xs text-slate-400 mt-0.5">
            Vertical: <span class="font-medium text-slate-600">${esc(kwData.vertical || 'general')}</span>
            ${kwData.location && kwData.location !== 'your area' ? ` · Location: <span class="font-medium text-slate-600">${esc(kwData.location)}</span>` : ''}
          </div>
        </div>
        ${hasGeo ? `<div class="flex items-center gap-2 text-[10px] text-slate-400">
          <span class="text-purple-600 font-medium">✦ = AI search potential</span>
        </div>` : ''}
      </div>
      ${seeds.length ? `
        <div class="mb-3">
          <div class="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Seed queries</div>
          <div class="flex flex-wrap gap-1.5">${seeds.map(s => `<span class="text-[10px] font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded">${esc(s)}</span>`).join('')}</div>
        </div>` : ''}
      <div class="border border-slate-100 rounded-lg overflow-hidden">
        <div class="grid ${hasGeo ? 'grid-cols-[1fr_auto_auto]' : 'grid-cols-[1fr_auto]'} text-[10px] font-semibold text-slate-400 uppercase tracking-wide bg-slate-50 px-3 py-2 border-b border-slate-100">
          <span>Keyword</span><span class="text-center w-24">Intent</span>${hasGeo ? '<span class="text-center w-10">GEO</span>' : ''}
        </div>
        <div class="divide-y divide-slate-50">
          ${kws.map(k => {
            const m = intentMeta[k.intent] ?? intentMeta.commercial;
            return `<div class="grid ${hasGeo ? 'grid-cols-[1fr_auto_auto]' : 'grid-cols-[1fr_auto]'} items-center px-3 py-2 hover:bg-slate-50 transition-colors">
              <span class="text-xs text-slate-800 truncate pr-2">${esc(k.keyword)}</span>
              <span class="text-[10px] font-medium border rounded-full px-2 py-0.5 w-24 text-center ${m.cls}">${m.label}</span>
              ${hasGeo ? `<span class="text-center w-10 text-[13px]">${k.geo_potential ? '<span class="text-purple-600" title="Likely to appear in AI-generated answers">✦</span>' : '<span class="text-slate-200">—</span>'}</span>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>
      ${hasGeo ? '<div class="mt-2 text-[10px] text-slate-400">✦ = predicted topic opportunity from the available page signals</div>' : ''}
    `);
  }

  // ── Keywords Cloud ────────────────────────────────────────────────────────
  const topKw = techData?.top_keywords ?? [];
  if (topKw.length >= 5) {
    const maxCount = topKw[0]?.count || 1;
    // Sort alphabetically so large and small words are distributed throughout the cloud
    const cloudWords = [...topKw.slice(0, 50)].sort((a, b) => a.word.localeCompare(b.word));
    addCard('card-keywords-cloud', 'seo', `
      <div class="flex items-center justify-between mb-4">
        <div class="font-semibold text-sm">☁️ Page Keywords Cloud</div>
        <span class="text-xs text-slate-400">${cloudWords.length} words</span>
      </div>
      <div class="flex flex-wrap gap-x-3 gap-y-1.5 leading-loose justify-center">
        ${cloudWords.map(({ word, count }) => {
          const ratio = count / maxCount;
          const size = ratio >= 0.8 ? '2rem' : ratio >= 0.6 ? '1.5rem' : ratio >= 0.4 ? '1.1rem' : ratio >= 0.2 ? '0.875rem' : '0.75rem';
          const weight = ratio >= 0.6 ? '700' : ratio >= 0.3 ? '600' : '400';
          const color = ratio >= 0.6 ? 'text-slate-800' : ratio >= 0.3 ? 'text-blue-700' : 'text-slate-500';
          return `<span title="${count} occurrences" style="font-size:${size};font-weight:${weight}" class="${color} hover:text-blue-500 cursor-default transition-colors">${esc(word)}</span>`;
        }).join('')}
      </div>
    `);
  }

  // ── Key Findings Card ────────────────────────────────────────────────────
  (() => {
    if (evidenceContract) return;
    const aiInsights = mods.ai_content_insights?.data;

    // Business type detection
    const AI_BUILDER_CMS = new Set(['Lovable', 'Bolt', 'v0 (Vercel)', 'Framer', 'Webflow']);
    const hasOrgSchema = schemaData?.coverage?.Organization === true;
    const hasLocalSchema = schemaData?.coverage?.LocalBusiness === true;
    const isSaasCms = AI_BUILDER_CMS.has(techData?.tech_stack?.cms ?? '');
    // Use schemas_found (full list) — coverage only tracks REQUIRED_SCHEMAS keys, not Corporation etc.
    const schemasFound = schemaData?.schemas_found ?? [];
    const hasCorporateSchema = hasOrgSchema ||
      schemasFound.includes('Corporation') ||
      schemasFound.includes('SoftwareApplication') ||
      schemasFound.includes('WebApplication');
    const vert = (geoData?.vertical || kwData?.vertical || '').toLowerCase();
    const localVerts = ['restaurant','retail','healthcare','dental','legal','salon','fitness','hotel','plumber','electrician','contractor','real estate'];
    // Wikipedia presence = established org, nearly never a local business
    const isEstablishedOrg = authData?.wikipedia === true;
    // High link count signals media/portal sites — local businesses rarely exceed 150 internal links.
    // This overrides all other local signals (even localVerts) because city-guide/media sites
    // cover restaurants and hotels but are not local businesses themselves.
    const isHighLinkSite = (contentData?.internal_links ?? 0) >= 150;
    const isLocal = !isHighLinkSite && (hasLocalSchema || (contentData?.has_address && !hasCorporateSchema && !isSaasCms && !isEstablishedOrg) || localVerts.some(v => vert.includes(v)));
    const isSaas = hasCorporateSchema || isSaasCms || isEstablishedOrg || vert.includes('saas') || vert.includes('software');
    const aiNiche = aiInsights?.business_context?.industry_niche;
    const siteType = aiNiche || (isLocal ? 'Local Business' : isSaas ? 'Software / SaaS' : 'Business Website');

    const hasAnySchema = (schemaData?.schemas_found?.length ?? 0) > 0;
    const wc = contentData?.word_count ?? 0;
    const likelySPA = wc < 50;
    const llmsState = REPORT_UI?.llmsTxtView?.(techData, reportLanguage)?.state
      ?? (techData?.llms_txt_status === 'error' ? 'unknown' : techData?.llms_txt_present ? 'present' : 'missing');
    const sslData = mods.ssl_cert?.data;
    const sslOk = sslData?.is_valid ?? sslData?.valid;
    // Only fire SSL critical when we have a real issuer (e.g. "Let's Encrypt", "DigiCert").
    // Placeholder strings like 'Unknown' / 'Unverified' mean retrieval failed — not a bad cert.
    const SSL_PLACEHOLDER = new Set(['Unknown', 'Unverified', 'Verified (details unavailable)', '']);
    const sslDefinitelyBad = sslOk === false && !!sslData?.issuer && !SSL_PLACEHOLDER.has(sslData.issuer);
    const respMs = techData?.response_time_ms ?? 0;

    // What's working
    const positives = [];
    const httpsOk = sslOk === true || techData?.checks?.find(c => c.name === 'HTTPS redirect' && c.passed);
    if (httpsOk) positives.push('Secure connection (HTTPS) — browsers and visitors trust your site');
    if (!contentData?.has_noindex) positives.push('Visible to search engines — pages are not blocked from indexing');
    if (techData?.checks?.find(c => c.name === 'Mobile viewport meta')?.passed) positives.push('Mobile-friendly — works properly on phones and tablets');
    if (respMs > 0 && respMs <= 1000) positives.push(`Fast server response (${respMs}ms) — good for rankings and user experience`);
    if (wc >= 600) positives.push('Good content depth — enough text for search engines to understand your topic');
    else if (wc >= 300) positives.push('Reasonable content length — some pages could use more detail');
    if ((contentData?.h2_count ?? 0) >= 2) positives.push('Well-structured content — headings help search engines parse topics');
    // Use the raw-HTML image_audit (techData) rather than content_quality's stripped count —
    // content_quality strips nav/footer before counting, which can overstate coverage when
    // images missing alt happen to live in those sections.
    const imgAudit = techData?.image_audit;
    if ((imgAudit?.missing_alt ?? 1) === 0 && (imgAudit?.total ?? 0) > 0) positives.push('Images have descriptive labels — helps accessibility and image search');
    if (hasAnySchema) positives.push('Structured data present — explicit facts are easier for automated readers to extract');
    if (llmsState === 'present') positives.push('llms.txt file found — selected pages have an optional content index');
    if ((techData?.sitemap_url_count ?? 0) > 0) positives.push('XML sitemap found — search engines can map all your pages');
    if (authData?.wikidata_id) positives.push('Wikidata entity — a supporting public knowledge signal was found');
    if (authData?.wikipedia) positives.push('Wikipedia presence — a supporting public authority signal was found');
    if ((authData?.indexed_page_count ?? 0) >= 10) positives.push(`${authData.indexed_page_count}+ pages indexed in Common Crawl — broad web footprint`);
    if (contentData?.has_email && contentData?.has_phone) positives.push('Contact information visible — builds visitor trust and local SEO signals');
    else if (contentData?.has_email) positives.push('Email address visible on site — helps visitors and search engines find you');
    if (techData?.checks?.find(c => c.name === 'Open Graph tags complete')?.passed) positives.push('Social preview tags set — links look professional when shared on social media');

    // Issues — by severity
    const critical = [], important = [], minor = [];

    if (contentData?.has_noindex) critical.push('Pages are hidden from all search engines — a "noindex" tag is blocking Google and AI crawlers');
    if ((techData?.blocked_ai_bots?.length ?? 0) > 0) critical.push(`Automated readers are blocked (${(techData.blocked_ai_bots).join(', ')}) — review whether this matches your publishing policy`);
    if (sslDefinitelyBad) critical.push('SSL certificate is invalid or expired — browsers warn visitors about security risks');
    if (wc > 0 && wc < 50) critical.push(`Almost no readable text found (${wc} words) — the page likely requires JavaScript to load, which most search engines cannot see`);

    if (!hasAnySchema) important.push('No structured data — search and AI engines cannot reliably extract business name, address, or services');
    if (llmsState === 'missing') important.push('No llms.txt file — an optional content index could make selected pages easier for automated readers to discover');
    if (wc >= 50 && wc < 300) important.push(`Very little content (${wc} words) — search engines need at least 300 words to understand what you offer`);
    if (techData?.checks?.find(c => c.name === 'Open Graph tags complete' && !c.passed)) important.push('No social preview tags — shared links show no image or description on social media');
    if ((techData?.sitemap_url_count ?? 0) === 0) important.push('No XML sitemap — search engines must discover pages by guessing, and may miss some');
    if (wc >= 300 && wc < 600) important.push(`Content is thin (${wc} words) — aim for 600+ words on key pages to compete for rankings`);
    if ((contentData?.h2_count ?? 0) === 0 && wc >= 100) important.push('No section headings — content lacks structure, making it harder for search engines to parse topics');

    const imgMissing = imgAudit?.missing_alt ?? 0;
    if (imgMissing > 0) minor.push(`${imgMissing} image${imgMissing > 1 ? 's' : ''} missing descriptive text — screen readers and image search cannot interpret these`);
    if (isLocal && !contentData?.has_phone) minor.push('No phone number on homepage — local customers often look for this before visiting');
    if (isLocal && !contentData?.has_address) minor.push('No address or location text — weakens local search and map listing signals');
    if (!contentData?.lang_attr) minor.push('Language not declared on the page — browsers and search engines cannot auto-detect your target language');
    if (respMs > 2000) minor.push(`Slow server response (${respMs}ms) — aim for under 800ms for better rankings and crawl efficiency`);

    if (!positives.length && !critical.length && !important.length) return;

    // Citation bar
    const citePct = Math.round((geoData?.citation_rate ?? 0) * 100);
    const citeLabel = citePct >= 70 ? 'High' : citePct >= 40 ? 'Moderate' : 'Low';
    const citeBarColor = citePct >= 70 ? 'bg-green-500' : citePct >= 40 ? 'bg-amber-400' : 'bg-orange-500';
    const citeLabelColor = citePct >= 70 ? 'text-green-700' : citePct >= 40 ? 'text-amber-600' : 'text-orange-600';

    const posHtml = positives.slice(0, 7).map(p =>
      `<li class="flex gap-2 items-start"><span class="shrink-0 text-green-500 mt-0.5 text-[13px]">✓</span><span>${esc(p)}</span></li>`
    ).join('');

    const issueHtml = [
      ...critical.map(t => `<li class="flex gap-2 items-start"><span class="shrink-0 mt-0.5">🔴</span><span class="text-red-700 font-medium">${esc(t)}</span></li>`),
      ...important.map(t => `<li class="flex gap-2 items-start"><span class="shrink-0 mt-0.5">🟡</span><span class="text-amber-700">${esc(t)}</span></li>`),
      ...minor.map(t => `<li class="flex gap-2 items-start"><span class="shrink-0 mt-0.5">🟢</span><span class="text-slate-600">${esc(t)}</span></li>`),
    ].join('');

    const bizDesc = aiInsights?.business_context?.description;

    addCard('plain-english-report', 'geo', `
      <div class="flex items-start justify-between mb-3">
        <div class="min-w-0">
          <div class="font-semibold text-sm">📋 Key Findings</div>
          ${bizDesc ? `<div class="text-xs text-slate-500 mt-0.5 leading-relaxed">${esc(bizDesc.slice(0, 160))}</div>` : ''}
        </div>
        <span class="text-[10px] text-slate-400 shrink-0 ml-3 mt-0.5 bg-slate-50 px-2 py-0.5 rounded-full border border-slate-200">${esc(siteType)}</span>
      </div>

      ${(geoData?.citation_rate != null && geoData?.is_reliable !== false) ? `
      <div class="flex items-center gap-3 mb-4 p-2.5 bg-slate-50 rounded-lg">
        <div class="text-xs text-slate-500 shrink-0">Predicted visibility (simulated)</div>
        ${likelySPA
          ? `<div class="flex-1 text-xs text-slate-400 italic">Requires JavaScript — not measurable for client-rendered pages</div>`
          : `<div class="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden"><div class="h-full rounded-full ${citeBarColor} transition-all" style="width:${citePct}%"></div></div><div class="text-xs font-semibold ${citeLabelColor} shrink-0">${citeLabel} · ${citePct}%</div>`
        }
      </div>` : ''}

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        ${posHtml ? `<div>
          <div class="text-[10px] font-semibold uppercase tracking-wide text-green-700 mb-2">✅ What's working</div>
          <ul class="space-y-1.5 text-xs text-slate-700">${posHtml}</ul>
        </div>` : ''}
        ${issueHtml ? `<div>
          <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2">⚠ Needs attention</div>
          <ul class="space-y-1.5 text-xs">${issueHtml}</ul>
        </div>` : ''}
      </div>

      <div class="mt-4 pt-3 border-t border-slate-100">
        <div class="text-[10px] text-slate-400">Made improvements? Use <strong>Start Fresh</strong> in the top bar to re-run for updated scores.</div>
      </div>
    `);
  })();

  // ── Competitor Comparison ─────────────────────────────────────────────────
  addCard('card-competitor', 'geo', `
    <div class="font-semibold text-sm mb-1">⚡ Compare vs Competitor</div>
    <p class="text-xs text-slate-500 mb-3">See exactly how your SEO &amp; AI visibility stacks up against any competitor — side by side.</p>
    <div class="flex gap-2">
      <div class="relative flex-1">
        <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-4.35-4.35"/></svg>
        <input id="competitor-input" type="text" placeholder="competitor.com"
          class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-400">
      </div>
      <button id="competitor-btn" data-action="compare"
        class="shrink-0 text-sm bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white px-4 py-2 rounded-lg font-semibold transition-colors">
        Compare →
      </button>
    </div>
    <div id="competitor-results" class="mt-4 hidden"></div>
  `);

  // wire Enter key on competitor input
  setTimeout(() => {
    const ci = document.getElementById('competitor-input');
    if (ci) ci.addEventListener('keydown', e => { if (e.key === 'Enter') runCompetitorComparison(); });
  }, 0);

}

// ── Competitor Comparison ─────────────────────────────────────────────────────
async function runCompetitorComparison() {
  const input   = document.getElementById('competitor-input');
  const results = document.getElementById('competitor-results');
  const btn     = document.getElementById('competitor-btn');
  if (!input || !results || !btn || !currentDomain) return;

  const raw = input.value.trim().replace(/^https?:\/\//i, '').split(/[/?#]/)[0].toLowerCase();
  if (!raw || !raw.includes('.')) {
    input.classList.add('border-orange-300', 'ring-1', 'ring-orange-300');
    input.focus();
    return;
  }
  input.classList.remove('border-orange-300', 'ring-1', 'ring-orange-300');

  btn.disabled = true;
  btn.textContent = 'Comparing…';
  results.classList.remove('hidden');
  results.innerHTML = `
    <div class="flex items-center gap-2 text-xs text-slate-400 py-2">
      <svg class="spinner w-4 h-4 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
      </svg>
      Running comparison audit — typically 10–20s…
    </div>`;

  try {
    const res = await fetch(`${API}/api/compare?domains=${encodeURIComponent(currentDomain)},${encodeURIComponent(raw)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const mine   = data[currentDomain] ?? {};
    const theirs = data[raw]           ?? {};
    const mineSummary = REPORT_UI?.normalizeScoreSummary(mine) ?? {};
    const theirSummary = REPORT_UI?.normalizeScoreSummary(theirs) ?? {};
    const comparable = REPORT_UI?.sameScoreVersion(mineSummary, theirSummary)
      && [mineSummary.overall, mineSummary.seo, mineSummary.geo, theirSummary.overall, theirSummary.seo, theirSummary.geo].every(Number.isFinite);
    if (!comparable) {
      results.innerHTML = `<div class="text-xs text-slate-600 border border-slate-200 bg-slate-50 rounded-xl p-3"><strong>${UI_LANGUAGE === 'zh' ? '暂不可比较' : 'Not comparable yet'}</strong><div class="mt-1 text-slate-500">${UI_LANGUAGE === 'zh' ? '两个站点需要相同评分版本且都有充分证据。' : 'Both sites need the same score version and sufficient evidence.'}</div></div>`;
      return;
    }

    const s = (n) => Math.round(n);
    const bar = (n, color) =>
      `<div class="w-full bg-slate-100 rounded-full h-1.5 mt-1">
        <div class="${color} h-1.5 rounded-full transition-all" style="width:${n}%"></div>
      </div>`;
    const scoreColor = (n) => n >= 70 ? 'text-green-700' : n >= 50 ? 'text-yellow-600' : 'text-orange-600';
    const barColor   = (n) => n >= 70 ? 'bg-green-500'   : n >= 50 ? 'bg-yellow-400'  : 'bg-orange-400';

    const row = (icon, label, myVal, theirVal) => {
      const delta = myVal - theirVal;
      const winning = delta >= 0;
      const sign = delta > 0 ? '+' : '';
      return `
        <div class="grid grid-cols-[1fr_80px_80px_60px] gap-2 items-center py-2.5 border-b border-slate-100 last:border-0">
          <div class="text-xs font-medium text-slate-600">${icon} ${label}</div>
          <div class="text-center">
            <div class="text-base font-bold ${scoreColor(myVal)}">${myVal}</div>
            ${bar(myVal, barColor(myVal))}
          </div>
          <div class="text-center">
            <div class="text-base font-bold ${scoreColor(theirVal)}">${theirVal}</div>
            ${bar(theirVal, barColor(theirVal))}
          </div>
          <div class="text-center">
            <span class="text-xs font-bold px-2 py-0.5 rounded-full ${winning ? 'text-green-700 bg-green-50' : 'text-orange-600 bg-orange-50'}">
              ${winning ? '▲' : '▼'} ${sign}${delta}
            </span>
          </div>
        </div>`;
    };

    const overall  = s(mineSummary.overall);  const theirOverall  = s(theirSummary.overall);
    const seo      = s(mineSummary.seo);      const theirSeo      = s(theirSummary.seo);
    const geo      = s(mineSummary.geo);      const theirGeo      = s(theirSummary.geo);
    const delta    = overall - theirOverall;

    const insight = delta <= -15
      ? `<div class="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs">
           <div class="font-semibold text-amber-700 mb-1">⚠ ${esc(raw)} is significantly ahead</div>
           <div class="text-amber-600">
             ${geo < theirGeo - 10 ? `The biggest gap is AI Visibility (+${theirGeo - geo} pts) — the recommendations above will close this.` : `Focus on the highest-impact fixes in the recommendations above to close this gap.`}
           </div>
         </div>`
      : delta >= 15
      ? `<div class="mt-3 p-3 bg-green-50 border border-green-200 rounded-xl text-xs">
           <div class="font-semibold text-green-700 mb-1">✓ You're leading ${esc(raw)} by ${delta} points</div>
           <div class="text-green-600">Strong position. Extending your AI Visibility lead will make this gap even harder to close.</div>
         </div>`
      : `<div class="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs">
           <div class="font-semibold text-blue-700 mb-1">📊 Neck and neck with ${esc(raw)}</div>
           <div class="text-blue-600">Scores are close — even a few targeted fixes could give you the decisive edge.</div>
         </div>`;

    const shareText = `I just compared ${currentDomain} vs ${raw} on GeoScore:\n• My overall: ${overall}/100 vs their ${theirOverall}/100\n• My AI Visibility: ${geo}/100 vs their ${theirGeo}/100\n\nFree audit ↗ geo.sayori.org`;

    results.innerHTML = `
      <div class="border border-slate-200 rounded-xl overflow-hidden bg-white">
        <div class="grid grid-cols-[1fr_80px_80px_60px] gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
          <div>Metric</div>
          <div class="text-center truncate" title="${esc(currentDomain)}">${esc(abbrevDomain(currentDomain))}</div>
          <div class="text-center truncate" title="${esc(raw)}">${esc(abbrevDomain(raw))}</div>
          <div class="text-center">Δ</div>
        </div>
        <div class="px-4">
          ${row('🏆', 'Overall', overall, theirOverall)}
          ${row('🔍', 'SEO', seo, theirSeo)}
          ${row('🤖', 'AI Visibility', geo, theirGeo)}
        </div>
      </div>
      ${insight}
      <button data-copy="${esc(shareText)}"
        class="mt-3 w-full text-xs bg-slate-900 hover:bg-slate-700 text-white py-2.5 rounded-lg font-semibold transition-colors">
        📋 Copy comparison
      </button>`;

  } catch (err) {
    results.innerHTML = `<div class="text-xs text-orange-500 py-1">Comparison failed — ${esc(err.message || 'please try again')}.</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Compare →';
  }
}

// Abbreviate a domain for display in a narrow column, preserving the TLD suffix so that
// domains sharing a long common prefix (e.g. "wedohalal.com" vs "wedohalal.pages.dev")
// are still distinguishable at a glance. Up to 15 chars pass through unchanged; longer
// domains get "firstN…lastM" treatment so the TLD region remains visible.
function abbrevDomain(d, maxLen = 15) {
  if (d.length <= maxLen) return d;
  const keep = Math.floor((maxLen - 1) / 2);   // chars to keep on each side of "…"
  return d.slice(0, keep) + '…' + d.slice(-(maxLen - keep - 1));
}

function generousScale(raw) {
  if (raw <= 0) return 0;
  if (raw >= 100) return 100;
  return Math.round(Math.pow(raw / 100, 0.65) * 100);
}

function computeEeat({ techData, schemaData, authData, contentData, offPageData, onPageData }) {
  const hasWikipedia  = !!(authData?.wikipedia);
  const hasWikidata   = !!(authData?.wikidata_id);
  const domainAge     = authData?.domain_age_years ?? 0;
  const isEstablished = (hasWikipedia || hasWikidata) && domainAge >= 5;

  // Experience: content depth, FAQs, video, rich media + real-world authority proxies
  let exp = 0;
  if (contentData?.word_count >= 500) exp += 25;
  else if (contentData?.word_count >= 200) exp += 10;
  if (onPageData?.content?.has_faq) exp += 20;
  if (onPageData?.content?.has_video) exp += 20;
  if (onPageData?.content?.has_table) exp += 10;
  if (onPageData?.images?.total > 3) exp += 10;
  if ((onPageData?.content?.reading_time_min ?? 0) >= 3) exp += 15;
  // Wikipedia/Wikidata presence signals documented real-world experience
  if (hasWikipedia) exp += 20;
  if (hasWikidata)  exp += 10;
  if (domainAge >= 10) exp += 15;
  else if (domainAge >= 5) exp += 8;
  const experience = generousScale(Math.min(100, exp));

  // Expertise: schema quality, content score, heading structure + authority signals
  let expt = 0;
  if (schemaData?.score >= 60) expt += 30;
  else if (schemaData?.score >= 30) expt += 15;
  if (contentData?.score >= 70) expt += 30;
  else if (contentData?.score >= 40) expt += 15;
  if (schemaData?.schemas_found?.some(s => ['Article', 'HowTo', 'FAQPage', 'Course'].includes(s))) expt += 20;
  if (onPageData?.headings?.h2 >= 3) expt += 10;
  if (techData?.checks?.find(c => c.name?.includes('hreflang'))?.passed) expt += 10;
  // Wikipedia/Wikidata are strong expertise signals (entity knowledge graph presence)
  if (hasWikipedia) expt += 20;
  if (hasWikidata)  expt += 15;
  if (isEstablished) expt += 5;
  const expertise = generousScale(Math.min(100, expt));

  // Authoritativeness
  let auth = 0;
  if (authData?.wikipedia) auth += 30;
  if (authData?.wikidata_id) auth += 25;
  if ((authData?.domain_age_years ?? 0) >= 10) auth += 25;
  else if ((authData?.domain_age_years ?? 0) >= 5) auth += 20;
  else if ((authData?.domain_age_years ?? 0) >= 2) auth += 10;
  if ((authData?.indexed_page_count ?? 0) >= 50) auth += 15;
  else if ((authData?.indexed_page_count ?? 0) >= 10) auth += 7;
  if ((offPageData?.social_profiles?.length ?? 0) >= 3) auth += 10;
  if (offPageData?.brand_presence?.has_knowledge_panel) auth += 10;
  const authority = generousScale(Math.min(100, auth));

  // Trustworthiness
  let trust = 0;
  if (techData?.checks?.find(c => c.name === 'HTTPS enabled')?.passed) trust += 20;
  if (techData?.security_headers?.score >= 50) trust += 15;
  if (techData?.security_headers?.hsts) trust += 10;
  if (offPageData?.email_security?.has_dmarc &&
      offPageData?.email_security?.dmarc_policy !== 'none') trust += 10;
  if (offPageData?.email_security?.has_spf) trust += 10;
  if (techData?.checks?.find(c => c.name?.includes('Canonical'))?.passed) trust += 10;
  if (techData?.checks?.find(c => c.name?.includes('noindex'))?.passed) trust += 5;
  if ((contentData?.has_phone ?? false)) trust += 10;
  if (techData?.llms_txt_present) trust += 10;
  const trustworthiness = generousScale(Math.min(100, trust));

  const total = Math.round((experience + expertise + authority + trustworthiness) / 4);
  return { experience, expertise, authority, trustworthiness, total };
}

function renderEeatBar(label, letter, score, tooltip) {
  const color = score >= 70 ? 'bg-green-500' : score >= 40 ? 'bg-yellow-400' : 'bg-blue-400';
  const textColor = score >= 70 ? 'text-green-700' : score >= 40 ? 'text-yellow-700' : 'text-blue-600';
  return `<div class="flex items-center gap-2" title="${esc(tooltip)}">
    <span class="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold flex items-center justify-center shrink-0">${letter}</span>
    <span class="text-xs text-slate-600 w-28 shrink-0">${label}</span>
    <div class="flex-1 bg-slate-100 rounded-full h-2">
      <div class="${color} h-2 rounded-full transition-all" style="width:${score}%"></div>
    </div>
    <span class="text-xs font-semibold ${textColor} w-9 text-right">${score}/100</span>
  </div>`;
}


// ── Request-local site archetype correction ─────────────────────────────────

let _vmDomain = '';

function openArchetypeCorrection(domain, currentArchetype) {
  _vmDomain = domain;

  const modal = document.getElementById('vertical-modal');
  const currentEl = document.getElementById('vm-current');
  const select = document.getElementById('vm-vertical');
  const msg = document.getElementById('vm-msg');
  if (!modal || !currentEl || !select) return;

  currentEl.textContent = currentArchetype || 'unknown';
  select.value = '';
  if (msg) { msg.textContent = ''; msg.classList.add('hidden'); }
  modal.classList.remove('hidden');
}

function closeVerticalModal() {
  const modal = document.getElementById('vertical-modal');
  if (modal) modal.classList.add('hidden');
}

async function submitArchetypeCorrection() {
  const select = document.getElementById('vm-vertical');
  const msg = document.getElementById('vm-msg');
  const btn = document.getElementById('vm-submit');
  const archetypeHint = select ? select.value : '';

  if (!archetypeHint) {
    if (msg) { msg.textContent = UI_LANGUAGE === 'zh' ? '请选择站点类型。' : 'Please select a site type.'; msg.className = 'text-xs mb-3 text-orange-600'; msg.classList.remove('hidden'); }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = UI_LANGUAGE === 'zh' ? '正在重新审查…' : 'Re-auditing...'; }
  const request = currentAuditRequest ?? { domain: _vmDomain, mode: 'site', targetUrl: null };
  const target = request.mode === 'url' && request.targetUrl ? request.targetUrl : request.domain || _vmDomain;
  closeVerticalModal();
  try {
    await startAudit(target, { archetypeHint, fresh: true });
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = UI_LANGUAGE === 'zh' ? '应用并重新审查' : 'Apply & Re-audit'; }
  }
}

// Close modal on backdrop click
document.getElementById('vertical-modal')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('vertical-modal')) closeVerticalModal();
});

// ── Wire static HTML buttons that previously used inline onclick attributes ──
// (inline onclick is blocked by Content-Security-Policy; event listeners are not)
(function wireStaticButtons() {
  const hiw = document.getElementById('hiw-modal');
  const openHiw = () => hiw?.classList.remove('hidden');

  document.getElementById('hiw-open-btn')?.addEventListener('click', openHiw);
  document.getElementById('footer-hiw-btn')?.addEventListener('click', openHiw);
  document.getElementById('footer-privacy-btn')?.addEventListener('click', () => {
    openHiw();
    document.querySelector('.hiw-tab[data-tab="privacy"]')?.click();
  });
  document.getElementById('vm-submit')?.addEventListener('click', submitArchetypeCorrection);
  document.getElementById('vm-cancel')?.addEventListener('click', closeVerticalModal);
})();

// ── Generic module feedback (thumbs-down) ────────────────────────────────────

async function submitModuleFeedback(domain, module, field, reportedValue) {
  try {
    await fetch(`${API}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, module, field, reported_value: reportedValue }),
    });
  } catch { /* best-effort */ }
}
