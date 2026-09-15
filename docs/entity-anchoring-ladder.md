# Entity anchoring and the specificity ladder

Status: first slice implemented (query rungs + measured anchoring depth).
Owner: operator. Updated: 2026-09-15.

## The idea

Today GeoScore audits a **site**. Two things are missing:

1. **An entity, not only a site.** A person, brand, or project has a public
   footprint that is audited by different evidence than a page: a knowledge-graph
   node, name variants across sources, and how strongly the name is bound to a
   field. That is a different audit mode, not a new score.
2. **A specificity ladder.** How well an entity is indexed shows up as *how vague
   a query can still surface it*:

   | Query | Field known? | Brand known? |
   |---|---|---|
   | `中国的知名开发者` | no | no |
   | `中国的知名游戏开发者` | yes | no |
   | `Amiyadesi 的 GeoScore` | yes | yes |
   | `geo.sayori.org` | — | navigational |

   The useful measurement is not a rank but the **boundary**: the vaguest rung
   where the entity is still observable. That boundary doubles as a positioning
   tool (which field is this entity actually associated with?) and as a paid
   depth feature, because it changes over time.

## Guardrail: this is reach evidence, not a ranking forecast

GeoScore states in `README.md` and in every report that it does not predict or
guarantee rankings. A vague-query feature is one step away from breaking that
promise, so the ladder obeys the same rules as the Evidence Map:

- It never enters the factual score. `EvidenceMapSnapshot.affects_score` stays
  `false` and `anchoring` lives beside it, not inside the checks.
- It reports three states only: observed, not observed, unknown. No percentages,
  no "citation likelihood", no projected rank.
- Every row carries the probe wording **verbatim**, the provider names, and the
  snapshot date, so the reader can judge whether the probe represents their
  positioning.
- `null` anchoring means "not observed on this dated snapshot", never "you cannot
  be found".

## Rungs

Rungs 0 and 1 never contain the brand or the root domain, so only they can show
whether a searcher who does not know the entity can still reach it.

| Rung | Label | Contains brand | Example (zh) | Example (en) |
|---|---|---|---|---|
| 0 | `generic` | no | `厂商` | `vendors` |
| 1 | `field` | no | `team collaboration 厂商` | `team collaboration vendors` |
| 2 | `branded` | yes | `Acme Tools 软件 功能` | `Acme Tools software features` |
| 3 | `navigational` | yes | `Acme Tools 关于 联系方式` | `Acme Tools about contact` |

Rung 1 wording is built from the field (`industry_vertical`) the audit already
observed plus a small archetype role word (`GENERIC_ROLE_WORDS` in
`src/lib/query-evidence.ts`). Rung 0 keeps the role word only. When the audit has
no field evidence, no probe is invented and the ladder is simply absent.

## What shipped in the first slice

- `src/lib/query-evidence.ts` (`QUERY_PLAN_VERSION` 1.1.0): every planned query
  now carries `rung`, `rung_label`, and `brand_free`. `planEvidenceQueries`
  reserves the first slot for the brand-anchored query (the answer snapshot and
  the "does the brand itself surface" reading depend on it), the second for one
  brand-free field probe, and the third for the navigational query. Deeper rungs
  appear in `unprobed_rungs`: they are instructions, and nothing in that list was
  measured.
- `src/routes/evidence-map.ts`: `EvidenceAnchoringSummary` on the snapshot
  reports `vaguest_brand_free_rung_observed`, per-rung observations with the
  providers that returned the target, the next unprobed probe, and its own
  limitations.
- `src/routes/monitoring.ts`: rebuilt plans classify stored queries back onto the
  rungs from the query text, so weekly snapshots keep the ladder.
- `frontend/evidence-map.js`: `describeAnchoring(snapshot)` is the view model the
  report card will render (returns `null` for snapshots without anchoring).
- Tests: `tests/query-evidence.test.mjs`, `tests/evidence-map.test.mjs`,
  `tests/frontend-controllers.test.mjs`.

The free plan still spends exactly three queries, so the documented
`evidence_queries_per_project` limit in `/api/meta` is unchanged.

## Next steps

1. **Render the ladder.** `frontend/app.js` still has to draw the anchoring card
   next to the Evidence Map (`evidenceMapController.hydrate` at `app.js` and the
   existing evidence card renderer).
2. **Entity mode** (`mode: 'entity'`): resolve a name plus aliases and an optional
   field/region, then run checks that need no site — Wikidata node presence,
   label/description/alias consistency, `sameAs` completeness, name-variant
   agreement across sources, and homonym ambiguity. Reuse the existing
   `authority.ts` and `common_crawl.ts` evidence; apply the CONTEXT.md
   applicability rule so `Person` and `Organization` get different check sets.
3. **Operator-defined rungs.** Let a paying user replace the generated rung
   wording with the positioning they claim, then measure that instead of the
   archetype guess. The probe text is already surfaced verbatim, so this is a
   substitution, not a new metric.
4. **Trend.** The weekly monitor already stores `evidence_json`; surface
   "boundary moved from rung 2 to rung 1 on <date>" once the ladder has history.
5. **Competitor rungs.** For a given field probe, list which other entities were
   observed. Framed as a field map, never as a ranking.

## Cost and packaging

- Each rung costs one planned query, and each query costs up to
  `MAX_FREE_SEARCH_PROVIDERS_PER_QUERY` provider calls. The free plan therefore
  runs the brand query plus one brand-free probe, and keeps deeper rungs unrun.
- The ladder is inherently recurring (search evidence drifts), so it belongs in a
  subscription rather than the one-time Site Pass: Site Pass sells the fix
  report, the ladder sells measured depth over time plus entity mode.
- Extending the ladder must go through the existing subrequest budget
  (`SubrequestBudget`, `BUDGET_KV`) and rate limits rather than raising the free
  caps.

## Risks

- Provider coverage differs by locale and field wording; a missing result can
  mean "no coverage for this probe" rather than "not reachable". The snapshot
  limitation text says so explicitly.
- Entity audits touch people. Keep it to public evidence, do not infer private
  attributes, and do not rank individuals against each other.
- Any percentage or score attached to the ladder will be read as a ranking
  promise. Keep it to observed/not-observed/unknown.
