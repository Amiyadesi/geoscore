# Optional Service Checklist

Updated: 2026-09-16

GeoScore must complete deterministic audits when every optional provider is
offline. Provider absence, timeout, quota, or malformed data is reported as
`unknown` or `error` and is excluded from factual scores.

## Connected or credential-free

- Google PageSpeed Insights and Chrome UX Report
- W3C Nu HTML Checker
- Common Crawl index presence
- RDAP, DNS-over-HTTPS, certificate transparency, Wikipedia, and Wikidata
- OpenPageRank
- Cloudflare Workers AI, Browser Run binding, D1, KV, and Vectorize
- Protected Search Gateway for optional query research
- Generic OpenAI-compatible API, Groq, and OpenRouter fallbacks

## Retained but not run in the anonymous audit

The public `/api/meta` response lists these under
`capabilities.optional_modules_not_run`. Their source code is retained, but the
anonymous Cloudflare hot path reports them as `skipped`; they do not become
passes, failures, or score denominator weight:

- Keyword generation and AI content-insight modules
- Off-page SEO and backlink checks
- Full site-intelligence and domain-intelligence modules
- Redirect-chain crawling
- Mozilla Observatory (`security_audit`)
- Standalone SSL-certificate audit
- Broken-link crawling

Re-enabling any of these requires a separate budget, privacy, and evidence-quality
review. In particular, a crawler or provider outage must remain `unknown/error`
instead of being interpreted as a site defect.

## Manual account actions

### Google Web Risk

Requires a billing-enabled Google Cloud project even when usage stays inside a
free allowance. Before enabling it:

1. Review current pricing and quota in Google Cloud.
2. Create a billing budget and alert.
3. Create a server key restricted to Web Risk.
4. Add `GEOSCORE_WEB_RISK_API_KEY` to GitHub Actions and
   `WEB_RISK_API_KEY` to the Worker.
5. Add a monthly request counter and cache before production use.

### Google Search Console

The private owner dashboard uses read-only OAuth. It lists verified properties,
shows bounded 28-day Search Analytics, and inspects Google's indexed URL version.
It never changes the public audit score or grants anonymous access to owner data.

