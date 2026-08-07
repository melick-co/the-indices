-- ============================================================
-- RSS watch layer. News items are LEADS, never evidence:
-- they peg, time or trigger ideas; claims still rest on tier 1/2 data.
-- ============================================================

create table if not exists rss_feeds (
  feed_id      uuid primary key default uuid_generate_v4(),
  url          text not null unique,
  name         text,
  publisher    text,
  -- news outlets are tier 3 by default per the charter (colour, never carry)
  tier         smallint not null default 3 check (tier in (2,3)),
  -- optional per-feed keyword filter; null = use the global watchlist
  watch_keywords text[],
  active       boolean not null default true,
  added_via    text not null default 'manual' check (added_via in ('manual','inbox')),
  last_fetched timestamptz,
  last_item_at timestamptz,
  etag         text,              -- conditional GET support
  error_count  int not null default 0,
  created_at   timestamptz not null default now()
);

create table if not exists rss_items (
  item_id      uuid primary key default uuid_generate_v4(),
  feed_id      uuid not null references rss_feeds(feed_id) on delete cascade,
  guid_hash    text not null,     -- sha256 of guid/link for dedup
  title        text not null,
  link         text,
  summary      text,
  published_at timestamptz,
  fetched_at   timestamptz not null default now(),
  -- lifecycle: fetched -> prefiltered (keyword hit) -> evaluated -> linked/converted/discarded
  status       text not null default 'fetched' check (status in
                 ('fetched','prefiltered','evaluated','linked_to_pitch','converted_to_idea','discarded')),
  matched_keywords text[],
  linked_pitch uuid references pitches(id),
  eval_notes   text,
  unique (feed_id, guid_hash)
);
create index if not exists rss_items_status_idx on rss_items(status);

-- RLS: same posture as the rest
alter table rss_feeds enable row level security;
alter table rss_items enable row level security;
create policy "auth read rss_feeds" on rss_feeds for select to authenticated using (true);
create policy "auth read rss_items" on rss_items for select to authenticated using (true);
create policy "auth insert rss_feeds" on rss_feeds for insert to authenticated with check (true);
create policy "auth update rss_feeds" on rss_feeds for update to authenticated using (true);
-- item writes are agent-only (service role bypasses RLS)

-- Seed: a starter watch list (verify URLs on first run; fetcher tolerates 404s
-- and increments error_count; deactivate after repeated failures)
insert into rss_feeds (url,name,publisher,tier) values
 ('https://www.rba.gov.au/rss/rss-cb-media-releases.xml','RBA media releases','Reserve Bank of Australia',2),
 ('https://www.abc.net.au/news/feed/51120/rss.xml','ABC News Business','ABC',3),
 ('https://www.theguardian.com/australia-news/rss','Guardian Australia','The Guardian',3),
 ('https://www.macrobusiness.com.au/feed/','MacroBusiness','MacroBusiness',3)
on conflict (url) do nothing;
