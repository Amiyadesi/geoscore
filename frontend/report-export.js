(function (global) {
  'use strict';

  function create(options = {}) {
    const reportUi = options.reportUi;
    const getReportLanguage = options.getReportLanguage;
    const documentRef = options.document ?? global.document;
    const windowRef = options.window ?? global;
    const BlobRef = options.Blob ?? global.Blob;
    const URLRef = options.URL ?? global.URL;
    if (!reportUi || typeof getReportLanguage !== 'function' || !documentRef || !BlobRef || !URLRef) {
      throw new Error('GeoScore report export requires report, language, and browser dependencies');
    }

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
  return reportUi.generateFullRepairMarkdown(data, getReportLanguage());
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
  if (mods.technical_seo?.data && reportUi?.llmsTxtView?.(tech, getReportLanguage())?.state === 'missing') {
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
  const blob = new BlobRef([md], { type: 'text/markdown;charset=utf-8' });
  const url = URLRef.createObjectURL(blob);
  const a = documentRef.createElement('a');
  a.href = url;
  a.download = `GEOSCORE-REPAIR-${domain}.md`;
  documentRef.body.appendChild(a);
  a.click();
  setTimeout(() => { documentRef.body.removeChild(a); URLRef.revokeObjectURL(url); }, 500);
}

// ── Formatted PDF Report Window ───────────────────────────────────────────

function openReportWindow(data) {
  const domain = data?.domain ?? '';
  const scoreSummary = reportUi?.normalizeScoreSummary(data) ?? {};
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

  const w = windowRef.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
}

    return Object.freeze({
      generateMarkdown: generateAgentMarkdown,
      download: downloadAgentMarkdown,
      open: openReportWindow,
    });
  }

  global.GeoScoreReportExport = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
