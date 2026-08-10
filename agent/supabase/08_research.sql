-- ============================================================
-- Research sessions and tracked topics.
-- Questions asked of the agent are kept, because a question you asked
-- six months ago is itself a resurface signal when the data moves.
-- ============================================================

create table if not exists tracked_topics (
  topic_id    uuid primary key default uuid_generate_v4(),
  label       text not null,
  keywords    text[] not null,          -- feeds the RSS prefilter
  why         text,                     -- why this matters, in your words
  metric_ids  text[],                   -- series that bear on it, if known
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  last_hit    timestamptz               -- last time a news item matched
);

create table if not exists research_sessions (
  session_id  uuid primary key default uuid_generate_v4(),
  mode        text not null check (mode in ('ask','brainstorm')),
  question    text not null,
  answer      text,
  verdict     text,                     -- publishable | needs_work | killed
  sources     jsonb,                    -- what it consulted, with tiers
  tools_used  jsonb,
  linked_pitch uuid references pitches(id),
  created_at  timestamptz not null default now(),
  duration_ms int
);
create index if not exists research_created_idx on research_sessions(created_at desc);

alter table tracked_topics    enable row level security;
alter table research_sessions enable row level security;

drop policy if exists "auth read topics" on tracked_topics;
drop policy if exists "auth write topics" on tracked_topics;
drop policy if exists "auth read research" on research_sessions;
drop policy if exists "auth write research" on research_sessions;

create policy "auth read topics"    on tracked_topics    for select to authenticated using (true);
create policy "auth write topics"   on tracked_topics    for all    to authenticated using (true) with check (true);
create policy "auth read research"  on research_sessions for select to authenticated using (true);
create policy "auth write research" on research_sessions for all    to authenticated using (true) with check (true);

-- Seed with the beats we already cover
insert into tracked_topics (label, keywords, why) values
 ('Household squeeze', array['household debt','mortgage','cost of living','savings rate','real wages'],
  'The spine of the Australia story: strong state, stretched household'),
 ('Wages and inflation', array['minimum wage','fair work','wage price index','cpi','inflation','rba'],
  'Recurring claim-check territory; the spiral that keeps not happening'),
 ('Housing affordability', array['house price','housing','rent','first home buyer','dwelling approvals'],
  'Where the Australian income advantage disappears'),
 ('Migration', array['migration','immigration','visa','net overseas migration','population'],
  'Denominator flips live here')
on conflict do nothing;
