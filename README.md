# GeoScore - Evidence-First SEO and GEO Audit

<p align="center">
  <a href="https://geo.sayori.org">
    <img src="https://geo.sayori.org/og-image.svg" alt="GeoScore — Free SEO & AI Visibility Audit" width="100%"/>
  </a>
</p>

An open-source, evidence-first SEO and GEO audit service built on Cloudflare
Workers, Pages, D1, KV, Vectorize, Workers AI, and optional public evidence
providers. It reports what was observed, what could not be verified, and which
failed checks are worth fixing first.

**Live demo → [geo.sayori.org](https://geo.sayori.org)**  
**Example → [stripe.com audit](https://geo.sayori.org/?d=stripe.com)**

## Community acknowledgement

GeoScore recognizes the [LINUX DO community](https://linux.do/) for its open
source discussion and feedback culture. Community promotion posts should link
back here so readers can inspect the complete source, license, and audit
limitations.

GeoScore 2.2 is evidence-first: site mode builds a site profile and deterministically
samples at most five HTML pages (home, About when found, and representative page
types). URL mode audits one requested URL and reads the homepage only when it is
needed for context. Scores are published only from known, applicable checks;
unknown, provider errors, and not-applicable checks do not become zeroes. Raw
weighted scores are then limited by critical, major, and minor failures plus
evidence coverage and confidence, so a serious known failure cannot still receive
an A-range result.

---

## What the anonymous audit actually checks

GeoScore 2.2 exposes a normalized registry of **60 factual checks**: **54 scoring
checks** and **6 informational checks**. A separate **Predicted** simulation has
weight zero. `/api/meta` is the runtime source of truth for these counts.

| Category | Evidence collected |
|---|---|
| **Discovery and transport** | Public fetch status, HTTPS, indexability, robots.txt, sitemap, canonical, language, hreflang, response time, compression, HTML weight, DOM size, render-blocking scripts, and selected response headers |
| **Page semantics** | Title and description presence/length, H1 and heading hierarchy, internal links, Open Graph, image alt text/dimensions/responsive candidates, and cross-page title consistency |
| **Structured data and site profile** | Schema presence separately from archetype fit, site type, entity, business model, locale, root domain, page roles, confidence, and the evidence used for classification |
| **Mobile and accessibility** | Viewport, basic mobile usability, labels, landmarks, descriptive links, skip navigation, and image accessibility |
| **Performance** | CrUX field metrics plus PageSpeed/Lighthouse lab metrics. `/api/lighthouse?audit_id=...` merges successful evidence back into the stored audit and recalculates the same score |
| **Factual GEO readiness** | Entity identity/consistency, author attribution, extractability, direct-answer structure where applicable, claim/source linkage, statistic provenance, freshness, source links, and cross-page consistency |
| **Public discoverability evidence** | HTML conformance, RSS/Atom discovery, AI crawler policy, llms.txt presence, domain-matched knowledge-graph evidence, and Common Crawl capture presence |

The report shows three evidence-backed priority actions on screen. The primary
download produces one deterministic `GEOSCORE-REPAIR-<domain>.md` containing all
failed checks, unknown/error evidence, not-applicable and informational summaries,
optional modules that were not run, score caps, verification steps, and one
provider-neutral handoff prompt. It does not require an AI call. Per-item AI
FixPacks remain available only as optional advanced details for stored failures.

### Retained code that is not run in the anonymous hot path

The repository still contains upstream/legacy modules for keyword generation,
AI content insights, off-page SEO/backlink work, full site intelligence, redirect
chains, Mozilla Observatory security auditing, standalone SSL/domain intelligence,
and broken-link crawling. GeoScore 2.2 reports these modules as `skipped` in the
anonymous audit to keep the Cloudflare request budget bounded. They do not enter
the scoring denominator and are not presented as passes. This preserves useful
upstream work without claiming evidence that was never collected.

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

For GitHub Actions deployment, create an account-scoped Cloudflare API token
with access to the account that owns the Worker. The workflow verifies access
to D1, Workers KV, Vectorize, Workers Scripts, and Cloudflare Pages before it
makes changes. Add the token as `GEOSCORE_CF_API_TOKEN` and the account ID as
`GEOSCORE_CF_ACCOUNT_ID`; add Workers Routes or DNS permissions only when your
fork also manages those resources.

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

# Vectorize index used by the current embedding model
npx wrangler vectorize create audit-vectors --dimensions=384 --metric=cosine
```

---

### Step 4 — Configure Cloudflare resources

Run `npm run prepare:cloudflare`. It discovers or creates the named resources
and writes their IDs to ignored `wrangler.generated.jsonc`. Update the public
URLs and `NOMINATIM_USER_AGENT` in `wrangler.jsonc` before deploying a fork.

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

GeoScore applies its own configurable daily budget below the account allowance.
Each eligible audit reserves a bounded attempt in `BUDGET_KV` before invoking
the binding. Quota exhaustion, KV failure, timeout, rate limiting, malformed
responses, and target-page HTTP errors remain structured `unknown/error`
evidence; they never become a successful empty page. Check current Browser
Rendering limits in Cloudflare's documentation before changing the budget.

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
LLM calls use the KV cache first, then Workers AI. When both the generic API
configuration and Groq are healthy, a stable request hash chooses one of them;
OpenRouter is considered only when neither primary external entry is available.
A request calls at most one external entry, so failures never cascade through
multiple quotas. All of these paths are optional and non-authoritative.

```bash
npx wrangler secret put API_KEY --config wrangler.generated.jsonc
npx wrangler secret put API_BASE_URL --config wrangler.generated.jsonc
npx wrangler secret put API_MODEL --config wrangler.generated.jsonc
npx wrangler secret put GROQ_API_KEY --config wrangler.generated.jsonc
npx wrangler secret put OPENROUTER_API_KEY --config wrangler.generated.jsonc
```

The deployment workflow accepts optional GitHub Actions secrets
`GEOSCORE_API_KEY`, `GEOSCORE_API_BASE_URL`, `GEOSCORE_API_MODEL`,
`GEOSCORE_GROQ_API_KEY`, and `GEOSCORE_OPENROUTER_API_KEY`. Missing optional
secrets do not block deployment and leave existing Worker secrets unchanged.
Remove a retired value explicitly with `wrangler secret delete`; no key,
endpoint, or model belongs in tracked files or public frontend state.

---

## Environment variables reference

| Variable | Required | Description |
|---|---|---|
| `NOMINATIM_USER_AGENT` | Yes | Your app name + contact email for OpenStreetMap geocoding API |
| `SEARXNG_URL` | No | URL of a SearXNG search instance |
| `SEARCH_GATEWAY_URL` | No | URL of the protected Search Gateway used for keyword evidence |
| `DAILY_BROWSER_BUDGET_SECONDS` | No | Operator-defined daily Browser Run reservation budget |
| `ADMIN_TOKEN` | Recommended for production | Protects debug/admin endpoints and enables operator-only rate-limit bypass |
| `GOOGLE_API_KEY` | No | Chrome UX Report API key |
| `PAGESPEED_API_KEY` | No | PageSpeed Insights / Lighthouse API key |
| `OPENPAGERANK_KEY` | No | OpenPageRank authority data |
| `RESEND_API_KEY` | No | Resend API key for weekly monitoring alert emails |
| `SEARCH_GATEWAY_API_KEY` | No | API key sent as `X-API-Key` to the protected Search Gateway |
| `API_KEY` | No | Worker-only generic external LLM fallback; never passed to a client or public report |
| `API_BASE_URL` | With `API_KEY` | Worker-only OpenAI-compatible base URL |
| `API_MODEL` | With `API_KEY` | Worker-only model identifier for the generic API |
| `GROQ_API_KEY` | No | Optional primary external LLM entry; non-authoritative |
| `OPENROUTER_API_KEY` | No | Optional reserve external LLM entry; non-authoritative |

See [docs/manual-service-actions.md](./docs/manual-service-actions.md) for
optional integrations that require billing, OAuth, verified ownership, or a
new account credential.

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
│   │   ├── geo_predicted.ts  # Predicted visibility simulation
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

## Cloudflare usage boundaries

The implementation keeps crawls, browser rendering, subrequests, and model
calls bounded so it can operate on low-cost Cloudflare plans. Cloudflare limits
change over time; check the current product documentation before production
deployment. Optional providers fail open and never determine factual scores.

---

## License and attribution

MIT. See [LICENSE](./LICENSE) and
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). This project is derived
from [`sprawf/geoscore`](https://github.com/sprawf/geoscore).
