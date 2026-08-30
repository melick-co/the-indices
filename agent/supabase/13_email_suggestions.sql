-- ============================================================
-- Inbound editorial email + topic suggestion queue.
-- Email arrives via webhook → inbox (kind=email) → agent review
-- → topic_suggestions (pending) → editor approve/reject in Studio.
-- Nothing touches tracked_topics or pitches until approved.
-- ============================================================

alter table inbox add column if not exists from_address text;
alter table inbox add column if not exists message_id text;

create unique index if not exists inbox_message_id_idx on inbox(message_id)
  where message_id is not null;

alter table inbox drop constraint if exists inbox_kind_check;
alter table inbox add constraint inbox_kind_check
  check (kind in ('idea', 'data_source', 'article', 'image', 'dataset', 'link', 'email'));

create table if not exists topic_suggestions (
  suggestion_id uuid primary key default uuid_generate_v4(),
  source_kind   text not null default 'email'
                  check (source_kind in ('email', 'agent')),
  source_id     uuid references inbox(id) on delete set null,
  action        text not null
                  check (action in ('update_topic', 'new_topic', 'story_idea')),
  status        text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected')),
  summary       text not null,
  payload       jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  reviewed_at   timestamptz,
  review_note   text,
  linked_pitch  uuid references pitches(id)
);

create index if not exists topic_suggestions_pending_idx
  on topic_suggestions(status, created_at desc);

alter table topic_suggestions enable row level security;

drop policy if exists "admin all topic_suggestions" on topic_suggestions;
create policy "admin all topic_suggestions"
  on topic_suggestions for all to authenticated
  using (is_admin()) with check (is_admin());

-- Agent writes via service role (bypasses RLS).
