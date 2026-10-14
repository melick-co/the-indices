-- RBA feeds: fix the discussion-papers address (the old one 404s) and watch speeches and the Statement on Monetary Policy.
-- Run in the Supabase SQL editor.

update rss_feeds
   set url = 'https://www.rba.gov.au/rss/rss-cb-rdp.xml', name = 'RBA research discussion papers',
       publisher = 'Reserve Bank of Australia', error_count = 0, active = true
 where url = 'https://www.rba.gov.au/rss/rss-research-discussion-papers.xml'
   and not exists (select 1 from rss_feeds where url = 'https://www.rba.gov.au/rss/rss-cb-rdp.xml');

insert into rss_feeds (url, name, publisher, tier) values
  ('https://www.rba.gov.au/rss/rss-cb-rdp.xml',      'RBA research discussion papers',    'Reserve Bank of Australia', 2),
  ('https://www.rba.gov.au/rss/rss-cb-speeches.xml', 'RBA speeches',                      'Reserve Bank of Australia', 2),
  ('https://www.rba.gov.au/rss/rss-cb-smp.xml',      'RBA Statement on Monetary Policy',  'Reserve Bank of Australia', 2)
on conflict (url) do nothing;

-- The old address, if the update above didn't apply because the new one already existed.
update rss_feeds set active = false
 where url = 'https://www.rba.gov.au/rss/rss-research-discussion-papers.xml';
