-- Australia Inc.: how the country is being run. Government announcements and the news about the nation's bottom line,
-- read against the data, opened each morning by The Bottom Line (a brief daily intro).
--
--   rss_feeds.beat      'australia_inc' for the government feeds below (null = the general news watch).
--   inc_items           the running commentary: one row per announcement or news item covered.
--   bottom_lines        one Bottom Line per Sydney day. It goes live only with a passing strict check (fail closed).
--
-- Written by web/scripts/australia-inc.ts (task australia-inc). Run in the Supabase SQL editor.

-- ---------------------------------------------------------------------------------------------------- feeds

alter table rss_feeds add column if not exists beat text;
create index if not exists rss_feeds_beat_idx on rss_feeds (beat) where beat is not null;

-- Each address was checked to return a live RSS feed with current items (16 Oct 2026). Official bodies are tier 2.
insert into rss_feeds (url, name, publisher, tier, beat) values
  ('https://www.pm.gov.au/rss.xml',                                                      'Prime Minister: media',                 'Prime Minister of Australia',      2, 'australia_inc'),
  ('https://ministers.treasury.gov.au/ministers/jim-chalmers-2022/media-releases/feed',  'Treasurer: media releases',             'Treasurer',                        2, 'australia_inc'),
  ('https://ministers.treasury.gov.au/ministers/jim-chalmers-2022/speeches/feed',        'Treasurer: speeches',                   'Treasurer',                        2, 'australia_inc'),
  ('https://ministers.treasury.gov.au/ministers/daniel-mulino-2025/media-releases/feed', 'Assistant Treasurer: media releases',   'Assistant Treasurer',              2, 'australia_inc'),
  ('https://ministers.treasury.gov.au/ministers/andrew-leigh-2025/media-releases/feed',  'Treasury minister (Leigh): media releases', 'Assistant Minister for Productivity, Competition, Charities and Treasury', 2, 'australia_inc'),
  ('https://ministers.treasury.gov.au/ministers/anne-aly-2025/media-releases/feed',      'Treasury minister (Aly): media releases', 'Minister for Small Business',    2, 'australia_inc'),
  ('https://ministers.finance.gov.au/rss.xml',                                           'Finance ministers',                     'Minister for Finance',             2, 'australia_inc'),
  ('https://www.pbo.gov.au/rss.xml',                                                     'Parliamentary Budget Office',           'Parliamentary Budget Office',      2, 'australia_inc'),
  ('https://www.aph.gov.au/senate/rss/reports',                                          'Senate committee reports tabled',       'Parliament of Australia',          2, 'australia_inc'),
  ('https://www.aph.gov.au/senate/rss/new_inquiries',                                    'New Senate committee inquiries',        'Parliament of Australia',          2, 'australia_inc'),
  ('https://www.apra.gov.au/rss.xml',                                                    'APRA',                                  'Australian Prudential Regulation Authority', 2, 'australia_inc')
on conflict (url) do nothing;

-- Feeds that were already watched keep their beat null; these are tagged even if they existed before this file.
update rss_feeds set beat = 'australia_inc'
 where beat is null and url in (
   'https://www.pm.gov.au/rss.xml',
   'https://ministers.treasury.gov.au/ministers/jim-chalmers-2022/media-releases/feed',
   'https://ministers.treasury.gov.au/ministers/jim-chalmers-2022/speeches/feed',
   'https://ministers.treasury.gov.au/ministers/daniel-mulino-2025/media-releases/feed',
   'https://ministers.treasury.gov.au/ministers/andrew-leigh-2025/media-releases/feed',
   'https://ministers.treasury.gov.au/ministers/anne-aly-2025/media-releases/feed',
   'https://ministers.finance.gov.au/rss.xml',
   'https://www.pbo.gov.au/rss.xml',
   'https://www.aph.gov.au/senate/rss/reports',
   'https://www.aph.gov.au/senate/rss/new_inquiries',
   'https://www.apra.gov.au/rss.xml');

-- ---------------------------------------------------------------------------------------------------- commentary

create table if not exists inc_items (
  id            uuid primary key default gen_random_uuid(),
  rss_item_id   uuid references rss_items(item_id) on delete set null,
  title         text not null,
  url           text not null unique,
  publisher     text,
  published_at  timestamptz,
  kind          text not null default 'news' check (kind in ('announcement', 'news', 'release')),
  summary       text,                              -- one or two plain sentences, attributed
  claims        jsonb not null default '[]',       -- [{ text, metric_id, verdict, note }]
  links         jsonb not null default '[]',       -- [{ label, url, kind: chart|story|external|source }]
  status        text not null default 'new' check (status in ('new', 'published', 'dismissed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists inc_items_recent on inc_items (status, published_at desc);

-- ---------------------------------------------------------------------------------------------------- the bottom line

create table if not exists bottom_lines (
  id            uuid primary key default gen_random_uuid(),
  day           date not null unique,              -- Sydney day
  status        text not null default 'draft' check (status in ('draft', 'held', 'published')),
  headline      text,
  paragraphs    jsonb not null default '[]',       -- [{ text, links: [{ label, url, kind }] }]
  items         jsonb not null default '[]',       -- the announcements and news it drew on, with inc_items ids
  "check"       jsonb not null default '{}',       -- { ok, audited, issues: [], warnings: [], claims: [] }
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Fail closed: nothing is published unless the strict check ran in full and passed.
  constraint bottom_lines_published_checked check (
    status <> 'published'
    or (coalesce("check"->>'ok', '') = 'true' and coalesce("check"->>'audited', '') = 'true' and published_at is not null)
  )
);
create index if not exists bottom_lines_recent on bottom_lines (status, day desc);

create or replace function inc_touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists inc_items_touch on inc_items;
create trigger inc_items_touch before update on inc_items for each row execute function inc_touch_updated_at();
drop trigger if exists bottom_lines_touch on bottom_lines;
create trigger bottom_lines_touch before update on bottom_lines for each row execute function inc_touch_updated_at();

-- ---------------------------------------------------------------------------------------------------- access

alter table inc_items enable row level security;
alter table bottom_lines enable row level security;

drop policy if exists "public reads published inc_items" on inc_items;
create policy "public reads published inc_items" on inc_items for select to anon, authenticated using (status = 'published');
drop policy if exists "admin all inc_items" on inc_items;
create policy "admin all inc_items" on inc_items for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "public reads published bottom_lines" on bottom_lines;
create policy "public reads published bottom_lines" on bottom_lines for select to anon, authenticated using (status = 'published');
drop policy if exists "admin all bottom_lines" on bottom_lines;
create policy "admin all bottom_lines" on bottom_lines for all to authenticated using (is_admin()) with check (is_admin());

notify pgrst, 'reload schema';
