# GeoScore - Evidence-First SEO and GEO Audit

[中文 README](./README.zh-CN.md) · English

<p align="center">
  <a href="https://geo.sayori.org">
    <img src="https://geo.sayori.org/og-image.svg" alt="GeoScore — Evidence-based SEO and GEO audit" width="100%"/>
  </a>
</p>

An open-source, evidence-first SEO and GEO audit service built on Cloudflare
Workers, Pages, D1, KV, Vectorize, Workers AI, and optional public evidence
providers. It reports what was observed, what could not be verified, and which
failed checks are worth fixing first.

Search engines, regions, and individual queries use different ranking systems.
GeoScore therefore provides evidence-based optimization guidance, not a ranking
forecast or guarantee. A higher readiness score means more of the checks GeoScore
could verify passed; it does not promise a particular search position.

**Live demo → [geo.sayori.org](https://geo.sayori.org)**  
**Documentation → [geo.sayori.org/docs](https://geo.sayori.org/docs)**  
**OpenAPI → [geo-api.sayori.org/openapi.json](https://geo-api.sayori.org/openapi.json)**  
**Example → [stripe.com audit](https://geo.sayori.org/?d=stripe.com)**

## Community acknowledgement

GeoScore recognizes the [LINUX DO community](https://linux.do/) for its open
source discussion and feedback culture. Community promotion posts should link
back here so readers can inspect the complete source, license, and audit
limitations.

GeoScore 2.4.8 is evidence-first: site mode builds a site profile and deterministically
samples at most five HTML pages (home, About when found, and representative page
types). URL mode audits one requested URL and reads the homepage only when it is
needed for context. Scores are published only from known, applicable checks;
unknown, provider errors, and not-applicable checks do not become zeroes. Raw
weighted scores are then limited by critical, major, and minor failures plus
evidence coverage and confidence, so a serious known failure cannot still receive
an A-range result.

If a fresh audit is interrupted, GeoScore keeps verified module results for 30
minutes. A retry refetches the sampled pages, reuses page-dependent evidence only
when their semantic fingerprints still match, and reruns failed, skipped, or stale
modules. Repeated attempts can therefore complete one audit without treating old
page evidence as current.

---

## What the anonymous audit actually checks

GeoScore 2.4.8 exposes a normalized registry of **60 factual checks**: **54 scoring
checks** and **6 informational checks**. A separate **Predicted** simulation has
weight zero. `/api/meta` is the runtime source of truth for these counts.

| Category | Evidence collected |
|---|---|
| **Discovery and transport** | Public fetch status, HTTPS, indexability, robots.txt, sitemap, canonical, language, hreflang, response time, compression, HTML weight, DOM size, render-blocking scripts, and selected response headers |
| **Page semantics** | Title and description presence/length, H1 and heading hierarchy, internal links, Open Graph, image alt text/dimensions/responsive candidates, and cross-page title consistency |
| **Structured data and site profile** | Schema presence separately from archetype fit, site type, entity, business model, locale, root domain, page roles, confidence, and the evidence used for classification |
| **Mobile and accessibility** | Viewport, basic mobile usability, labels, landmarks, descriptive links, skip navigation, and image accessibility |
| **Performance** | CrUX field metrics plus PageSpeed/Lighthouse lab metrics. `/api/lighthouse?audit_id=...` merges successful evidence back into the stored audit and recalculates the same score |
| **Factual GEO readiness** | Entity identity/consistency, article-level content responsibility, extractability, direct-answer structure where applicable, same-block claim/citation proximity, statistic provenance, freshness, source links, and cross-page consistency |
| **Public discoverability evidence** | HTML conformance, RSS/Atom discovery, AI crawler policy, llms.txt presence, domain-matched knowledge-graph evidence, and Common Crawl capture presence |

The report shows three evidence-backed priority actions on screen. The primary
download produces one deterministic `GEOSCORE-REPAIR-<domain>.md` containing all
failed checks, unknown/error evidence, not-applicable and informational summaries,
optional modules that were not run, score caps, verification steps, and two
provider-neutral handoff briefs. The content AI brief contains only applicable
failed content checks and asks for evidence-bound candidate edits. The developer
AI brief contains metadata, schema, crawling, performance, and other code or
configuration work. Neither brief requires an AI call, generates a full replacement
article, or publishes changes. Per-item AI FixPacks remain available only as
optional advanced details for stored failures.

Content responsibility is evaluated only for sampled article pages. Homepages,
documentation, product, category, contact, and ordinary portfolio pages are not
asked to add an author merely for a score. A personal blog can use its trusted
site-level `Person` identity, while an editorial or news article can identify a
truthful author or responsible publisher.

### Evidence Map and accountless monitoring

The Evidence Map turns a completed audit into at most three bounded queries. A
protected Search Gateway can collect dated search evidence from up to two
providers per query, while one optional answer provider can produce a clearly
labelled API answer snapshot. These observations are provenance data, not proof
of a real consumer-product citation, and they never change the factual SEO/GEO
score.

One of those three queries is a brand-free field probe, and the snapshot reports
the vaguest rung where the audited root was still observed — the anchoring
boundary, not a ranking. See
[docs/entity-anchoring-ladder.md](./docs/entity-anchoring-ladder.md) for the rung
model, its guardrails, and the planned entity audit mode.

Monitoring does not require an account. Project creation returns a high-entropy
management token once; D1 stores only a versioned, peppered HMAC plus a short
display hint. The project keeps at most 12 real snapshots and runs weekly. A
request-scoped BYOK value is forwarded for one answer request only and is never
stored in D1, KV, URLs, reports, or frontend persistence.

Email alerts require a verified address. Baseline establishment, score-version
changes, and insufficient coverage/confidence suppress comparisons. For a
comparable non-zero factual score change, the run and dated snapshot are stored
before the primary mail channel is called, and delivery status is written separately so provider
failure cannot erase a completed monitoring run. A project owner can retry a
failed delivery through the run-scoped alert endpoint; the run ID is reused as
the primary provider idempotency key. A fixed-sender `/v1/messages` service can
act as a server-only fallback for authentication, rate-limit, network, and
upstream failures. Rejected message parameters are not blindly retried.

### Private owner Search Console

The GitHub-allowlisted `/admin.html` dashboard can connect one Google Search
Console account with the read-only `webmasters.readonly` scope. It lists verified
properties, shows bounded 28-day Search Analytics, and checks Google's indexed
version of a URL. Encrypted owner tokens and results never enter anonymous audit
scores. Setup is documented in
[docs/manual-service-actions.md](./docs/manual-service-actions.md#google-search-console).

### Retained code that is not run in the anonymous hot path

The repository still contains upstream/legacy modules for keyword generation,
AI content insights, off-page SEO/backlink work, full site intelligence, redirect
chains, Mozilla Observatory security auditing, standalone SSL/domain intelligence,
and broken-link crawling. GeoScore 2.4.8 reports these modules as `skipped` in the
anonymous audit to keep the Cloudflare request budget bounded. They do not enter
the scoring denominator and are not presented as passes. This preserves useful
upstream work without claiming evidence that was never collected. They live in
[`src/modules/legacy/`](./src/modules/legacy/README.md), which records each
module and the reason it is not run.

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

Run the local validation suite before deployment:

```bash
npm run check
npm test
npm run test:e2e:install
npm run test:e2e
npm run calibrate:live -- --strict
```

The Playwright suite uses deterministic API fixtures and covers English and Chinese desktop/mobile flows. It does not consume production audit or Browser Run quotas.
The live calibration command fetches a bounded matrix of public sites and fails
when a reachable site is classified outside its reviewed archetype set. Network
timeouts, bot challenges, consent pages, and oversized responses remain explicit
`unavailable` results instead of false classifications.

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

The 20-second fallback budget is divided between page navigation, a short
post-load render settle, and HTML capture. GeoScore waits for the page `load`
event instead of background network idleness, so analytics polling and long-lived
requests cannot consume the entire attempt while ordinary hydration still gets a
bounded window to finish.

GeoScore applies its own configurable daily budget below the account allowance.
Each eligible audit reserves a bounded attempt in `BUDGET_KV` before invoking
the binding. Quota exhaustion, KV failure, timeout, rate limiting, malformed
responses, and target-page HTTP errors remain structured `unknown/error`
evidence; they never become a successful empty page. Check current Browser
Rendering limits in Cloudflare's documentation before changing the budget.

### Accountless evidence monitoring and email alerts

Monitoring captures weekly dated Evidence Map snapshots against the latest
compatible completed audit. It does not claim to re-run every audit module or
observe a consumer answer-engine UI. Generate a private token pepper of at least
32 characters and configure it together with an optional primary mail key. A
fixed-sender service can be configured as a fallback:

```bash
npx wrangler secret put MONITOR_TOKEN_PEPPER --config wrangler.generated.jsonc
npx wrangler secret put RESEND_API_KEY --config wrangler.generated.jsonc
npx wrangler secret put CF_TEMP_MAIL_BASE_URL --config wrangler.generated.jsonc
npx wrangler secret put CF_TEMP_MAIL_SEND_API_KEY --config wrangler.generated.jsonc
```

Do not configure the inbox API key in the Worker; inbox creation and reads are
reserved for local authorized QA.

The GitHub Actions deployment maps `GEOSCORE_MONITOR_TOKEN_PEPPER` to the Worker
secret `MONITOR_TOKEN_PEPPER`. Losing the one-time project management token means
the project cannot be recovered; rotate it while the current token is still
available or create a new monitoring project.

### Search Gateway / SearXNG (fallback search)

For keyword research, the tool can optionally call a protected Search Gateway
fronting [SearXNG](https://searxng.org/) and other providers. Set the gateway
URL in `wrangler.jsonc` or `wrangler.toml`, then set the API key as a Worker
secret:

```toml
SEARCH_GATEWAY_URL = "https://gateway.sayori.org"
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

### Error monitoring (optional)

The Worker exports one OpenTelemetry exception span per unhandled request or
scheduled-run failure to [SigNoz](https://signoz.io). Routes that stream audit
results keep owning their own error envelopes; only failures that would otherwise
become an opaque 500 reach the exporter.

```bash
npx wrangler secret put SIGNOZ_INGESTION_KEY --config wrangler.generated.jsonc
```

Set `SIGNOZ_OTLP_ENDPOINT` to your region's ingestion host (for example
`https://ingest.us2.signoz.cloud`) in `wrangler.jsonc`; the exporter appends
`/v1/traces`. Leave either value empty to disable reporting — the Worker then
behaves exactly as it did before. The ingestion key is sent only as the
`signoz-ingestion-key` header and is never written to a payload, log line,
report, or frontend state. For local development put both values in the
git-ignored `.dev.vars` file.

The GitHub Actions deployment maps the optional `GEOSCORE_SIGNOZ_INGESTION_KEY`
secret to the Worker secret `SIGNOZ_INGESTION_KEY`.

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
| `CF_TEMP_MAIL_BASE_URL` | With fallback mail | HTTPS base URL for the fixed-sender service; `/v1/messages` is added automatically |
| `CF_TEMP_MAIL_SEND_API_KEY` | With fallback mail | Server-only fixed-sender key; never expose the inbox API key to the Worker |
| `SEARCH_GATEWAY_API_KEY` | No | API key sent as `X-API-Key` to the protected Search Gateway |
| `MONITOR_TOKEN_PEPPER` | Required for monitoring | At least 32 characters; used to HMAC one-time project and email-verification tokens before D1 storage |
| `API_KEY` | No | Worker-only generic external LLM fallback; never passed to a client or public report |
| `API_BASE_URL` | With `API_KEY` | Worker-only OpenAI-compatible base URL |
| `API_MODEL` | With `API_KEY` | Worker-only model identifier for the generic API |
| `GROQ_API_KEY` | No | Optional primary external LLM entry; non-authoritative |
| `OPENROUTER_API_KEY` | No | Optional reserve external LLM entry; non-authoritative |
| `SIGNOZ_OTLP_ENDPOINT` | No | SigNoz OTLP ingestion host; reporting is disabled when empty |
| `SIGNOZ_INGESTION_KEY` | With `SIGNOZ_OTLP_ENDPOINT` | Server-only SigNoz ingestion key; sent as the `signoz-ingestion-key` header |
| `SIGNOZ_SERVICE_NAME` | No | `service.name` reported to SigNoz (defaults to `sayori-geoscore-api`) |

See [docs/manual-service-actions.md](./docs/manual-service-actions.md) for
optional integrations that require billing, OAuth, verified ownership, or a
new account credential.

---

## Project structure

```
geoscore/
├── frontend/               # Static site (Cloudflare Pages)
│   ├── index.html          # Single-page app shell
│   ├── app.js              # Page orchestration and report rendering
│   ├── audit-runner.js     # SSE lifecycle, retry, and stale-event isolation
│   ├── assistant-ui.js     # Optional assistant panel
│   ├── competitor-ui.js    # Competitor comparison controller
│   ├── custom-api.js       # One-use custom API configuration
│   ├── evidence-map.js     # Evidence snapshot controller
│   ├── i18n.js             # English/Chinese UI copy
│   ├── monitoring.js       # Monitoring project controller
│   ├── report-ui.js        # Normalized report adapters and Markdown output
│   ├── report-export.js    # Download and printable export controller
│   ├── semantic-search.js  # Opt-in WebGPU semantic search
│   ├── site-pass.js        # Site Pass purchase and status
│   ├── tools.js            # Standalone public tools page
│   ├── globals.d.ts        # Shared controller globals used by checkJs
│   ├── cdn-modules.d.ts    # Declaration for the lazily imported CDN module
│   ├── docs/               # Bilingual public documentation
│   ├── print.css           # Print stylesheet
│   ├── _headers            # Cloudflare Pages HTTP headers
│   ├── _redirects          # Cloudflare Pages redirects
│   └── tsconfig.json       # checkJs program for the frontend controllers
│
├── src/
│   ├── index.ts            # Worker entry point, router, and error boundary
│   ├── lib/                # Shared helpers, including:
│   │   ├── audit-core.ts     # Checks, severities, and score policy
│   │   ├── audit-pages.ts    # Bounded page sampling and fetch
│   │   ├── bot-detection.ts  # WAF/CAPTCHA page detection
│   │   ├── cache.ts          # KV audit caching
│   │   ├── http.ts           # Fetch with timeout helper
│   │   ├── llm.ts            # Workers AI wrapper
│   │   ├── observability.ts  # Optional SigNoz exception export
│   │   ├── rate-limit.ts     # Per-IP rate limiting via KV
│   │   ├── security.ts       # CORS, admin gate, public-hostname rules
│   │   ├── sse.ts            # Server-Sent Events helpers
│   │   └── types.ts          # Shared TypeScript types (Env, etc.)
│   │
│   ├── modules/            # One file per audit module that runs
│   │   ├── accessibility.ts
│   │   ├── authority.ts
│   │   ├── content_quality.ts
│   │   ├── crux.ts           # Chrome UX Report (CrUX) API
│   │   ├── lighthouse.ts     # PageSpeed/Lighthouse merge
│   │   ├── on_page_seo.ts
│   │   ├── recommendations.ts
│   │   ├── resolver.ts
│   │   ├── schema_audit.ts
│   │   ├── technical_seo.ts
│   │   └── legacy/           # Retained modules reported as skipped
│   │
│   ├── prompts/            # AI prompt templates
│   │
│   └── routes/             # HTTP route handlers
│       ├── audit.ts        # Main audit orchestrator (SSE streaming)
│       ├── businesses.ts
│       ├── chat.ts         # AI chat about audit results
│       ├── evidence-map.ts # Bounded query evidence
│       ├── feedback.ts     # User corrections + learning
│       ├── fix.ts          # AI-generated fix guides
│       ├── history.ts      # Score history per domain
│       ├── llms_gen.ts     # llms.txt generator
│       ├── monitoring.ts   # Accountless monitoring projects
│       └── search.ts       # Domain search
│
├── migrations/             # D1 SQL schema migrations (0001–0005)
│
├── scripts/                # Wrangler prepare/deploy/calibration helpers
├── tests/                  # node:test suites and Playwright e2e specs
├── ui-worker/              # Custom-domain proxy Worker for geo.sayori.org
│
├── wrangler.jsonc          # Deployed Worker configuration
├── wrangler.toml.example   # Config template for a self-managed account
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
