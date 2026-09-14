-- ============================================================
-- News Desk: home layout, hero art, generated stills/clips hook.
-- Columns live on stories (DB-backed articles). story_desk overlays
-- the founding stories that live in the static registry and must not
-- get a stories row (that would replace their React bodies).
-- ============================================================

alter table stories
  add column if not exists home_section text,
  add column if not exists home_rank integer,
  add column if not exists pinned_hero boolean not null default false,
  add column if not exists hero_image_url text,
  add column if not exists hero_image_alt text,
  add column if not exists art jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'stories_home_section_check'
  ) then
    alter table stories
      add constraint stories_home_section_check
      check (home_section is null or home_section in ('hero', 'frame_checks', 'stories'));
  end if;
end $$;

create index if not exists stories_home_layout_idx
  on stories (status, home_section, home_rank);

create index if not exists stories_pinned_hero_idx
  on stories (pinned_hero) where pinned_hero;

comment on column stories.home_section is 'Desk placement: hero | frame_checks | stories. Null = auto from frame_check.';
comment on column stories.home_rank is 'Manual order within a home section. Null = fall back to trend sort.';
comment on column stories.pinned_hero is 'When true, this story is the home hero regardless of trend.';
comment on column stories.hero_image_url is 'Optional card/hero image. Editor-set URL or storage public URL.';
comment on column stories.hero_image_alt is 'Alt text for hero_image_url.';
comment on column stories.art is 'Attached stills/clips. Generators (e.g. Runway) append here; the desk does not call them.';

create table if not exists story_desk (
  slug            text primary key,
  home_section    text,
  home_rank       integer,
  pinned_hero     boolean not null default false,
  hero_image_url  text,
  hero_image_alt  text,
  art             jsonb not null default '[]'::jsonb,
  updated_at      timestamptz not null default now(),
  constraint story_desk_home_section_check
    check (home_section is null or home_section in ('hero', 'frame_checks', 'stories'))
);

create index if not exists story_desk_layout_idx
  on story_desk (home_section, home_rank);

alter table story_desk enable row level security;

drop policy if exists "public reads story desk" on story_desk;
create policy "public reads story desk" on story_desk
  for select to anon, authenticated
  using (true);

drop policy if exists "admin all story desk" on story_desk;
create policy "admin all story desk" on story_desk
  for all to authenticated
  using (is_admin())
  with check (is_admin());

comment on table story_desk is 'Home layout overlay for stories that have no row in stories (static founding articles).';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'story-art',
  'story-art',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public reads story art" on storage.objects;
create policy "public reads story art" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'story-art');

drop policy if exists "admin writes story art" on storage.objects;
create policy "admin writes story art" on storage.objects
  for all to authenticated
  using (bucket_id = 'story-art' and is_admin())
  with check (bucket_id = 'story-art' and is_admin());
