-- ============================================================
-- Feed trend clusters: mechanical grouping of RSS items before
-- hypothesis generation. Hypotheses land in pitches with
-- detector = 'trend_hypothesis' and link back here.
-- ============================================================

create table if not exists trend_clusters (
  cluster_id    uuid primary key default uuid_generate_v4(),
  label         text not null,
  keywords      text[] not null default '{}',
  item_ids      uuid[] not null default '{}',
  feed_ids      uuid[] not null default '{}',
  outlet_count  int not null default 1,
  item_count    int not null default 1,
  spike_score   numeric not null default 1,
  window_start  timestamptz not null,
  window_end    timestamptz not null,
  status        text not null default 'open'
                  check (status in ('open', 'hypothesized', 'archived')),
  linked_pitch  uuid references pitches(id),
  fingerprint   text not null unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists trend_clusters_status_idx on trend_clusters(status);
create index if not exists trend_clusters_window_idx on trend_clusters(window_end desc);

alter table trend_clusters enable row level security;

drop policy if exists "auth read trend_clusters" on trend_clusters;
create policy "auth read trend_clusters"
  on trend_clusters for select to authenticated using (true);

-- Agent writes via service role (bypasses RLS).
