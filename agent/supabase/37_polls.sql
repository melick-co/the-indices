-- Published opinion polls (sentiment dashboard). Private sources: tier-3 context only, never a headline figure.
--
-- Read from Wikipedia's "Opinion polling for the next Australian federal election" tables through the MediaWiki
-- API by agent/scripts/watch-polls.mjs. A row is kept only when it cites the pollster's or client's published
-- release (source_url) and its numbers add up (two-party splits sum to 100, primaries to about 100).
--
-- One row per poll per measure:
--   primary_alp, primary_lnp, primary_grn, primary_onp, primary_oth   first-preference vote, %
--   tpp_alp_lnp   Labor's share of the Labor v Coalition two-party-preferred vote, %
--   tpp_alp_onp   Labor's share of the Labor v One Nation two-party vote, %
--   tpp_lnp_onp   the Coalition's share of the Coalition v One Nation two-party vote, %
--   direction_right, direction_wrong, direction_unsure   "is the country heading in the right direction?", %

create table if not exists polls (
  poll_key      text not null,            -- <field_end>|<pollster>|<table>, e.g. 2026-10-02|RedBridge/Accent|vi
  measure       text not null,
  value         numeric not null,
  field_start   date,
  field_end     date not null,
  pollster      text not null,
  client        text,
  mode          text,
  sample_size   int,
  source_url    text not null,           -- the published release the compilation cites
  compiled_from text not null default 'Wikipedia: Opinion polling for the next Australian federal election',  -- or the leadership page
  wiki_revision bigint,                  -- the page revision the row was read from
  updated_at    timestamptz not null default now(),
  primary key (poll_key, measure)
);

create index if not exists polls_measure_end on polls (measure, field_end desc);

alter table polls enable row level security;

-- Published polls are public information.
drop policy if exists "public reads polls" on polls;
create policy "public reads polls" on polls for select to anon, authenticated using (true);

-- Leadership polls (preferred prime minister, leader approval) share the table; their measures name the role and
-- the person, e.g. approval_net:pm:Albanese, ppm:opposition:Taylor (see watch-polls.mjs).

-- Make the new table visible to the API straight away.
notify pgrst, 'reload schema';
