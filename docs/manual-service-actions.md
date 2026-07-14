# Optional Service Checklist

Updated: 2026-07-14

GeoScore must complete deterministic audits when every optional provider is
offline. Provider absence, timeout, quota, or malformed data is reported as
`unknown` or `error` and is excluded from factual scores.

## Connected or credential-free

- Google PageSpeed Insights and Chrome UX Report
- W3C Nu HTML Checker
- Common Crawl index presence
- Mozilla Observatory
- RDAP, DNS-over-HTTPS, certificate transparency, Wikipedia, and Wikidata
- OpenPageRank
- Cloudflare Workers AI, Browser Run binding, D1, KV, and Vectorize
- Protected Search Gateway for optional query research
- Generic OpenAI-compatible API, Groq, and OpenRouter fallbacks

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

Requires site ownership and OAuth. A future owner dashboard needs a verified
property, OAuth client ID/secret, encrypted refresh-token storage, and explicit
per-site consent. It must not be used for anonymous third-party audits.

### Bing Webmaster Tools

Requires a verified site and a per-owner API key. Store owner keys encrypted;
do not configure one global key for anonymous audits.

### Gemini

Optional only. Create a new AI Studio key after reviewing current free-tier data
terms. Never send private drafts, authenticated pages, or full audit JSON.

### GitHub Actions deployment

Local Wrangler OAuth can deploy production now. Automatic deploys from GitHub
need repository secrets `GEOSCORE_CF_ACCOUNT_ID` and
`GEOSCORE_CF_API_TOKEN`. Create a least-privilege Cloudflare token for Workers,
Pages, D1, KV, Vectorize, Browser Run, and route deployment.

## Privacy boundary

External LLMs receive only bounded excerpts from already-public pages. Never
send cookies, authorization headers, preview URLs, unpublished content, email
addresses, secrets, or complete stored audits.
