-- ============================================================
-- Row Level Security : private data, authenticated read only
-- ============================================================
alter table entities     enable row level security;
alter table metrics      enable row level security;
alter table observations enable row level security;

-- Authenticated users may READ. No public (anon) access.
create policy "auth read entities"     on entities     for select to authenticated using (true);
create policy "auth read metrics"      on metrics      for select to authenticated using (true);
create policy "auth read observations" on observations for select to authenticated using (true);

-- Writes are performed only by the loader using the service_role key,
-- which bypasses RLS. No insert/update/delete policies are defined for
-- anon or authenticated, so the client can never mutate data.

-- The labelled view runs with the querying user's privileges, so RLS
-- on the base tables applies to it automatically.