1. Verify the target property in
   [Google Search Console](https://search.google.com/search-console/).
2. In [Google Cloud Console](https://console.cloud.google.com/apis/library),
   create or select a project and enable **Google Search Console API**.
3. Configure the OAuth consent screen. Use an internal app when the account is
   managed by an eligible Workspace organization. Otherwise use external and
   add only the owner as a test user while setting up.
4. Create **Credentials → OAuth client ID → Web application**.
5. Add this exact Authorized redirect URI:
   `https://geo-api.sayori.org/api/admin/gsc/callback`
6. Save the client ID and secret as GitHub Actions repository secrets:
   `GEOSCORE_GSC_CLIENT_ID` and `GEOSCORE_GSC_CLIENT_SECRET`.
7. Apply migration `0006_google_search_console.sql` in the target D1 database.
8. Deploy `main`, open `https://geo.sayori.org/admin.html`, sign in with the
   allowlisted GitHub owner, then select **Connect Google Search Console**.

The Worker requests only
`https://www.googleapis.com/auth/webmasters.readonly`. The refresh token is
AES-GCM encrypted in D1 using a domain-separated key derived from
`ADMIN_SESSION_SECRET`; access tokens stay request-local. An external OAuth app
left in Google's **Testing** status receives refresh tokens that expire after
seven days for this scope, so publish/verify the app before relying on durable
monitoring.

### Google Analytics Data API (planned owner-only extension)

GA4 can explain whether an observed page receives real users, but it is not a
search-index or citation signal. Keep it separate from the public score. The
current code does not send GA4 requests yet.

To obtain access:

1. In [Google Analytics](https://analytics.google.com/), grant the owner account
   at least Viewer access to the GA4 property and note its numeric property ID.
2. In [Google Cloud API Library](https://console.cloud.google.com/apis/library),
   select a project and enable **Google Analytics Data API**.
3. For an owner console, use user OAuth with the read-only scope
   `https://www.googleapis.com/auth/analytics.readonly`. A service account is
   also supported, but it must be added as a Viewer on the GA4 property; never
   commit its JSON private key.
4. Keep the property ID and refresh token server-side. Do not put GA4 data in
   anonymous audits or use it to manufacture a ranking score.

Google's [Data API quickstart](https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart)
documents both user and service-account setup. Standard GA4 access is quota
bounded; confirm current quotas before enabling recurring reports.

### Bing Webmaster Tools

The API is a second owner-only discovery signal. GeoScore uses one API key for
the single-owner private dashboard; it is not wired into the anonymous audit.

1. Sign in to [Bing Webmaster Tools](https://www.bing.com/webmasters) with a
   Microsoft, Google, or Facebook ID.
2. Add and verify the site.
3. Open **Settings → API Access**, accept the terms, and choose **Generate API
   Key**. Microsoft states that one key is issued per user and can cover that
   user's verified sites.
4. Store it as Worker secret `BING_WEBMASTER_API_KEY` and GitHub Actions secret
   `GEOSCORE_BING_WEBMASTER_API_KEY`. If exposed, delete it in the same panel and
   generate a replacement.

See Microsoft's [API access guide](https://learn.microsoft.com/en-us/bingwebmaster/getting-access).
The owner dashboard lists only site URL and verification status, then reads
traffic and top-query statistics. Authentication and DNS verification codes
returned by Bing are intentionally discarded.

### DataForSEO SERP API (paid depth, not free audit)

Use this only for an explicitly paid, quota-metered SERP snapshot. It is not a
replacement for Search Console and must never be presented as a guaranteed
ranking result.

1. Create an account at [DataForSEO](https://app.dataforseo.com/register).
2. Open **API Access** and copy the generated API login and API password. The
   API password is separate from the account password.
3. Use HTTP Basic authentication over HTTPS; keep both values in Worker secrets
   or an equivalent server-side vault.
4. Start in the [Sandbox](https://docs.dataforseo.com/v3/appendix/sandbox/), then
   choose the cheaper **Standard** task method for non-live reports. Reserve
   **Live** tasks for a paid request that needs immediate data.
5. Add a credit ceiling, per-project quota, result cache, and dated provenance
   before exposing it to users. Do not run it on the free anonymous path.

The [SERP API overview](https://docs.dataforseo.com/v3/serp/overview/) documents
location/device parameters and Standard vs Live delivery. [Authentication](https://docs.dataforseo.com/v3/appendix/auth/)
uses a Base64-encoded `login:password` in the `Authorization` header. Pricing
changes; use the provider's [current pricing page](https://dataforseo.com/pricing/serp)
when setting a paid quota.

### Gemini

Optional only. Create a new AI Studio key after reviewing current free-tier data
terms. Never send private drafts, authenticated pages, or full audit JSON.

### GitHub Actions deployment

Local Wrangler OAuth can deploy production now. Automatic deploys from GitHub
need repository secrets `GEOSCORE_CF_ACCOUNT_ID` and
`GEOSCORE_CF_API_TOKEN`. Create a least-privilege Cloudflare token for Workers,
Pages, D1, KV, Vectorize, Browser Run, and route deployment.

### GitHub owner console

The private `/admin.html` console accepts only logins listed in
`ADMIN_GITHUB_LOGINS` (default: `Amiyadesi`). Create a GitHub OAuth App with:

- Homepage: `https://geo.sayori.org`
- Callback: `https://geo-api.sayori.org/api/admin/github/callback`

Set these Worker secrets before enabling the console:

```bash
wrangler secret put GITHUB_CLIENT_ID --config wrangler.generated.jsonc
wrangler secret put GITHUB_CLIENT_SECRET --config wrangler.generated.jsonc
wrangler secret put ADMIN_SESSION_SECRET --config wrangler.generated.jsonc
```

`ADMIN_SESSION_SECRET` signs the two-week `gs_admin` cookie. `ADMIN_TOKEN`
remains a compatible fallback for existing operator scripts.

## Privacy boundary

External LLMs receive only bounded excerpts from already-public pages. Never
send cookies, authorization headers, preview URLs, unpublished content, email
addresses, secrets, or complete stored audits.
