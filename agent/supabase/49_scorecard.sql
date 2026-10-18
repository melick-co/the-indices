-- The government scorecard (/australia-inc/scorecard): the federal government's measurable commitments, and the log
-- of every change to them.
--
-- The list is maintained by the agent (web/scripts/scorecard.ts, tasks scorecard / scorecard-dry-run), not approved
-- by an editor, under a strict rule, fail closed: a commitment is shown only when its target is quoted verbatim from
-- an official document, the quote was found in the document's text and the source check confirmed it (check.audited),
-- and an official stored series measures it. Otherwise it is stored as 'held' (the newsdesk shows it). A commitment
-- that passes the quote check but has no stored series yet is 'awaiting_data' and a series request is filed with the
-- source scout. Every addition, change, removal, hold and rating change is written to scorecard_log, which the
-- newsdesk surfaces (visibility, not approval) and The Bottom Line may mention.
--
-- Run in the Supabase SQL editor.

create table if not exists scorecard_commitments (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  title           text not null,                 -- plain description, no evaluative words
  quote           text not null,                 -- the target, verbatim from the source document
  source_url      text not null,
  source_title    text,
  source_date     date,
  metric_id       text,                          -- the official stored series that measures it (null while awaiting data)
  series_label    text,                          -- how the page names the series
  data_note       text,                          -- what series is needed, when awaiting data
  target_value    numeric not null,
  target_unit     text,
  target_date     date not null,                 -- the deadline
  start_date      date not null,                 -- counting starts / the starting reading
  direction       text not null default 'increase' check (direction in ('increase', 'decrease')),
  baseline_value  numeric,                       -- reference level for 'change' targets (2005 emissions for "43% below 2005")
  baseline_period text,
  method          text not null check (method in ('cumulative_sum', 'level', 'share', 'change')),
  status          text not null default 'held' check (status in ('active', 'awaiting_data', 'held', 'retired')),
  rating          text,                          -- the last rating the maintenance run logged
  "check"         jsonb not null default '{}',   -- { quote_found, audited, issues, checked_at, source_check }
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Fail closed: nothing is shown unless the quote was found in the document and the source check ran and confirmed
  -- it; a live commitment also needs its series.
  constraint scorecard_commitments_checked check (
    status not in ('active', 'awaiting_data')
    or (coalesce("check"->>'quote_found', '') = 'true' and coalesce("check"->>'audited', '') = 'true')
  ),
  constraint scorecard_commitments_measured check (status <> 'active' or metric_id is not null)
);

create or replace function scorecard_touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists scorecard_commitments_touch on scorecard_commitments;
create trigger scorecard_commitments_touch before update on scorecard_commitments
  for each row execute function scorecard_touch_updated_at();

create index if not exists scorecard_commitments_status on scorecard_commitments (status, target_date);

create table if not exists scorecard_log (
  id             uuid primary key default gen_random_uuid(),
  commitment_id  uuid references scorecard_commitments (id) on delete set null,
  slug           text not null,
  kind           text not null check (kind in ('added', 'changed', 'removed', 'held', 'awaiting_data', 'activated', 'rating')),
  from_value     text,                           -- the previous rating, target or status
  to_value       text,
  reason         text,                           -- why: the source, the check result, the series reading
  detail         jsonb not null default '{}',
  created_at     timestamptz not null default now()
);

create index if not exists scorecard_log_recent on scorecard_log (created_at desc);

alter table scorecard_commitments enable row level security;
alter table scorecard_log enable row level security;

-- Public: commitments that passed the strict check (live, or awaiting their series). Held and retired rows are the
-- newsdesk's.
drop policy if exists "public read live scorecard_commitments" on scorecard_commitments;
create policy "public read live scorecard_commitments" on scorecard_commitments for select to anon, authenticated
  using (status in ('active', 'awaiting_data'));
drop policy if exists "admin all scorecard_commitments" on scorecard_commitments;
create policy "admin all scorecard_commitments" on scorecard_commitments for all to authenticated using (is_admin()) with check (is_admin());

-- Public: rating changes (the record behind the page). Other log entries are the newsdesk's.
drop policy if exists "public read scorecard ratings" on scorecard_log;
create policy "public read scorecard ratings" on scorecard_log for select to anon, authenticated using (kind = 'rating');
drop policy if exists "admin all scorecard_log" on scorecard_log;
create policy "admin all scorecard_log" on scorecard_log for all to authenticated using (is_admin()) with check (is_admin());

notify pgrst, 'reload schema';
