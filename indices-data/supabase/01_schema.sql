-- ============================================================
-- the-indices : schema
-- Tidy (long) data model. Every number is one row in observations.
-- Adding a new dataset means inserting rows, never altering tables.
-- ============================================================

create extension if not exists "uuid-ossp";

-- Reference: countries / areas (ISO-3166 alpha-3)
create table if not exists entities (
  code        char(3) primary key,
  name        text not null,
  region      text
);

-- Reference: one row per data series, with full provenance (Standard section 8)
create table if not exists metrics (
  metric_id        text primary key,
  name             text not null,
  unit             text not null,
  basis            text not null,
  direction        text not null check (direction in
                     ('higher_is_more_pressure','higher_is_less_pressure','neutral')),
  category         text not null,
  source_tier      smallint not null check (source_tier in (1,2,3)),
  source_org       text not null,
  source_dataset   text,
  source_url       text,
  source_published text,
  period           text,
  created_at       timestamptz not null default now()
);

-- Fact table: every observation
create table if not exists observations (
  id          uuid primary key default uuid_generate_v4(),
  metric_id   text not null references metrics(metric_id) on delete cascade,
  entity      char(3) not null references entities(code) on delete restrict,
  period      text not null,                       -- year or range label, e.g. '2024'
  value       double precision not null,
  status      text not null default 'published'
                check (status in ('published','derived','estimated')),
  created_at  timestamptz not null default now(),
  unique (metric_id, entity, period)
);

create index if not exists obs_metric_idx  on observations(metric_id);
create index if not exists obs_entity_idx  on observations(entity);
create index if not exists obs_period_idx  on observations(period);

-- Convenience view: observations joined to labels, for the charting API
create or replace view observations_labelled as
select
  o.metric_id, m.name  as metric_name, m.unit, m.category, m.direction,
  m.source_org, m.source_tier, o.entity, e.name as entity_name,
  o.period, o.value, o.status
from observations o
join metrics  m on m.metric_id = o.metric_id
join entities e on e.code      = o.entity;
