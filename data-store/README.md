# indices-data

Supabase data store for the-indices, in a tidy (long) shape so every dataset —
migration, tax, housing, bonds, productivity, prices, markets — lives in the same
three tables. Charting code written once works for all of them. Adding a dataset
means inserting rows, never altering the schema.

## What's here

```
supabase/
  01_schema.sql     tables: entities, metrics, observations + labelled view
  02_seed.sql       generated upserts for all current data (idempotent)
  03_rls.sql        row-level security: authenticated read, no anon, no client writes
data/
  metrics.json      17 metrics with full provenance
  observations.json 771 observations
  entities.json     38 countries
lib/
  supabase.ts       browser client (anon key)
  queries.ts        dataset-agnostic query helpers for charts
  types.ts          shared types
scripts/
  extract.py        rebuilds data/ from source
  load.mjs          pushes data/ to Supabase via service-role key
```

## Model

- **entities** — ISO-3166 alpha-3 country codes and names.
- **metrics** — one row per series, carrying definition, unit, basis, direction,
  category and full source provenance (tier, org, URL, publication date).
- **observations** — the fact table. One row per (metric, entity, period, value, status).
  `status` is `published`, `derived` or `estimated` — the same honesty flag used in the-indices.

`direction` encodes the Composite Index Construction Standard convention, so the same
store feeds both the charts and the index engine.

## Setup

1. **Create a Supabase project** at supabase.com. Note the project URL, the `anon`
   key and the `service_role` key (Settings → API).

2. **Run the SQL** in order, in the Supabase SQL editor:
   ```
   01_schema.sql
   02_seed.sql      -- or use the loader instead (step 3)
   03_rls.sql       -- run LAST, after data is in
   ```
   `02_seed.sql` is idempotent, so re-running it updates values without duplicating.

3. **Or load from JSON** (preferred for updates), locally or in CI:
   ```bash
   npm install
   SUPABASE_URL=https://xxx.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
   npm run load
   ```

4. **Wire the Vercel app.** Set env vars in the Vercel project:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...      # safe to expose; RLS gates access
   ```
   The `service_role` key is NEVER set in the app — loader only.

## Security

Data is private. RLS grants `select` only to `authenticated` users; there is no
anon policy, so an unauthenticated client sees nothing. No insert/update/delete
policies exist for app users — writes happen solely through the loader using the
service-role key, which bypasses RLS. So the anon key in the browser is safe: it
cannot read data without a login and cannot mutate anything.

You'll need Supabase Auth enabled and a sign-in flow in the Vercel app before any
chart will return rows. Simplest to start: email magic-link or a single seeded user.

## Charting API (dataset-agnostic)

```ts
import { listMetrics, crossSection, timeSeries, entityProfile } from './lib/queries';

await listMetrics('migration');              // pick a dataset
await crossSection('household_debt_to_income'); // bar / map: latest cross-country
await timeSeries('permanent_migration_inflow', ['AUS','NZL','GBR']); // line: annual
await entityProfile('AUS');                  // everything for one country
```

Because charts key off `metric_id`, a new dataset appears in the UI automatically
once its rows are loaded — no chart code changes.

## Updating data

1. Edit or extend `scripts/extract.py` (add a metric + its observations with provenance).
2. `npm run extract` to rebuild `data/`.
3. `npm run load` to push. Vintages should follow the Standard: don't rewrite a
   published period in place — add the new one.
