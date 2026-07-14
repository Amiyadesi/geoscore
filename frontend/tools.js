// ── Tool switcher ────────────────────────────────────────────────────────────
function switchTool(name) {
  document.querySelectorAll('.tool-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tool-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('panel-' + name)?.classList.add('active');
  ['tab-' + name, 'tab-' + name + '-m'].forEach(id => document.getElementById(id)?.classList.add('active'));

  // Auto-generate output for panels that don't need user input first
  if (name === 'headers') generateHeaders();
  if (name === 'schema')  resetSchema();
}

// ── Utility ──────────────────────────────────────────────────────────────────
function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function copyOutput(id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.value).then(() => {
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = orig, 1800);
    }
  }).catch(() => { el.select(); document.execCommand('copy'); });
}

function downloadFile(id, filename, mime) {
  const content = document.getElementById(id)?.value ?? '';
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── 1. robots.txt Generator ──────────────────────────────────────────────────
const AI_BOTS = ['GPTBot','ClaudeBot','PerplexityBot','anthropic-ai','CCBot','Google-Extended','Amazonbot','Bytespider'];

function addRobotRule(agent='*', directive='Disallow', path='') {
  const container = document.getElementById('rb-rules');
  const row = document.createElement('div');
  row.className = 'robots-rule-row p-3 grid grid-cols-3 gap-2';
  row.innerHTML = `
    <select class="rb-agent border border-slate-200 rounded px-2 py-1.5 text-sm">
      <option>*</option><option>Googlebot</option><option>GPTBot</option><option>ClaudeBot</option><option>PerplexityBot</option><option>anthropic-ai</option><option>CCBot</option><option>Bingbot</option><option>facebookexternalhit</option><option>Twitterbot</option>
    </select>
    <select class="rb-directive border border-slate-200 rounded px-2 py-1.5 text-sm">
      <option value="Allow">Allow</option><option value="Disallow">Disallow</option>
    </select>
    <div class="flex gap-1">
      <input class="rb-path flex-1 border border-slate-200 rounded px-2 py-1.5 text-sm" placeholder="/" value="${esc(path)}">
      <button data-action="remove-robot-row" class="text-slate-400 hover:text-red-500 px-1 text-lg leading-none">×</button>
    </div>`;
  row.querySelector('.rb-agent').value = agent;
  row.querySelector('.rb-directive').value = directive;
  container.appendChild(row);
}

function rbPreset(type) {
  const container = document.getElementById('rb-rules');
  container.innerHTML = '';
  if (type === 'allow-all') {
    addRobotRule('*','Allow','/');
  } else if (type === 'block-ai') {
    addRobotRule('*','Allow','/');
    AI_BOTS.forEach(b => addRobotRule(b,'Disallow','/'));
  } else if (type === 'block-all') {
    addRobotRule('*','Disallow','/');
  }
  generateRobots();
}

function generateRobots() {
  const sitemap = document.getElementById('rb-sitemap').value.trim();
  const rows = document.querySelectorAll('.robots-rule-row');

  // Group rules by user-agent
  const groups = new Map();
  rows.forEach(row => {
    const agent = row.querySelector('.rb-agent')?.value || '*';
    const directive = row.querySelector('.rb-directive')?.value || 'Disallow';
    const path = row.querySelector('.rb-path')?.value.trim() || '/';
    if (!groups.has(agent)) groups.set(agent, []);
    groups.get(agent).push(`${directive}: ${path}`);
  });

  let out = '';
  for (const [agent, rules] of groups) {
    out += `User-agent: ${agent}\n`;
    rules.forEach(r => out += r + '\n');
    out += '\n';
  }
  if (sitemap) out += `Sitemap: ${sitemap}\n`;

  document.getElementById('rb-output').value = out.trim();
}

// ── 2. Meta Tag Generator ─────────────────────────────────────────────────────
function updateTitleCount(el) {
  const len = el.value.length;
  const counter = document.getElementById('mt-title-count');
  if (counter) { counter.textContent = `${len}/60`; counter.className = `text-xs ${len > 60 ? 'text-orange-500 font-semibold' : 'text-slate-400'}`; }
}
function updateDescCount(el) {
  const len = el.value.length;
  const counter = document.getElementById('mt-desc-count');
  if (counter) { counter.textContent = `${len}/160`; counter.className = `text-xs ${len > 160 ? 'text-orange-500 font-semibold' : 'text-slate-400'}`; }
}
function generateMeta() {
  const title = document.getElementById('mt-title').value.trim();
  const desc  = document.getElementById('mt-desc').value.trim();
  const canonical = document.getElementById('mt-canonical').value.trim();
  const ogImage = document.getElementById('mt-og-image').value.trim();
  const ogType  = document.getElementById('mt-og-type').value;
  const robots  = document.getElementById('mt-robots').value;
  const twitter = document.getElementById('mt-twitter').value.trim();

  const domain = canonical ? (() => { try { return new URL(canonical).hostname; } catch { return canonical; } })() : '';

  const lines = [
    '<!-- Primary Meta Tags -->',
    title     ? `<title>${esc(title)}</title>` : '',
    title     ? `<meta name="title" content="${esc(title)}">` : '',
    desc      ? `<meta name="description" content="${esc(desc)}">` : '',
    `<meta name="robots" content="${esc(robots)}">`,
    canonical ? `<link rel="canonical" href="${esc(canonical)}">` : '',
    '',
    '<!-- Open Graph / Facebook -->',
    `<meta property="og:type" content="${esc(ogType)}">`,
    canonical ? `<meta property="og:url" content="${esc(canonical)}">` : '',
    title     ? `<meta property="og:title" content="${esc(title)}">` : '',
    desc      ? `<meta property="og:description" content="${esc(desc)}">` : '',
    ogImage   ? `<meta property="og:image" content="${esc(ogImage)}">` : '',
    domain    ? `<meta property="og:site_name" content="${esc(domain)}">` : '',
    '',
    '<!-- Twitter Card -->',
    `<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">`,
    twitter   ? `<meta name="twitter:site" content="${esc(twitter)}">` : '',
    title     ? `<meta name="twitter:title" content="${esc(title)}">` : '',
    desc      ? `<meta name="twitter:description" content="${esc(desc)}">` : '',
    ogImage   ? `<meta name="twitter:image" content="${esc(ogImage)}">` : '',
  ].filter(l => l !== undefined && l !== '').join('\n');

  document.getElementById('mt-output').value = lines;
}

// ── 3. SERP Preview ───────────────────────────────────────────────────────────
function updateSerpPreview() {
  const title = document.getElementById('sp-title').value;
  const url   = document.getElementById('sp-url').value.trim();
  const desc  = document.getElementById('sp-desc').value;
  const dateVal = document.getElementById('sp-date').value;
  const faviconDomain = document.getElementById('sp-favicon').value.trim();

  // Update counters
  const titleLen = title.length, descLen = desc.length;
  const tc = document.getElementById('sp-title-count');
  const dc = document.getElementById('sp-desc-count');
  if (tc) { tc.textContent = `${titleLen}/60`; tc.className = `text-xs ${titleLen > 60 ? 'text-orange-500 font-semibold' : 'text-slate-400'}`; }
  if (dc) { dc.textContent = `${descLen}/160`; dc.className = `text-xs ${descLen > 160 ? 'text-orange-500 font-semibold' : 'text-slate-400'}`; }

  // Title (truncate at 60 chars)
  const displayTitle = title || 'Page Title';
  const truncTitle = displayTitle.length > 60 ? displayTitle.slice(0, 60) + '…' : displayTitle;
  document.getElementById('sp-title-display').textContent = truncTitle;

  // URL display
  let displayUrl = url || 'example.com';
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    displayUrl = u.hostname + (u.pathname !== '/' ? u.pathname : '');
  } catch {}
  const breadcrumb = displayUrl.replace(/\//g,' › ');
  document.getElementById('sp-url-display').textContent = breadcrumb;

  // Favicon
  const favDomain = faviconDomain || (() => { try { return new URL(url.startsWith('http') ? url : 'https://' + url).hostname; } catch { return ''; } })();
  if (favDomain) {
    const favImg = document.getElementById('sp-fav-el');
    favImg.src = `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(favDomain)}`;
    favImg.classList.remove('hidden');
  }

  // Description (truncate at 160 chars)
  const displayDesc = desc || 'Your meta description will appear here. Keep it between 120–160 characters for best results.';
  const truncDesc = displayDesc.length > 160 ? displayDesc.slice(0, 160) + '…' : displayDesc;
  let descHtml = truncDesc;
  if (dateVal) {
    const d = new Date(dateVal + 'T12:00:00');
    const formatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    descHtml = `<span style="color:#70757a">${formatted} — </span>${truncDesc}`;
  }
  document.getElementById('sp-desc-display').innerHTML = descHtml;

  // Warnings
  const warnings = document.getElementById('sp-warnings');
  const warningItems = [];
  if (title.length > 60)  warningItems.push({ type: 'warn', msg: `Title is ${title.length} chars — Google may truncate after ~60.` });
  if (title.length < 30 && title.length > 0)  warningItems.push({ type: 'info', msg: `Title is short (${title.length} chars) — aim for 50–60.` });
  if (desc.length > 160)  warningItems.push({ type: 'warn', msg: `Description is ${desc.length} chars — Google may truncate after ~160.` });
  if (desc.length < 80 && desc.length > 0)  warningItems.push({ type: 'info', msg: `Description is short (${desc.length} chars) — aim for 120–160.` });
  warnings.innerHTML = warningItems.map(w =>
    `<div class="text-xs px-3 py-2 rounded-lg ${w.type === 'warn' ? 'bg-orange-50 text-orange-700 border border-orange-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}">
      ${w.type === 'warn' ? '⚠️' : 'ℹ️'} ${w.msg}
    </div>`
  ).join('');
}

// ── 4. Open Graph Preview ─────────────────────────────────────────────────────
function updateOgPreview() {
  const title   = document.getElementById('og-title').value || 'Page Title';
  const desc    = document.getElementById('og-desc').value || 'Description…';
  const image   = document.getElementById('og-image').value.trim();
  const siteName = document.getElementById('og-site').value.trim() || 'yoursite.com';

  // Twitter
  document.getElementById('og-title-twitter').textContent = title.length > 70 ? title.slice(0,70)+'…' : title;
  document.getElementById('og-desc-twitter').textContent  = desc.length > 100 ? desc.slice(0,100)+'…' : desc;
  document.getElementById('og-site-twitter').textContent  = siteName.toLowerCase();
  // Facebook
  document.getElementById('og-title-fb').textContent = title.length > 88 ? title.slice(0,88)+'…' : title;
  document.getElementById('og-site-fb').textContent  = siteName.toLowerCase();

  // Image
  ['twitter','fb'].forEach(p => {
    const img = document.getElementById(`og-img-${p}-el`);
    const ph  = document.getElementById(`og-img-${p}-ph`);
    if (image) {
      img.src = image;
      img.classList.remove('hidden');
      img.onerror = () => { img.classList.add('hidden'); ph.classList.remove('hidden'); ph.textContent = 'Image failed to load'; };
      if (ph) ph.classList.add('hidden');
    } else {
      img.classList.add('hidden');
      if (ph) { ph.classList.remove('hidden'); ph.textContent = 'No image set'; }
    }
  });
}

async function fetchOgFromUrl() {
  const url = document.getElementById('og-url-input').value.trim();
  const status = document.getElementById('og-fetch-status');
  if (!url) return;
  status.textContent = 'Fetching…'; status.classList.remove('hidden');
  try {
    // Use allorigins proxy to avoid CORS issues
    const proxyRes = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url.startsWith('http') ? url : 'https://' + url)}`);
    if (!proxyRes.ok) throw new Error('Could not fetch page');
    const html = await proxyRes.text();
    const getTag = (prop) => {
      const match = html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
                  || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i'));
      return match ? match[1] : '';
    };
    document.getElementById('og-title').value  = getTag('og:title') || (html.match(/<title[^>]*>([^<]+)<\/title>/i)||[])[1] || '';
    document.getElementById('og-desc').value   = getTag('og:description');
    document.getElementById('og-image').value  = getTag('og:image');
    document.getElementById('og-site').value   = getTag('og:site_name') || (() => { try { return new URL(url).hostname; } catch { return ''; } })();
    updateOgPreview();
    status.textContent = '✓ Tags loaded'; status.className = 'text-xs text-green-600 mt-1.5';
  } catch {
    status.textContent = 'Could not fetch — enter tags manually below'; status.className = 'text-xs text-orange-600 mt-1.5';
  }
}

// ── 5. Sitemap XML Builder ────────────────────────────────────────────────────
function generateSitemap() {
  const rawUrls = document.getElementById('sm-urls').value.trim().split('\n').map(u => u.trim()).filter(Boolean);
  const freq  = document.getElementById('sm-freq').value;
  const prio  = document.getElementById('sm-priority').value;
  const lastmod = document.getElementById('sm-lastmod').checked;
  const today = new Date().toISOString().slice(0,10);

  const urlEntries = rawUrls.map((url, i) => {
    const fullUrl = url.startsWith('http') ? url : 'https://' + url;
    // First URL gets priority 1.0 if it's the homepage
    const urlPrio = (i === 0 && (url === '/' || url.replace(/^https?:\/\/[^/]+\/?$/,'') === '')) ? '1.0' : prio;
    return `  <url>
    <loc>${esc(fullUrl)}</loc>
    ${lastmod ? `<lastmod>${today}</lastmod>\n    ` : ''}<changefreq>${freq}</changefreq>
    <priority>${urlPrio}</priority>
  </url>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`;

  document.getElementById('sm-output').value = xml;
}

// ── 6. Security Headers Generator ────────────────────────────────────────────
const CSP_PRESETS = {
  strict:   "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  moderate: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src * data: blob:; font-src * data:; connect-src *; frame-ancestors 'self'",
  open:     "default-src * 'unsafe-inline' 'unsafe-eval'; img-src * data: blob:; connect-src *",
};

const HEADERS_MAP = {
  hsts:        ['Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload'],
  xcontent:    ['X-Content-Type-Options', 'nosniff'],
  xframe:      ['X-Frame-Options', 'SAMEORIGIN'],
  referrer:    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  permissions: ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()'],
};

function generateHeaders() {
  const platform = document.getElementById('sh-platform').value;
  const cspPreset = document.getElementById('sh-csp-preset').value;
  const cspVal = CSP_PRESETS[cspPreset];
  const corp = document.getElementById('sh-corp').checked;

  const activeHeaders = [];
  Object.entries(HEADERS_MAP).forEach(([id, [name, val]]) => {
    if (document.getElementById('sh-' + id)?.checked) activeHeaders.push([name, val]);
  });
  if (document.getElementById('sh-csp')?.checked) activeHeaders.push(['Content-Security-Policy', cspVal]);
  if (corp) {
    activeHeaders.push(['Cross-Origin-Embedder-Policy', 'require-corp']);
    activeHeaders.push(['Cross-Origin-Opener-Policy', 'same-origin']);
    activeHeaders.push(['Cross-Origin-Resource-Policy', 'same-origin']);
  }

  let output = '';
  switch(platform) {
    case 'cloudflare':
    case 'netlify':
      output = `/*\n` + activeHeaders.map(([k,v]) => `  ${k}: ${v}`).join('\n');
      break;
    case 'nginx':
      output = `# Add inside your server {} block\n` + activeHeaders.map(([k,v]) => `add_header ${k} "${v}" always;`).join('\n');
      break;
    case 'apache':
      output = `# Add to .htaccess or VirtualHost\n<IfModule mod_headers.c>\n` + activeHeaders.map(([k,v]) => `  Header always set ${k} "${v}"`).join('\n') + '\n</IfModule>';
      break;
    case 'vercel':
      output = JSON.stringify({
        headers: [{ source: '/(.*)', headers: activeHeaders.map(([key,value]) => ({key, value})) }]
      }, null, 2);
      break;
    case 'nextjs':
      const hStr = activeHeaders.map(([key,value]) => `          { key: '${key}', value: '${value}' }`).join(',\n');
      output = `// next.config.js\nmodule.exports = {\n  async headers() {\n    return [\n      {\n        source: '/(.*)',\n        headers: [\n${hStr}\n        ],\n      },\n    ];\n  },\n};`;
      break;
  }
  document.getElementById('sh-output').value = output;
}

function downloadHeadersFile() {
  const platform = document.getElementById('sh-platform').value;
  const names = { cloudflare:'_headers', netlify:'_headers', nginx:'nginx-security.conf', apache:'.htaccess', vercel:'vercel.json', nextjs:'next.config.js' };
  downloadFile('sh-output', names[platform] || 'headers.txt', 'text/plain');
}

// ── 7. Schema Generator ───────────────────────────────────────────────────────
const SC_FIELDS = {
  Organization: [
    { id:'sc-org-name',  label:'Organization Name', ph:'Acme Corp', required:true },
    { id:'sc-org-url',   label:'Website URL',       ph:'https://example.com', type:'url' },
    { id:'sc-org-logo',  label:'Logo URL',           ph:'https://example.com/logo.png', type:'url' },
    { id:'sc-org-desc',  label:'Description',        ph:'What your organization does…', type:'textarea' },
    { id:'sc-org-email', label:'Contact Email',      ph:'hello@example.com' },
    { id:'sc-org-phone', label:'Phone',               ph:'+1-555-0100' },
    { id:'sc-org-twitter',label:'Twitter/X URL',     ph:'https://twitter.com/handle' },
  ],
  LocalBusiness: [
    { id:'sc-lb-name',  label:'Business Name', ph:'Acme Plumbing', required:true },
    { id:'sc-lb-url',   label:'Website URL', ph:'https://example.com', type:'url' },
    { id:'sc-lb-phone', label:'Phone', ph:'+1-555-0100' },
    { id:'sc-lb-email', label:'Email', ph:'contact@example.com' },
    { id:'sc-lb-addr',  label:'Street Address', ph:'123 Main St' },
    { id:'sc-lb-city',  label:'City', ph:'New York' },
    { id:'sc-lb-state', label:'State/Region', ph:'NY' },
    { id:'sc-lb-zip',   label:'Postal Code', ph:'10001' },
    { id:'sc-lb-country',label:'Country', ph:'US' },
    { id:'sc-lb-lat',   label:'Latitude', ph:'40.7128' },
    { id:'sc-lb-lng',   label:'Longitude', ph:'-74.0060' },
    { id:'sc-lb-hours', label:'Opening Hours (ISO)', ph:'Mo-Fr 09:00-17:00' },
    { id:'sc-lb-price', label:'Price Range', ph:'$$' },
  ],
  FAQPage: [
    { id:'sc-faq-pairs', label:'FAQ Items', type:'faq', ph:'' },
  ],
  Article: [
    { id:'sc-art-headline', label:'Headline', ph:'Article Title', required:true },
    { id:'sc-art-author', label:'Author Name', ph:'Jane Smith', required:true },
    { id:'sc-art-date', label:'Published Date', ph:'2024-01-01', type:'date' },
    { id:'sc-art-modified', label:'Modified Date', ph:'2024-06-01', type:'date' },
    { id:'sc-art-image', label:'Article Image URL', ph:'https://example.com/image.jpg', type:'url' },
    { id:'sc-art-url', label:'Article URL', ph:'https://example.com/article', type:'url' },
    { id:'sc-art-publisher', label:'Publisher Name', ph:'My Blog', required:true },
    { id:'sc-art-publogo', label:'Publisher Logo URL', ph:'https://example.com/logo.png', type:'url' },
    { id:'sc-art-desc', label:'Description', ph:'Brief article summary…', type:'textarea' },
  ],
  BreadcrumbList: [
    { id:'sc-bc-items', label:'Breadcrumb items (Name | URL — one per line)', type:'textarea', ph:'Home | https://example.com\nBlog | https://example.com/blog\nArticle Title | https://example.com/blog/article' },
  ],
  Product: [
    { id:'sc-prod-name',  label:'Product Name', ph:'Acme Widget', required:true },
    { id:'sc-prod-desc',  label:'Description', ph:'Product description…', type:'textarea' },
    { id:'sc-prod-image', label:'Image URL', ph:'https://example.com/product.jpg', type:'url' },
    { id:'sc-prod-url',   label:'Product URL', ph:'https://example.com/product', type:'url' },
    { id:'sc-prod-price', label:'Price', ph:'29.99' },
    { id:'sc-prod-currency', label:'Currency', ph:'USD' },
    { id:'sc-prod-avail',  label:'Availability', type:'select', opts:['InStock','OutOfStock','PreOrder','Discontinued'] },
    { id:'sc-prod-rating', label:'Aggregate Rating (1-5)', ph:'4.5' },
    { id:'sc-prod-reviews',label:'Review Count', ph:'42' },
  ],
  WebSite: [
    { id:'sc-ws-name', label:'Site Name', ph:'My Website', required:true },
    { id:'sc-ws-url',  label:'Site URL', ph:'https://example.com', type:'url', required:true },
    { id:'sc-ws-search',label:'Search URL pattern', ph:'https://example.com/search?q={search_term_string}' },
  ],
};

function renderField(f) {
  if (f.type === 'faq') return `
    <div>
      <label class="block text-sm font-medium text-slate-700 mb-1.5">FAQ Items</label>
      <div id="sc-faq-list" class="space-y-2"></div>
      <button id="sc-faq-add" class="mt-2 text-sm text-blue-600 hover:underline">+ Add question</button>
    </div>`;
  if (f.type === 'textarea') return `
    <div>
      <label class="block text-sm font-medium text-slate-700 mb-1">${f.label}${f.required?' <span class="text-red-500">*</span>':''}</label>
      <textarea id="${f.id}" rows="3" placeholder="${esc(f.ph||'')}" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none"></textarea>
    </div>`;
  if (f.type === 'date') return `
    <div>
      <label class="block text-sm font-medium text-slate-700 mb-1">${f.label}</label>
      <input id="${f.id}" type="date" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
    </div>`;
  if (f.type === 'select') return `
    <div>
      <label class="block text-sm font-medium text-slate-700 mb-1">${f.label}</label>
      <select id="${f.id}" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
        ${f.opts.map(o=>`<option value="${o}">${o}</option>`).join('')}
      </select>
    </div>`;
  return `
    <div>
      <label class="block text-sm font-medium text-slate-700 mb-1">${f.label}${f.required?' <span class="text-red-500">*</span>':''}</label>
      <input id="${f.id}" type="${f.type||'text'}" placeholder="${esc(f.ph||'')}" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
    </div>`;
}

function addFaqItem(q='', a='') {
  const list = document.getElementById('sc-faq-list');
  if (!list) return;
  const item = document.createElement('div');
  item.className = 'border border-slate-200 rounded-lg p-3 space-y-2 relative';
  item.innerHTML = `
    <button data-action="remove-faq-item" class="absolute top-2 right-2 text-slate-300 hover:text-red-500 text-lg leading-none">×</button>
    <input placeholder="Question" value="${esc(q)}" class="sc-faq-q w-full border border-slate-200 rounded px-2 py-1.5 text-sm">
    <textarea rows="2" placeholder="Answer" class="sc-faq-a w-full border border-slate-200 rounded px-2 py-1.5 text-sm resize-none">${esc(a)}</textarea>`;
  list.appendChild(item);
}

function resetSchema() {
  const type = document.getElementById('sc-type').value;
  const fields = SC_FIELDS[type] || [];
  const container = document.getElementById('sc-fields');
  container.innerHTML = fields.map(renderField).join('');
  if (type === 'FAQPage') {
    addFaqItem('What is [your product/service]?', 'Brief answer to the question…');
    addFaqItem('How does it work?', 'Step-by-step explanation…');
    // Wire up the "Add question" button rendered by renderField
    document.getElementById('sc-faq-add')?.addEventListener('click', () => addFaqItem());
  }
  document.getElementById('sc-output').value = '';
}

function v(id) { const el = document.getElementById(id); return el ? (el.value||'').trim() : ''; }

function generateSchema() {
  const type = document.getElementById('sc-type').value;
  let obj = {};

  if (type === 'Organization') {
    obj = { '@context':'https://schema.org', '@type':'Organization',
      name: v('sc-org-name') || undefined, url: v('sc-org-url') || undefined,
      logo: v('sc-org-logo') ? { '@type':'ImageObject', url: v('sc-org-logo') } : undefined,
      description: v('sc-org-desc') || undefined, email: v('sc-org-email') || undefined,
      telephone: v('sc-org-phone') || undefined,
      sameAs: v('sc-org-twitter') ? [v('sc-org-twitter')] : undefined,
    };
  } else if (type === 'LocalBusiness') {
    const addr = { '@type':'PostalAddress',
      streetAddress: v('sc-lb-addr') || undefined, addressLocality: v('sc-lb-city') || undefined,
      addressRegion: v('sc-lb-state') || undefined, postalCode: v('sc-lb-zip') || undefined,
      addressCountry: v('sc-lb-country') || undefined,
    };
    obj = { '@context':'https://schema.org', '@type':'LocalBusiness',
      name: v('sc-lb-name') || undefined, url: v('sc-lb-url') || undefined,
      telephone: v('sc-lb-phone') || undefined, email: v('sc-lb-email') || undefined,
      address: Object.values(addr).some(Boolean) ? addr : undefined,
      geo: (v('sc-lb-lat') && v('sc-lb-lng')) ? { '@type':'GeoCoordinates', latitude: v('sc-lb-lat'), longitude: v('sc-lb-lng') } : undefined,
      openingHours: v('sc-lb-hours') || undefined, priceRange: v('sc-lb-price') || undefined,
    };
  } else if (type === 'FAQPage') {
    const items = [...document.querySelectorAll('#sc-faq-list > div')].map(el => ({
      '@type':'Question',
      name: el.querySelector('.sc-faq-q')?.value?.trim() || '',
      acceptedAnswer: { '@type':'Answer', text: el.querySelector('.sc-faq-a')?.value?.trim() || '' },
    })).filter(q => q.name);
    obj = { '@context':'https://schema.org', '@type':'FAQPage', mainEntity: items };
  } else if (type === 'Article') {
    obj = { '@context':'https://schema.org', '@type':'Article',
      headline: v('sc-art-headline') || undefined, datePublished: v('sc-art-date') || undefined,
      dateModified: v('sc-art-modified') || undefined, description: v('sc-art-desc') || undefined,
      image: v('sc-art-image') ? [v('sc-art-image')] : undefined,
      url: v('sc-art-url') || undefined,
      author: v('sc-art-author') ? { '@type':'Person', name: v('sc-art-author') } : undefined,
      publisher: v('sc-art-publisher') ? { '@type':'Organization', name: v('sc-art-publisher'), logo: v('sc-art-publogo') ? { '@type':'ImageObject', url: v('sc-art-publogo') } : undefined } : undefined,
    };
  } else if (type === 'BreadcrumbList') {
    const lines = v('sc-bc-items').split('\n').map(l => l.trim()).filter(Boolean);
    const items = lines.map((line, i) => {
      const [name, url] = line.split('|').map(s => s.trim());
      return { '@type':'ListItem', position: i+1, name, item: url || undefined };
    });
    obj = { '@context':'https://schema.org', '@type':'BreadcrumbList', itemListElement: items };
  } else if (type === 'Product') {
    const rating = v('sc-prod-rating'), reviews = v('sc-prod-reviews');
    const price = v('sc-prod-price'), currency = v('sc-prod-currency');
    obj = { '@context':'https://schema.org', '@type':'Product',
      name: v('sc-prod-name') || undefined, description: v('sc-prod-desc') || undefined,
      image: v('sc-prod-image') ? [v('sc-prod-image')] : undefined,
      url: v('sc-prod-url') || undefined,
      offers: (price) ? { '@type':'Offer', price, priceCurrency: currency || 'USD',
        availability: `https://schema.org/${document.getElementById('sc-prod-avail').value}`,
        url: v('sc-prod-url') || undefined } : undefined,
      aggregateRating: (rating && reviews) ? { '@type':'AggregateRating', ratingValue: rating, reviewCount: reviews } : undefined,
    };
  } else if (type === 'WebSite') {
    const search = v('sc-ws-search');
    obj = { '@context':'https://schema.org', '@type':'WebSite',
      name: v('sc-ws-name') || undefined, url: v('sc-ws-url') || undefined,
      potentialAction: search ? { '@type':'SearchAction', target: { '@type':'EntryPoint', urlTemplate: search }, 'query-input': 'required name=search_term_string' } : undefined,
    };
  }

  // Remove undefined keys recursively
  function clean(o) {
    if (Array.isArray(o)) return o.map(clean).filter(x => x != null);
    if (o && typeof o === 'object') {
      const out = {};
      for (const [k,val] of Object.entries(o)) {
        if (val === undefined || val === null || val === '') continue;
        const cleaned = clean(val);
        if (cleaned !== undefined && cleaned !== null && cleaned !== '') out[k] = cleaned;
      }
      return Object.keys(out).length ? out : undefined;
    }
    return o;
  }

  const cleaned = clean(obj);
  const jsonld = '<script type="application/ld+json">\n' + JSON.stringify(cleaned, null, 2) + '\n<\/script>';
  document.getElementById('sc-output').value = jsonld;
}

// ── Event delegation for dynamically-created elements ────────────────────────
document.addEventListener('click', function(e) {
  const removeRobotBtn = e.target.closest('[data-action="remove-robot-row"]');
  if (removeRobotBtn) {
    removeRobotBtn.closest('.robots-rule-row').remove();
    return;
  }
  const removeFaqBtn = e.target.closest('[data-action="remove-faq-item"]');
  if (removeFaqBtn) {
    removeFaqBtn.closest('#sc-faq-list > div').remove();
    return;
  }
});

// ── Wire up all static event listeners (script is deferred — DOM is ready) ───
(function initListeners() {
  // Tool navigation tabs
  ['robots','meta','serp','og','sitemap','headers','schema'].forEach(name => {
    document.getElementById('tab-' + name)?.addEventListener('click', () => switchTool(name));
    document.getElementById('tab-' + name + '-m')?.addEventListener('click', () => switchTool(name));
  });

  // ── Robots panel
  document.getElementById('rb-add-rule')?.addEventListener('click', () => addRobotRule());
  document.getElementById('rb-preset-allow')?.addEventListener('click', () => rbPreset('allow-all'));
  document.getElementById('rb-preset-block-ai')?.addEventListener('click', () => rbPreset('block-ai'));
  document.getElementById('rb-preset-block-all')?.addEventListener('click', () => rbPreset('block-all'));
  document.getElementById('rb-generate')?.addEventListener('click', () => generateRobots());
  document.getElementById('rb-copy')?.addEventListener('click', function() { copyOutput('rb-output', this); });
  document.getElementById('rb-download')?.addEventListener('click', () => downloadFile('rb-output','robots.txt','text/plain'));

  // ── Meta Tag panel
  document.getElementById('mt-title')?.addEventListener('input', function() { updateTitleCount(this); });
  document.getElementById('mt-desc')?.addEventListener('input', function() { updateDescCount(this); });
  document.getElementById('mt-generate')?.addEventListener('click', () => generateMeta());
  document.getElementById('mt-copy')?.addEventListener('click', function() { copyOutput('mt-output', this); });

  // ── SERP panel
  ['sp-title','sp-url','sp-desc','sp-date','sp-favicon'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => updateSerpPreview());
  });

  // ── Open Graph panel
  ['og-title','og-desc','og-image','og-site'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => updateOgPreview());
  });
  document.getElementById('og-fetch')?.addEventListener('click', () => fetchOgFromUrl());

  // ── Sitemap panel
  document.getElementById('sm-generate')?.addEventListener('click', () => generateSitemap());
  document.getElementById('sm-copy')?.addEventListener('click', function() { copyOutput('sm-output', this); });
  document.getElementById('sm-download')?.addEventListener('click', () => downloadFile('sm-output','sitemap.xml','application/xml'));

  // ── Security Headers panel
  ['sh-platform','sh-csp-preset'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => generateHeaders());
  });
  ['sh-hsts','sh-csp','sh-xframe','sh-xcontent','sh-referrer','sh-permissions','sh-corp'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => generateHeaders());
  });
  document.getElementById('sh-copy')?.addEventListener('click', function() { copyOutput('sh-output', this); });
  document.getElementById('sh-download')?.addEventListener('click', () => downloadHeadersFile());

  // ── Schema panel
  document.getElementById('sc-type')?.addEventListener('change', () => resetSchema());
  document.getElementById('sc-generate')?.addEventListener('click', () => generateSchema());
  document.getElementById('sc-copy')?.addEventListener('click', function() { copyOutput('sc-output', this); });
})();

// ── Init: run on page load ────────────────────────────────────────────────────
(function() {
  const params = new URLSearchParams(location.search);
  const tool = params.get('tool');
  if (tool && document.getElementById('panel-' + tool)) {
    switchTool(tool);
  } else {
    generateRobots();
    generateHeaders();
    resetSchema();
    updateSerpPreview();
  }
})();
