-- ============================================================
-- Published stories generated from approved Foundry pitches.
-- Public reads published rows; writes are service-role / admin.
-- ============================================================

create table if not exists stories (
  story_id    uuid primary key default uuid_generate_v4(),
  pitch_id    uuid unique references pitches(id) on delete set null,
  slug        text not null unique,
  status      text not null default 'draft'
                check (status in ('draft', 'published', 'archived')),
  kicker      text not null,
  title       text not null,
  hook        text not null,
  caveat      text not null,
  published   date not null default current_date,
  one_number  jsonb not null,
  evidence    jsonb not null,
  body        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists stories_status_published_idx
  on stories(status, published desc);
create index if not exists stories_pitch_idx on stories(pitch_id);

alter table stories enable row level security;

drop policy if exists "public reads published stories" on stories;
create policy "public reads published stories" on stories
  for select to anon, authenticated
  using (status = 'published');

drop policy if exists "admin all stories" on stories;
create policy "admin all stories" on stories
  for all to authenticated
  using (is_admin())
  with check (is_admin());
