-- ============================================================
-- Runway renders for a story reel. One row per generation job,
-- keyed by story slug + scene id + kind. Runway task URLs expire
-- in 24-48h, so succeeded jobs copy the file into Storage.
--
-- kind:
--   still       — scene frame / story art (text-to-image)
--   chart       — still of a chart with locked series values
--   clip        — scene video, usually image-to-video from still
--   chart_video — animated chart from the locked still
--   reel        — playlist of scene clips (no extra Runway call)
-- ============================================================

create table if not exists story_reel_renders (
  render_id       uuid primary key default uuid_generate_v4(),
  story_slug      text not null,
  scene_id        text not null,
  kind            text not null
                    check (kind in ('still', 'chart', 'clip', 'chart_video', 'reel')),
  status          text not null default 'queued'
                    check (status in ('queued', 'running', 'succeeded', 'failed')),
  runway_task_id  text,
  runway_endpoint text,
  model           text,
  prompt_text     text not null default '',
  chain_to        text
                    check (chain_to is null or chain_to in ('clip', 'chart_video')),
  output_url      text,
  output_path     text,
  content_type    text,
  output_manifest jsonb,
  error           text,
  last_polled_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists story_reel_renders_slug_idx
  on story_reel_renders (story_slug, created_at desc);

create index if not exists story_reel_renders_open_idx
  on story_reel_renders (status)
  where status in ('queued', 'running');

alter table story_reel_renders enable row level security;

drop policy if exists "public reads succeeded renders" on story_reel_renders;
create policy "public reads succeeded renders" on story_reel_renders
  for select to anon, authenticated
  using (
    status = 'succeeded'
    and not exists (
      select 1 from stories s
      where s.slug = story_reel_renders.story_slug
        and s.status <> 'published'
    )
  );

drop policy if exists "admin all renders" on story_reel_renders;
create policy "admin all renders" on story_reel_renders
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- Public bucket so Runway can fetch a still as promptImage, and so the
-- editor can preview/download without a signed URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reel-renders',
  'reel-renders',
  true,
  104857600,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'application/octet-stream']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read reel renders" on storage.objects;
create policy "public read reel renders"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'reel-renders');

drop policy if exists "admin write reel renders" on storage.objects;
create policy "admin write reel renders"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'reel-renders' and is_admin())
  with check (bucket_id = 'reel-renders' and is_admin());
