-- ============================================================
-- Daily trending topic snapshots: RSS news clusters + X trends.
-- Consumer-facing rankings (top 10). Agent writes via service role.
-- ============================================================

create table if not exists trending_snapshots (
  snapshot_id   uuid primary key default uuid_generate_v4(),
  source        text not null check (source in ('rss', 'x')),
  region        text not null check (region in ('au', 'global')),
  window_type   text not null check (window_type in ('1d', '7d')),
  period_end    date not null,
  topics        jsonb not null default '[]',
  item_count    int not null default 0,
  computed_at   timestamptz not null default now(),
  unique (source, region, window_type, period_end)
);

create index if not exists trending_snapshots_lookup_idx
  on trending_snapshots (source, region, window_type, period_end desc);

alter table trending_snapshots enable row level security;

drop policy if exists "public read trending_snapshots" on trending_snapshots;
create policy "public read trending_snapshots"
  on trending_snapshots for select to anon, authenticated using (true);
