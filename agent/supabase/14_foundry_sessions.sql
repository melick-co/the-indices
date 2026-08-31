-- Foundry unified chat: intent, forks, structured messages, source suggestions.
-- Safe to re-run.

-- Allow foundry mode alongside legacy ask/brainstorm.
alter table research_sessions drop constraint if exists research_sessions_mode_check;
alter table research_sessions add constraint research_sessions_mode_check
  check (mode in ('ask', 'brainstorm', 'foundry'));

alter table research_sessions
  add column if not exists parent_session_id uuid references research_sessions(session_id) on delete set null,
  add column if not exists fork_from_message_id text,
  add column if not exists intent text check (intent is null or intent in ('investigate', 'brainstorm', 'refine', 'precedents'));

create index if not exists research_parent_session_idx
  on research_sessions(parent_session_id) where parent_session_id is not null;

create index if not exists research_intent_idx
  on research_sessions(intent) where intent is not null;

-- URL fetch cache for fetch_url tool dedup.
create table if not exists research_cache (
  url         text primary key,
  title       text,
  text        text not null,
  fetched_at  timestamptz not null default now()
);

-- Agent-discovered sources awaiting editor approval.
create table if not exists source_suggestions (
  suggestion_id  uuid primary key default uuid_generate_v4(),
  session_id     uuid references research_sessions(session_id) on delete set null,
  action         text not null check (action in ('register_data_source', 'register_rss_feed')),
  payload        jsonb not null default '{}'::jsonb,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  summary        text,
  review_note    text,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists source_suggestions_status_idx on source_suggestions(status, created_at desc);
create index if not exists source_suggestions_session_idx on source_suggestions(session_id);

alter table research_cache enable row level security;
alter table source_suggestions enable row level security;

drop policy if exists "auth read research_cache" on research_cache;
drop policy if exists "auth write research_cache" on research_cache;
drop policy if exists "auth read source_suggestions" on source_suggestions;
drop policy if exists "auth write source_suggestions" on source_suggestions;

create policy "auth read research_cache"  on research_cache for select to authenticated using (true);
create policy "auth write research_cache" on research_cache for all    to authenticated using (true) with check (true);
create policy "auth read source_suggestions"  on source_suggestions for select to authenticated using (true);
create policy "auth write source_suggestions" on source_suggestions for all    to authenticated using (true) with check (true);

-- Backfill message ids for legacy rows missing them.
update research_sessions
set messages = (
  select coalesce(jsonb_agg(
    case
      when (elem->>'id') is not null then elem
      else elem || jsonb_build_object('id', gen_random_uuid()::text)
    end
  ), '[]'::jsonb)
  from jsonb_array_elements(coalesce(messages, '[]'::jsonb)) elem
)
where mode in ('ask', 'brainstorm', 'foundry')
  and jsonb_array_length(coalesce(messages, '[]'::jsonb)) > 0
  and exists (
    select 1 from jsonb_array_elements(coalesce(messages, '[]'::jsonb)) e
    where e->>'id' is null
  );
