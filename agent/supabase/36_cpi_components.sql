-- Every item the CPI is measured against, with its history (ABS CPI dataflow).
--
--  * cpi_items: the ABS item hierarchy (All groups → 11 groups → subgroups → expenditure classes), plus the
--    analytical series (trimmed mean, weighted median, "All groups excluding …", goods/services, tradables).
--  * cpi_observations: monthly and quarterly readings for every item, for Australia (the weighted average of
--    the eight capitals, entity AUS) and each capital city: index number, change on the previous period,
--    annual change, and points contributions to the headline's period and annual change.
--  * cpi_weights: each item's share of the basket at each reweighting.
--
-- Loaded by agent/scripts/load-cpi-components.mjs. Stories read a component as a virtual metric id,
-- cpi:<index_code>:<measure>[:q][:sa] (see agent/scripts/lib/cpi-components.mjs), so charts and the fact checks
-- treat it like any stored series.

create table if not exists cpi_items (
  index_code   text primary key,
  name         text not null,
  description  text,
  parent_code  text references cpi_items (index_code) deferrable initially deferred,
  level        int not null,            -- 0 All groups / analytical root, 1 group, 2 subgroup, 3 expenditure class
  series_type  text not null check (series_type in ('main', 'analytical')),
  sort_order   int,
  updated_at   timestamptz not null default now()
);

create table if not exists cpi_observations (
  index_code              text not null references cpi_items (index_code),
  entity                  text not null,  -- AUS (eight capitals), SYD, MEL, BNE, ADL, PER, HOB, DRW, CBR
  adjustment              text not null check (adjustment in ('original', 'seasonally_adjusted')),
  frequency               text not null check (frequency in ('M', 'Q')),
  period                  text not null,  -- 2026-08 or 2026-Q3
  index_value             numeric,
  change_period           numeric,        -- % change on the previous month or quarter
  change_annual           numeric,        -- % change on the same period a year earlier
  contribution_period_pts numeric,        -- points contribution to the All groups change on the previous period
  contribution_annual_pts numeric,        -- points contribution to the All groups annual change
  updated_at              timestamptz not null default now(),
  primary key (index_code, entity, adjustment, frequency, period)
);

create index if not exists cpi_observations_period on cpi_observations (frequency, period);

create table if not exists cpi_weights (
  index_code  text not null references cpi_items (index_code),
  entity      text not null,
  period      text not null,               -- the quarter the weights took effect
  weight_pct  numeric not null,            -- percentage contribution to the All groups CPI
  updated_at  timestamptz not null default now(),
  primary key (index_code, entity, period)
);

comment on table cpi_items is 'ABS CPI item hierarchy and analytical series.';
comment on table cpi_observations is 'Every CPI item, monthly and quarterly, Australia and capitals (ABS).';
comment on table cpi_weights is 'CPI expenditure weights by item at each reweighting (ABS).';

alter table cpi_items enable row level security;
alter table cpi_observations enable row level security;
alter table cpi_weights enable row level security;

drop policy if exists "public reads cpi items" on cpi_items;
create policy "public reads cpi items" on cpi_items for select to anon, authenticated using (true);
drop policy if exists "public reads cpi observations" on cpi_observations;
create policy "public reads cpi observations" on cpi_observations for select to anon, authenticated using (true);
drop policy if exists "public reads cpi weights" on cpi_weights;
create policy "public reads cpi weights" on cpi_weights for select to anon, authenticated using (true);
