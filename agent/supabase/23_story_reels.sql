-- ============================================================
-- Reel briefs generated from a story. One reel per story.
-- The spec is handed whole to an external video generator, so
-- it is stored as-is rather than normalised.
--
-- Keyed by slug rather than stories.story_id because the two
-- founding stories live in the static registry and have no row
-- in stories; slug is the identifier both kinds share.
-- ============================================================

create table if not exists story_reels (
  reel_id     uuid primary key default uuid_generate_v4(),
  story_slug  text not null unique,
  status      text not null default 'draft'
                check (status in ('draft', 'ready', 'archived')),
  -- Scene list, format block, presenter style and shot list.
  spec        jsonb not null,
  -- Figures the reel asserts that could not be traced back to the story evidence,
  -- plus format breaches. A reel cannot be marked ready while this is non-empty.
  warnings    jsonb not null default '[]'::jsonb,
  total_seconds numeric not null default 0,
  generation_note text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists story_reels_status_idx on story_reels(status);

alter table story_reels enable row level security;

-- A ready reel is public once its story is. Static-registry stories have no row in
-- stories and are always published, so an absent row is treated as published.
drop policy if exists "public reads ready reels" on story_reels;
create policy "public reads ready reels" on story_reels
  for select to anon, authenticated
  using (
    status = 'ready'
    and not exists (
      select 1 from stories s
      where s.slug = story_reels.story_slug
        and s.status <> 'published'
    )
  );

drop policy if exists "admin all reels" on story_reels;
create policy "admin all reels" on story_reels
  for all to authenticated
  using (is_admin())
  with check (is_admin());
