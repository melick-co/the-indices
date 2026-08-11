-- ============================================================
-- Identity and access. Three roles:
--   admin      — you. Studio, research tools, curation.
--   subscriber — registered reader. Alerts, saved topics.
--   (anon)     — public. Stories, indices, methodology, ticker.
-- ============================================================

create table if not exists profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  role          text not null default 'subscriber' check (role in ('admin','subscriber')),
  display_name  text,
  alert_topics  text[] default '{}',        -- topic labels they want alerts on
  alert_indices boolean not null default true,
  alert_stories boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Every new auth user gets a profile automatically.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Backfill profiles for users who already exist
insert into profiles (id, email)
select u.id, u.email from auth.users u
where not exists (select 1 from profiles p where p.id = u.id);

-- Role helper, used by every policy below.
create or replace function is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------- Profiles RLS ----------
alter table profiles enable row level security;
drop policy if exists "read own profile" on profiles;
drop policy if exists "update own profile" on profiles;
drop policy if exists "admin reads all profiles" on profiles;
create policy "read own profile"   on profiles for select to authenticated using (id = auth.uid());
create policy "insert own profile" on profiles for insert to authenticated
  with check (id = auth.uid());
create policy "update own profile" on profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from profiles where id = auth.uid()));
create policy "admin reads all profiles" on profiles for select to authenticated using (is_admin());

-- ---------- Studio tables become admin-only ----------
do $$
declare t text;
begin
  foreach t in array array['pitches','pitch_feedback','pitch_events','inbox',
                           'agent_runs','rss_feeds','rss_items','data_sources',
                           'research_sessions','tracked_topics']
  loop
    execute format('drop policy if exists "auth read %1$s" on %1$s', t);
    execute format('drop policy if exists "admin all %1$s" on %1$s', t);
    execute format('create policy "admin all %1$s" on %1$s for all to authenticated using (is_admin()) with check (is_admin())', t);
  end loop;
end $$;

-- Legacy named policies from earlier migrations
drop policy if exists "auth read observations" on observations;
drop policy if exists "auth read metrics" on metrics;
drop policy if exists "auth read entities" on entities;
drop policy if exists "auth insert feedback" on pitch_feedback;
drop policy if exists "auth insert inbox" on inbox;
drop policy if exists "auth update pitches" on pitches;
drop policy if exists "auth read data_sources" on data_sources;
drop policy if exists "auth read runs" on agent_runs;
drop policy if exists "auth read inbox" on inbox;
drop policy if exists "auth read feedback" on pitch_feedback;
drop policy if exists "auth read rss_feeds" on rss_feeds;
drop policy if exists "auth read rss_items" on rss_items;
drop policy if exists "auth insert rss_feeds" on rss_feeds;
drop policy if exists "auth update rss_feeds" on rss_feeds;
drop policy if exists "auth read pitch_events" on pitch_events;
drop policy if exists "auth read topics" on tracked_topics;
drop policy if exists "auth write topics" on tracked_topics;
drop policy if exists "auth read research" on research_sessions;
drop policy if exists "auth write research" on research_sessions;

-- ---------- Data stays readable to any signed-in user ----------
drop policy if exists "signed in reads observations" on observations;
drop policy if exists "signed in reads metrics" on metrics;
drop policy if exists "signed in reads entities" on entities;
create policy "signed in reads observations" on observations for select to authenticated using (true);
create policy "signed in reads metrics"      on metrics      for select to authenticated using (true);
create policy "signed in reads entities"     on entities     for select to authenticated using (true);

-- ---------- Curated news: the only thing the public may read ----------
alter table rss_items add column if not exists curated boolean not null default false;
alter table rss_items add column if not exists curated_note text;
alter table rss_items add column if not exists curated_at timestamptz;
create index if not exists rss_items_curated_idx on rss_items(curated, published_at desc);

drop policy if exists "public reads curated news" on rss_items;
create policy "public reads curated news" on rss_items
  for select to anon, authenticated using (curated = true);

grant execute on function is_admin() to authenticated;

-- ============================================================
-- BOOTSTRAP: make yourself admin. Replace the address, then run.
--   update profiles set role = 'admin' where email = 'you@example.com';
-- Until you do, no one can reach the studio.
-- ============================================================
