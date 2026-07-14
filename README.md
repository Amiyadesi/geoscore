# GeoScore — SEO & AI Visibility Audit Tool

> **Private operational repository.** See [LICENSE-STATUS.md](./LICENSE-STATUS.md)
> before redistributing this derivative.

<p align="center">
  <a href="https://geo.sayori.org">
    <img src="https://geo.sayori.org/og-image.svg" alt="GeoScore — Free SEO & AI Visibility Audit" width="100%"/>
  </a>
</p>

A free SEO and AI-visibility audit service that analyses any website in under 60 seconds. Built entirely on **Cloudflare's free tier** (Workers, Pages, D1, KV, Vectorize, Workers AI). This derivative's source is private while upstream redistribution terms remain unresolved.

**Live demo → [geo.sayori.org](https://geo.sayori.org)**  
**Example → [stripe.com audit](https://geo.sayori.org/?d=stripe.com)**

GeoScore 2.0 is evidence-first: site mode builds a site profile and deterministically
samples at most five HTML pages (home, About when found, and representative page
types). URL mode audits one requested URL and reads the homepage only when it is
needed for context. Scores are published only from known, applicable checks;
unknown, provider errors, and not-applicable checks do not become zeroes.

---

## What it audits

| Category | What's checked |
|---|---|
| **Technical SEO** | Crawlability, canonical, hreflang, sitemap, robots.txt, security headers, page weight, render-blocking scripts |
| **On-Page SEO** | Title, meta description, headings, internal links, PageSpeed / Core Web Vitals (mobile + desktop) |
| **Schema Markup** | JSON-LD detection, coverage gaps, e-commerce schema audit |
| **Content Quality** | Word count, readability (Flesch), keyword density, FAQ detection |
| **Off-Page SEO** | Backlink signals, social profile detection, SPF/DMARC/DKIM email security |
| **Domain Authority** | Domain age, Wikipedia/Wikidata presence, backlink sample |
| **AI Visibility (GEO)** | Citation prediction — simulates whether ChatGPT/Claude/Perplexity would cite your site for relevant queries |
| **Keywords** | Opportunity keywords by intent (informational, commercial, transactional) with geo-potential flags |
| **Accessibility** | WCAG 2.1 A/AA checks — alt text, labels, skip links, landmarks, heading hierarchy |
| **Security Audit** | CSP, HSTS, X-Frame-Options, referrer policy, SSL certificate validity |
| **Site Intelligence** | IP, hosting org, CDN, DNS, MX, carbon footprint estimate |
| **Redirect Chain** | Hop count, HTTPS redirect, www/non-www normalisation |

**Computed cards** (assembled from module data):
- SERP snippet preview & character-count warnings
- Social share card (OG/Twitter) with completeness audit
- E-E-A-T scorecard
- Technology stack (Wappalyzer-style)
- Readability score
- Font performance
- DNS & network
- AI Content Insights (business context, trust scores, freshness, opportunities)
- llms.txt generator

---

## Architecture

```
┌──────────────────────┐     SSE stream      ┌──────────────────────┐
│  Cloudflare Pages    │ ◄──────────────────  │  Cloudflare Worker   │
│  (frontend/*)        │                      │  (src/index.ts)      │
│  Static HTML + JS    │  REST + SSE          │                      │
└──────────────────────┘                      │  ┌────────────────┐  │
                                              │  │  D1 (SQLite)   │  │
                                              │  │  KV (cache)    │  │
                                              │  │  Vectorize     │  │
                                              │  │  Workers AI    │  │
                                              │  └────────────────┘  │
                                              └──────────────────────┘
```

Most audit modules run in parallel. The Workers AI modules run before the fetch-heavy audit batch so they do not get starved by the Worker subrequest budget. Results stream back to the browser via **Server-Sent Events** so the UI fills in card by card as checks complete.

---

## Fork & Deploy in ~10 minutes

### Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier is enough)
- [Node.js](https://nodejs.org/) 18+ (for Wrangler CLI)
- [Git](https://git-scm.com/)

---

### Step 1 — Clone & install

```bash
git clone https://github.com/YOUR_USERNAME/geoscore.git
cd geoscore
npm install
```

---

### Step 2 — Authenticate Wrangler

```bash
npx wrangler login
```

This opens a browser window to authorise Wrangler with your Cloudflare account.

---

### Step 3 — Create Cloudflare resources

Run each command and **note the IDs** printed — you'll need them in Step 4.

```bash
# D1 database
npx wrangler d1 create audit-db

# KV namespaces
npx wrangler kv namespace create AUDIT_KV
npx wrangler kv namespace create BUDGET_KV

# Vectorize index (768 dims = Workers AI embedding size)
npx wrangler vectorize create audit-vectors --dimensions=768 --metric=cosine
```

---

### Step 4 — Configure wrangler.toml

```bash
cp wrangler.toml.example wrangler.toml
```

Open `wrangler.toml` and replace the placeholder values with the IDs from Step 3:

```toml
[[d1_databases]]
database_id = "YOUR_D1_DATABASE_ID"    # ← paste here

[[kv_namespaces]]
binding = "AUDIT_KV"
id = "YOUR_AUDIT_KV_ID"               # ← paste here

[[kv_namespaces]]
binding = "BUDGET_KV"
id = "YOUR_BUDGET_KV_ID"              # ← paste here
```

Also update the `NOMINATIM_USER_AGENT` variable with your own contact info (required by OpenStreetMap's terms of use):

```toml
[vars]
NOMINATIM_USER_AGENT = "YourAppName/1.0 (you@yourdomain.com)"
```

> **Note:** `wrangler.toml` is in `.gitignore` so your IDs are never committed. Only `wrangler.toml.example` is tracked.

---

### Step 5 — Apply database migrations

```bash
# Local development
npm run db:migrate:local

# Remote (production)
npm run db:migrate
```

---

### Step 6 — Point the frontend at your Worker

Open `frontend/app.js` and update the production Worker URL:

```javascript
// Change this:
const PRODUCTION_API = 'https://geo-api.sayori.org';

// To your Worker's URL (you get this after deploying in Step 7):
const PRODUCTION_API = 'https://audit-api.YOUR_SUBDOMAIN.workers.dev';
```

> **Tip:** Your Cloudflare subdomain is shown at `dash.cloudflare.com → Workers & Pages → Overview`.

---

### Step 7 — Deploy

```bash
# Deploy the Worker (backend)
npm run deploy

# Deploy the frontend to Cloudflare Pages
npm run deploy:pages
```

The first `deploy:pages` run will prompt you to create a new Pages project — just accept the defaults.

Your audit tool is now live at `https://audit-api.YOUR_SUBDOMAIN.workers.dev` (API) and the URL printed by the Pages deploy command (frontend).

---

### Step 8 (optional) — Local development

```bash
npm run dev
```

This starts a local Wrangler dev server at `http://127.0.0.1:8787`. When the frontend is opened from `file:`, `localhost`, or `127.0.0.1`, it automatically talks to that local Worker; production hosts continue to use `PRODUCTION_API`.

The default local command does not opt into remote Browser Run. To exercise the
live `BROWSER` Quick Action binding intentionally, use Wrangler remote mode:

```bash
npx wrangler dev --config wrangler.jsonc --remote
```

This consumes the Cloudflare account's Browser Run allowance, so do not use it in
routine unit tests.

---

## Optional features

### Cloudflare Browser Run fallback

The primary audit page is fetched with normal HTTP first. When that produces a
recognized bot challenge, a retryable network/HTTP failure, or a JavaScript shell
without extractable content, GeoScore can make one guarded Browser Run Quick
Action attempt. Sampled representative pages are never browser-rendered.

The Worker binding is configured directly in `wrangler.jsonc`:

```json
"browser": { "binding": "BROWSER" }
```

The deployment generator copies `wrangler.jsonc` to `wrangler.generated.jsonc`
while replacing only resource IDs, so the binding is preserved automatically.
The binding does not require a Browser Rendering REST API token or Worker secret.

Workers Free currently includes 10 browser minutes per day. GeoScore clamps its
configured allowance to 540 seconds/day, leaving 60 seconds of headroom for up to
three concurrent 20-second reservations. Each eligible audit reserves 20 seconds
in `BUDGET_KV` before invoking the binding. Quota exhaustion, KV failure, timeout,
rate limiting, malformed responses, and target-page HTTP errors remain structured
`unknown/error` evidence; they never become a successful empty page.

### Email alerts (weekly score monitoring)

The tool has a built-in monitoring system that re-audits subscribed domains weekly and emails if the score changes ≥5 points. It uses [Resend](https://resend.com) (free tier: 3,000 emails/month).

1. Sign up at [resend.com](https://resend.com) and get an API key
2. Add it as a secret (never put it in `wrangler.toml`):

```bash
npx wrangler secret put RESEND_API_KEY
```

### Search Gateway / SearXNG (fallback search)

For keyword research, the tool can optionally call a protected Search Gateway
fronting [SearXNG](https://searxng.org/) and other providers. Set the gateway
URL in `wrangler.jsonc` or `wrangler.toml`, then set the API key as a Worker
secret:

```toml
SEARCH_GATEWAY_URL = "https://search.sayori.org"
```

```bash
npx wrangler secret put SEARCH_GATEWAY_API_KEY --config wrangler.generated.jsonc
```

`SEARXNG_URL` is still supported as a direct fallback URL. Leave both URLs or
the secret empty to skip search enrichment; the keyword module will continue to
use Workers AI and content-derived fallbacks.

### Optional external LLM fallbacks

Deterministic audit checks and recommendation templates remain authoritative.
LLM calls use the KV cache first, then Workers AI, then exactly one optional
external provider: generic `API_KEY` when configured, otherwise Groq when
`GROQ_API_KEY` is configured, otherwise OpenRouter when
`OPENROUTER_API_KEY` is configured. A failed external request does not cascade
into another provider, which keeps each audit's provider budget bounded.

OpenRouter uses the dynamic `openrouter/free` route. Free-model availability,
privacy terms, and limits can change; the documented baseline is 20 requests per
minute and 50 free-model requests per day for accounts with less than USD 10 in
purchased credits. Treat it as a low-volume fallback, send only excerpts from
already-public pages, and never depend on it for deterministic scoring.

```bash
npx wrangler secret put API_KEY --config wrangler.generated.jsonc
npx wrangler secret put GROQ_API_KEY --config wrangler.generated.jsonc
npx wrangler secret put OPENROUTER_API_KEY --config wrangler.generated.jsonc
```

The deployment workflow accepts optional GitHub Actions secrets
`GEOSCORE_GROQ_API_KEY` and `GEOSCORE_OPENROUTER_API_KEY`. Missing either secret
prints a notice and does not block deployment. It also leaves any previously
uploaded Worker secret unchanged. `API_KEY` is intentionally configured directly
in the Worker and not mirrored into GitHub Actions; remove it explicitly with
`wrangler secret delete API_KEY --config wrangler.generated.jsonc` when rotating
or disabling it. No key belongs in tracked files or public frontend state.

---

## Environment variables reference

| Variable | Required | Description |
|---|---|---|
| `NOMINATIM_USER_AGENT` | Yes | Your app name + contact email for OpenStreetMap geocoding API |
| `SEARXNG_URL` | No | URL of a SearXNG search instance |
| `SEARCH_GATEWAY_URL` | No | URL of the protected Search Gateway used for keyword evidence |
| `DAILY_BROWSER_BUDGET_SECONDS` | No | Max reserved Browser Run seconds/day, clamped to 540 (60-second free-tier headroom) |
| `ADMIN_TOKEN` | Recommended for production | Protects debug/admin endpoints and enables operator-only rate-limit bypass |
| `GOOGLE_API_KEY` | No | Chrome UX Report API key |
| `PAGESPEED_API_KEY` | No | PageSpeed Insights / Lighthouse API key |
| `OPENPAGERANK_KEY` | No | OpenPageRank authority data |
| `RESEND_API_KEY` | No | Resend API key for weekly monitoring alert emails |
| `SEARCH_GATEWAY_API_KEY` | No | API key sent as `X-API-Key` to the protected Search Gateway |
| `API_KEY` | No | Worker-only generic external LLM fallback; never passed to a client or public report |
| `GROQ_API_KEY` | No | Preferred external LLM fallback after Workers AI; optional and non-authoritative |
| `OPENROUTER_API_KEY` | No | Low-volume `openrouter/free` fallback used only when Groq is not configured |

---

## Project structure

```
geoscore/
├── frontend/               # Static site (Cloudflare Pages)
│   ├── index.html          # Single-page app shell
│   ├── app.js              # All UI logic (~3 700 lines)
│   ├── print.css           # Print stylesheet
│   ├── _headers            # Cloudflare Pages HTTP headers
│   └── _redirects          # Cloudflare Pages redirects
│
├── src/
│   ├── index.ts            # Worker entry point & router
│   ├── lib/
│   │   ├── bot-detection.ts  # WAF/CAPTCHA page detection
│   │   ├── cache.ts          # KV audit caching
│   │   ├── http.ts           # Fetch with timeout helper
│   │   ├── llm.ts            # Workers AI wrapper
│   │   ├── rate-limit.ts     # Per-IP rate limiting via KV
│   │   ├── sse.ts            # Server-Sent Events helpers
│   │   └── types.ts          # Shared TypeScript types (Env, etc.)
│   │
│   ├── modules/            # One file per audit module
│   │   ├── accessibility.ts
│   │   ├── ai_content_insights.ts
│   │   ├── authority.ts
│   │   ├── content_quality.ts
│   │   ├── crux.ts           # Chrome UX Report (CrUX) API
│   │   ├── domain_intel.ts
│   │   ├── geo_predicted.ts  # AI citation prediction
│   │   ├── keywords.ts
│   │   ├── off_page_seo.ts
│   │   ├── on_page_seo.ts
│   │   ├── recommendations.ts
│   │   ├── redirect_chain.ts
│   │   ├── resolver.ts
│   │   ├── schema_audit.ts
│   │   ├── security_audit.ts
│   │   ├── site_intel.ts
│   │   ├── ssl_cert.ts
│   │   └── technical_seo.ts
│   │
│   ├── prompts/            # AI prompt templates
│   │
│   └── routes/             # HTTP route handlers
│       ├── audit.ts        # Main audit orchestrator (SSE streaming)
│       ├── businesses.ts
│       ├── chat.ts         # AI chat about audit results
│       ├── feedback.ts     # User corrections + learning
│       ├── fix.ts          # AI-generated fix guides
│       ├── history.ts      # Score history per domain
│       ├── llms_gen.ts     # llms.txt generator
│       └── search.ts       # Domain search
│
├── migrations/             # D1 SQL schema migrations
│   ├── 0001_init.sql
│   ├── 0002_seed_uae.sql
│   └── 0003_learning.sql
│
├── wrangler.toml.example   # Config template (copy → wrangler.toml)
├── tsconfig.json
└── package.json
```

---

## Cloudflare free tier limits

This project is designed to run comfortably within Cloudflare's free tier:

| Resource | Free limit | Typical usage |
|---|---|---|
| Workers requests | 100,000/day | ~1 request per audit |
| Workers CPU time | 10ms per request | Each module is async I/O, minimal CPU |
| D1 reads | 5M/day | ~50 reads per audit |
| D1 writes | 100K/day | ~5 writes per audit |
| KV reads | 100K/day | 1–2 reads per audit (cache check) |
| KV writes | 1,000/day | 1 write per audit (cache store) |
| Workers AI | ~10K neurons/day | Used for keyword + GEO + AI insights modules |
| Pages builds | 500/month | 1 per frontend deploy |

For high-traffic use, the AI modules (geo_predicted, keywords, ai_content_insights) are the first to hit limits. They fall back gracefully when quota is exceeded.

---

## License

This derivative is not currently licensed for redistribution. See [LICENSE-STATUS.md](./LICENSE-STATUS.md) before copying, publishing, or accepting contributions.
