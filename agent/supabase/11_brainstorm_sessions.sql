-- Extend research_sessions into persistent brainstorm workspaces.
-- Safe to re-run.

alter table research_sessions
  add column if not exists title text,
  add column if not exists status text not null default 'complete'
    check (status in ('draft', 'running', 'complete', 'archived')),
  add column if not exists inputs jsonb not null default '[]'::jsonb,
  add column if not exists messages jsonb not null default '[]'::jsonb,
  add column if not exists monitoring jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

-- Backfill titles from the opening question for existing rows.
update research_sessions
set title = left(question, 80)
where title is null and question is not null;

create index if not exists research_mode_created_idx
  on research_sessions(mode, created_at desc);

create index if not exists research_status_idx
  on research_sessions(status) where status <> 'archived';

-- Session-owned monitoring requests (optional follow-ups from brainstorm).
create table if not exists session_monitors (
  monitor_id   uuid primary key default uuid_generate_v4(),
  session_id   uuid not null references research_sessions(session_id) on delete cascade,
  kind         text not null check (kind in ('topic', 'rss', 'data_source', 'manual')),
  label        text not null,
  payload      jsonb not null default '{}'::jsonb,
  cadence      text not null default 'regular' check (cadence in ('regular', 'on_request')),
  active       boolean not null default true,
  linked_id    text,
  created_at   timestamptz not null default now()
);
create index if not exists session_monitors_session_idx on session_monitors(session_id);

alter table session_monitors enable row level security;
drop policy if exists "auth read session_monitors" on session_monitors;
drop policy if exists "auth write session_monitors" on session_monitors;
create policy "auth read session_monitors"  on session_monitors for select to authenticated using (true);
create policy "auth write session_monitors" on session_monitors for all    to authenticated using (true) with check (true);
