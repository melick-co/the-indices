# the-indices

An engine for constructing, validating and publishing composite indices, built to a single
published methodology so that credibility earned by one indicator transfers to the rest.

Every figure resolves to a named source on a declared basis. Nothing is imputed.

---

## Status

Working engine, one index implemented (HSI). Not yet published.

| Piece | State |
|---|---|
| Normalisation, weighting, coverage rules | Implemented, tested |
| Sensitivity and validation battery | Implemented |
| Provenance on every observation | Implemented |
| Household Squeeze Index (HSI) | Computing; sensitivity review outstanding |
| WCI / SPI / TLI / ARLVI | Defined in the standard, not built |
| Rendering and story generation | Not started |

## The standard

The engine implements **Composite Index Construction Standard v1.0**. The rules that matter:

- **0 to 100 scale**, and a higher score *always* means greater pressure. No index may be
  published where high is good; invert and rename instead.
- **Fixed anchor bounds**, set once at index creation. Bounds never move with the sample,
  so a change in score over time is a substantive statement rather than a change in rank.
- **Equal weights by default.** Departures require written justification and a published
  sensitivity test.
- **No imputation, ever.** Below three components or 75% of index weight, an entity is
  reported as insufficient coverage. It is never modelled and never silently dropped.
- **Immutable vintages.** Source restatements land in the next vintage with a changelog.
- **Source tiering.** Headline claims must rest on tier 1 or 2 sources.

`test/hsi.test.ts` validates the engine against the worked example published in the
standard. If the test fails, the engine and the standard disagree and one of them is wrong.

## Layout

```
data/
  entities.json            controlled vocabulary (ISO-3166 alpha-3)
  metrics/*.json           one file per series: definition, basis, source, observations
indices/
  hsi.json                 index definition: components, fixed bounds, weights
src/
  types.ts                 core types
  normalise.ts             section 5 - min-max against fixed bounds
  compute.ts               sections 6 and 7 - weighting, coverage, no imputation
  sensitivity.ts           section 10 - validation battery
  load.ts                  file loading
  cli.ts                   commands
test/
  hsi.test.ts              validates against the standard's worked example
```

## Data model

Each metric file carries its own provenance. This is the source register from section 8 of
the standard, and it is what gets published as the supporting evidence behind any chart.

```json
{
  "metric_id": "household_debt_to_income",
  "definition": "Household gross debt as a percentage of net household disposable income.",
  "unit": "percent of net disposable income",
  "basis": "Nominal, national currency ratio; not currency converted",
  "direction": "higher_is_more_pressure",
  "source": {
    "org": "OECD",
    "dataset": "Household debt (indicator)",
    "tier": 1,
    "url": "https://data.oecd.org/hha/household-debt.htm",
    "published": "2025-06",
    "period": "2024"
  },
  "observations": [
    { "entity": "AUS", "period": "2024", "value": 223.0, "status": "published" }
  ]
}
```

`status` is one of `published`, `derived` or `estimated`. An index in which estimated
values exceed 25% of total weight may not be published.

## Use

```bash
npm install
npm test              # validate engine against the standard
npm run table         # ranked table for HSI
npm run detail        # component breakdown, defaults to Australia
npm run sensitivity   # validation battery
npm run publish:index # write dist/published/hsi-2026.1.{json,csv}
```

## Adding an index

1. Add a metric file per component to `data/metrics/`, with full provenance.
2. Create `indices/<id>.json` with components, fixed bounds and weights.
3. Set bounds from the full historical range extended roughly 20% at each end.
4. Run `npm run sensitivity` and resolve anything flagged.
5. Write the methodology note before first publication.

## Known issues

- **HSI sensitivity is marginal.** Rank correlation under weight perturbation is 0.987,
  which is strong, but max score change is 3.17 against a 3.00 threshold. Section 10.4 of
  the standard also uses max rank change as an acceptance test, which behaves poorly when
  scores cluster densely: a fraction of a point moves an entity several places without the
  index having meaningfully changed. The standard should be amended to make rank
  correlation and score change the substantive tests.
- **`years_to_buy_home` is tier 3 and mixed-basis.** Home prices are market USD from a
  crowd-sourced provider; net income is PPP USD. It should be rebuilt from OECD or national
  house price indices on a single basis before publication.
- Several components need re-pulling from primary sources rather than aggregators.

## Licence

MIT. Methodology published openly.
