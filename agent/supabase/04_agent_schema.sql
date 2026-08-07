-- ============================================================
-- Insight agent schema. Extends the-indices store (01_schema.sql).
-- Design principles:
--   * Pitches NEVER get deleted. They move between states, and every
--     idea carries resurface conditions so weak-today can be gold-later.
--   * Sources carry release calendars so watchers poll only when due.
--   * The user is a first-class source via the inbox.
-- ============================================================

-- ---------- Source registry with release-cycle awareness ----------
create table if not exists data_sources (
  source_id      text primary key,
  name           text not null,
  org            text not null,
  tier           smallint not null check (tier in (1,2,3)),
  access_url     text,
  api_kind       text check (api_kind in ('sdmx','rest','file','manual')),
  -- release cycle: how often, and when next expected
  cadence        text not null check (cadence in
                   ('daily','weekly','monthly','quarterly','biannual','annual','irregular')),
  next_expected  date,            -- watcher polls at/after this date only
  last_checked   timestamptz,
  last_changed   timestamptz,     -- when new data was actually found
  notes          text,
  active         boolean not null default true
);

-- ---------- Pitch lifecycle ----------
-- States: candidate  -> raw detector output, not yet ranked
--         pitched    -> in a daily five
--         approved   -> user greenlit; becomes a story brief
--         rejected   -> user passed; kept, may resurface
--         watchlist  -> user parked it deliberately
--         dormant    -> agent parked it (weak now, has resurface condition)
--         published  -> went out; only re-pitch on material data change
create table if not exists pitches (
  id             uuid primary key default uuid_generate_v4(),
  headline       text not null,
  hook           text,                     -- one-line why-now
  mechanism      text,                     -- the causal sentence
  caveat         text,                     -- the hostile reader's first objection
  chart_hint     text,                     -- suggested visual form
  detector       text not null,            -- which detector produced it
  trigger_rows   jsonb not null,           -- the exact observations that fired it
  metric_ids     text[] not null,          -- metrics involved (for resurfacing)
  score          jsonb,                    -- rubric scores from taste layer
  rank_value     numeric,
  state          text not null default 'candidate' check (state in
                   ('candidate','pitched','approved','rejected','watchlist','dormant','published')),
  -- resurfacing machinery: never lose gold
  resurface_on   text,                     -- human-readable condition
  resurface_metrics text[],                -- re-evaluate when these metrics get new periods
  resurface_after   date,                  -- or after this date (calendar pegs)
  times_pitched  int not null default 0,
  first_seen     timestamptz not null default now(),
  last_evaluated timestamptz not null default now(),
  state_changed  timestamptz not null default now()
);
create index if not exists pitches_state_idx on pitches(state);
create index if not exists pitches_resurface_idx on pitches using gin(resurface_metrics);

-- ---------- User feedback (drives taste-layer learning) ----------
create table if not exists pitch_feedback (
  id          uuid primary key default uuid_generate_v4(),
  pitch_id    uuid not null references pitches(id),
  action      text not null check (action in
                ('approve','reject','watchlist','rank_up','rank_down','comment','redirect')),
  comment     text,                      -- free-text direction, e.g. "angle on renters not buyers"
  created_at  timestamptz not null default now()
);

-- ---------- Inbox: user-submitted ideas, sources, uploads, links ----------
create table if not exists inbox (
  id          uuid primary key default uuid_generate_v4(),
  kind        text not null check (kind in ('idea','data_source','article','image','dataset','link')),
  title       text,
  body        text,                       -- the idea text, article notes, etc.
  url         text,
  file_path   text,                       -- storage path for uploads
  status      text not null default 'new' check (status in
                ('new','processing','ingested','converted_to_pitch','archived')),
  linked_pitch uuid references pitches(id),
  created_at  timestamptz not null default now(),
  processed_at timestamptz
);

-- ---------- Daily runs (audit trail of what the agent did) ----------
create table if not exists agent_runs (
  id            uuid primary key default uuid_generate_v4(),
  ran_at        timestamptz not null default now(),
  sources_due   int, sources_changed int,
  candidates    int, pitched int, resurfaced int,
  quiet_day     boolean not null default false,
  notes         text
);

-- ---------- RLS (same posture as the base store) ----------
alter table data_sources  enable row level security;
alter table pitches       enable row level security;
alter table pitch_feedback enable row level security;
alter table inbox         enable row level security;
alter table agent_runs    enable row level security;

create policy "auth read data_sources"  on data_sources  for select to authenticated using (true);
create policy "auth read pitches"       on pitches       for select to authenticated using (true);
create policy "auth read runs"          on agent_runs    for select to authenticated using (true);
create policy "auth read inbox"         on inbox         for select to authenticated using (true);
create policy "auth read feedback"      on pitch_feedback for select to authenticated using (true);
-- The user writes feedback and inbox items from the app:
create policy "auth insert feedback"    on pitch_feedback for insert to authenticated with check (true);
create policy "auth insert inbox"       on inbox          for insert to authenticated with check (true);
-- Pitch state changes go through the app as the user too:
create policy "auth update pitches"     on pitches        for update to authenticated using (true);
-- Agent writes (detectors, watchers, taste) use the service role, which bypasses RLS.

-- ---------- Seed the source registry with known release cycles ----------
insert into data_sources (source_id,name,org,tier,api_kind,cadence,next_expected,notes) values
 ('oecd_taxing_wages','Taxing Wages','OECD',1,'sdmx','annual','2026-04-30','Usually late April'),
 ('oecd_migration','International Migration Outlook','OECD',1,'file','annual','2026-11-15','Table 1.1 annual series'),
 ('oecd_hh_debt','Household debt indicator','OECD',1,'sdmx','annual','2026-06-30',null),
 ('oecd_wages','Average annual wages','OECD',1,'sdmx','annual','2026-11-30',null),
 ('oecd_productivity','Productivity database','OECD',1,'sdmx','annual','2026-05-31',null),
 ('abs_awe','Average Weekly Earnings','ABS',1,'sdmx','biannual','2026-08-14','Feb & Aug releases'),
 ('abs_cpi','Consumer Price Index','ABS',1,'sdmx','quarterly','2026-07-29','Quarterly, ~4 weeks after quarter end'),
 ('imf_weo','World Economic Outlook','IMF',1,'rest','biannual','2026-10-15','Apr & Oct'),
 ('worldbank_wdi','World Development Indicators','World Bank',1,'rest','quarterly','2026-09-30','Rolling updates'),
 ('eurostat_gov','Government finance statistics','Eurostat',1,'sdmx','quarterly','2026-10-21',null),
 ('rba_stats','RBA statistical tables','RBA',2,'file','monthly','2026-08-07','F-series yields, E-series household'),
 ('wgb_yields','Sovereign yields','World Government Bonds',2,'manual','daily',null,'Context only; not a headline source')
on conflict (source_id) do nothing;
