-- Series added by the source scout (agent/scripts/scout-sources.mjs).
-- The ABS, OECD and World Bank loaders read active rows alongside their
-- hard-coded config, and pitch metric ids listed in `aliases` link to the
-- series. Only official APIs we already load from are allowed.

create table if not exists series_registry (
  metric_id     text primary key,
  provider      text not null check (provider in ('abs', 'oecd', 'wb')),
  flow          text not null,      -- ABS dataflow id | OECD AGENCY,DSD@DF,VERSION | World Bank indicator code
  key           text,               -- SDMX series key (ABS, OECD); null for World Bank
  measure       text,               -- OECD MEASURE code to keep from the response, if the key returns several
  name          text not null,
  unit          text not null,
  basis         text not null,
  direction     text not null default 'neutral'
                check (direction in ('higher_is_more_pressure', 'higher_is_less_pressure', 'neutral')),
  category      text not null default 'other',
  aliases       text[] not null default '{}',
  -- ABS only: also store annual % change derived from this index series
  -- {"metric_id","name","basis","lag"} (lag 4 quarterly, 12 monthly). Aliases point at it.
  derive        jsonb,
  status        text not null default 'active' check (status in ('active', 'failed', 'retired')),
  requested_by  jsonb,              -- the unlinked pitch ids and counts that motivated it
  scout_note    text,
  verified_at   timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One row per requested id the scout has tried, so it does not retry every week.
create table if not exists source_scout_log (
  requested_id  text primary key,
  last_tried    timestamptz not null default now(),
  outcome       text not null,      -- adopted | no_match | rejected | failed
  metric_id     text,
  note          text
);

alter table series_registry enable row level security;
alter table source_scout_log enable row level security;
drop policy if exists "admin all series_registry" on series_registry;
create policy "admin all series_registry" on series_registry
  for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists "admin all source_scout_log" on source_scout_log;
create policy "admin all source_scout_log" on source_scout_log
  for all to authenticated using (is_admin()) with check (is_admin());

insert into data_sources (source_id, name, org, tier, api_kind, cadence, notes) values
  ('scout_registry', 'Scout-adopted series', 'Various (ABS, OECD, World Bank)', 1, 'sdmx', 'mixed',
   'Series added by the source scout; see series_registry')
on conflict (source_id) do nothing;
