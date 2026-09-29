-- Editorial tables are admin only.
-- Tables added after 09_iam (session_monitors, trend_clusters, research_cache,
-- source_suggestions) shipped with "any signed-in user" policies, and sign-up is
-- open, so any new account could read or write them through the anon key.
--
-- Rather than drop policies by name, this works from what is actually in
-- pg_policies: on each table, every policy that does not go through is_admin()
-- is dropped (except the public-read policies listed in keep), then one
-- admin policy is ensured. Safe to re-run.

do $$
declare
  t text;
  p record;
  keep text[] := array['public reads curated news'];
begin
  foreach t in array array[
    'pitches', 'pitch_feedback', 'pitch_events', 'inbox', 'agent_runs',
    'rss_feeds', 'rss_items', 'data_sources', 'research_sessions', 'tracked_topics',
    'session_monitors', 'trend_clusters', 'research_cache', 'source_suggestions',
    'topic_suggestions', 'market_watches'
  ]
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'skip %: no such table', t;
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);

    for p in
      select policyname, qual, with_check from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      continue when p.policyname = any (keep);
      continue when coalesce(p.qual, '') like '%is_admin()%'
        and (p.with_check is null or p.with_check like '%is_admin()%');
      execute format('drop policy %I on public.%I', p.policyname, t);
      raise notice 'dropped "%" on %', p.policyname, t;
    end loop;

    execute format('drop policy if exists %I on public.%I', 'admin all ' || t, t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (is_admin()) with check (is_admin())',
      'admin all ' || t, t);
  end loop;
end $$;

-- A user whose profile row the sign-up trigger missed could insert their own
-- row with role = 'admin'. Self-inserted rows are always subscribers.
drop policy if exists "insert own profile" on profiles;
create policy "insert own profile" on profiles
  for insert to authenticated
  with check (id = auth.uid() and role = 'subscriber');
