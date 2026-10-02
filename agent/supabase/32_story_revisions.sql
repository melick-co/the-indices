-- Refreshing published articles (e.g. into the house news style).
-- A refresh writes a 'pending' revision; the live article changes only when it
-- is applied, which archives the replaced version first. Admin-only: pending
-- copy is unreviewed. The update note on stories is public.

alter table stories add column if not exists update_note text;
alter table stories add column if not exists updated_on date;
comment on column stories.update_note is 'Reader-facing note shown when an article has been revised, e.g. why and what changed.';
comment on column stories.updated_on is 'Date of the last applied revision; published stays the original date.';

create table if not exists story_revisions (
  revision_id uuid primary key default uuid_generate_v4(),
  story_id    uuid not null references stories(story_id) on delete cascade,
  status      text not null check (status in ('pending', 'applied', 'discarded', 'archived')),
  content     jsonb not null,
  "check"     jsonb,
  note        text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists story_revisions_story_idx on story_revisions(story_id, created_at desc);
create unique index if not exists story_revisions_one_pending
  on story_revisions(story_id) where status = 'pending';

comment on table story_revisions is 'Pending refreshes awaiting review, and archived prior versions of revised stories.';

alter table story_revisions enable row level security;

drop policy if exists "admin all story revisions" on story_revisions;
create policy "admin all story revisions" on story_revisions
  for all to authenticated
  using (is_admin())
  with check (is_admin());
