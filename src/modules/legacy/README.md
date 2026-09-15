# Retained but not executed

Nothing in this folder is imported by the anonymous audit path. These upstream
modules stay in the repository because they still describe real checks, but
`src/routes/audit.ts` reports each of them as `skipped` so they never enter the
scoring denominator or appear as passes:

| Module | Why it is not run |
|---|---|
| `keywords.ts` | Keyword research needs a search provider budget per audit |
| `ai_content_insights.ts` | Optional AI enrichment; deterministic checks remain authoritative |
| `off_page_seo.ts` | Off-page/backlink evidence is not collected in the anonymous hot path |
| `site_intel.ts` | Full site intelligence exceeds the bounded subrequest budget |
| `redirect_chain.ts` | Redirect chains are bounded to the sampled fetch instead |
| `security_audit.ts` | Mozilla Observatory auditing is an external service dependency |
| `ssl_cert.ts` | Certificate detail is covered by the transport checks that do run |
| `domain_intel.ts` | RDAP/DNS lookups overlap with the discovery checks that do run |
| `broken_links.ts` | Link crawling is unbounded for arbitrary sites |
| `geo_predicted.ts` | Predicted visibility simulation has weight zero |

Keep them compiling (they are still type-checked): if you change a shared helper
under `src/lib/`, this folder must keep building. `tests/editorial-and-keywords.test.mjs`
still exercises `keywords.ts` directly, so its behavior is covered even though the
audit route never calls it.

If a module is permanently retired, delete it instead of leaving it here — Git
history is the archive.
