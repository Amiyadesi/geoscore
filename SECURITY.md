# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities privately through GitHub's
[security advisory form](https://github.com/Amiyadesi/geoscore/security/advisories/new)
instead of a public issue. Include the affected endpoint or module, the request
that triggers it, and what an attacker gains.

Please do not run automated scanners against `geo.sayori.org` or
`geo-api.sayori.org` beyond a handful of requests: GeoScore audits and
Cloudflare resources are operator-funded and rate limited. Local reproduction
against your own Worker is always fine.

## Supported versions

Only the latest released version (`package.json` `version`, currently locked by
`tests/release-metadata.test.mjs`) receives fixes. Forks should track `main`.

## How this project handles secrets

- No credential belongs in a tracked file. Worker secrets are set with
  `wrangler secret put`, GitHub Actions secrets are mapped in the deployment
  workflow, and local development values live in the git-ignored `.dev.vars`.
- `.gitleaks.toml` allowlists the public Cloudflare Web Analytics beacon token;
  the `secret scan` job in `verify.yml` scans pushed commits.
- Provider keys are Worker-only. They are never sent to a browser, written to an
  audit report, or stored in D1, KV, URLs, or frontend state.
- Monitoring stores only a versioned, peppered HMAC of a project management
  token, so a D1 leak does not hand over project access.
- A request-scoped BYOK value is forwarded for a single answer request and is
  never persisted.
- Optional providers (LLM fallbacks, search gateway, mail, SigNoz) fail open and
  never influence the factual score.

## Scope

In scope: SSRF or DNS-rebinding bypasses of the public-hostname rules, audit
endpoint abuse that exceeds the documented rate limits or subrequest budget,
token-recovery flaws in monitoring, prompt-injection paths that could publish
attacker-controlled text into a report, and XSS in the frontend.
