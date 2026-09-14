-- Desk watches: raw market series tracked before they enter the data store.
-- Safe to re-run.

create table if not exists market_watches (
  watch_id          uuid primary key default uuid_generate_v4(),
  kind              text not null check (kind in ('bond', 'equity', 'forex', 'other')),
  label             text not null,
  symbol            text,
  provider          text not null check (provider in
                      ('store', 'yahoo', 'fred', 'frankfurter', 'url', 'manual')),
  source_url        text,
  org               text,
  unit              text,
  notes             text,
  why               text,
  cadence           text,
  proposed_tier     smallint check (proposed_tier is null or proposed_tier in (1, 2, 3)),
  status            text not null default 'watching'
                      check (status in ('watching', 'proposed', 'in_store', 'dropped')),
  builtin           boolean not null default false,
  linked_source_id  text references data_sources(source_id) on delete set null,
  linked_metric_id  text,
  linked_suggestion uuid,
  last_value        numeric,
  last_period       text,
  last_change_pct   numeric,
  last_fetched      timestamptz,
  history           jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists market_watches_provider_symbol_idx
  on market_watches(provider, symbol)
  where symbol is not null and status <> 'dropped';

create index if not exists market_watches_kind_idx
  on market_watches(kind, status);

alter table market_watches enable row level security;
drop policy if exists "admin all market_watches" on market_watches;
drop policy if exists "auth write market_watches" on market_watches;
create policy "admin all market_watches"
  on market_watches for all to authenticated
  using (is_admin()) with check (is_admin());

-- Built-in desk series. Re-running does not duplicate.
insert into market_watches (
  watch_id, kind, label, symbol, provider, source_url, org, unit, notes,
  cadence, proposed_tier, status, builtin, linked_metric_id
) values
  ('a1000000-0000-4000-8000-000000000001', 'bond', 'Australia 10-year',
    'bond_yield_10y_au', 'store',
    'https://www.rba.gov.au/statistics/tables/', 'RBA', 'percent',
    'Already in the data store. RBA F17 analytical zero-coupon yield.',
    'monthly', 1, 'in_store', true, 'bond_yield_10y_au'),
  ('a1000000-0000-4000-8000-000000000002', 'bond', 'United States 10-year',
    'DGS10', 'fred',
    'https://fred.stlouisfed.org/series/DGS10', 'Federal Reserve', 'percent',
    'Treasury constant maturity. Scratch quote for the desk, not a Caveat figure yet.',
    'daily', 1, 'watching', true, null),
  ('a1000000-0000-4000-8000-000000000003', 'bond', 'United Kingdom 10-year',
    'IRLTLT01GBM156N', 'fred',
    'https://fred.stlouisfed.org/series/IRLTLT01GBM156N', 'OECD / Bank of England', 'percent',
    'Long-term government bond yield, monthly. Scratch quote.',
    'monthly', 1, 'watching', true, null),
  ('a1000000-0000-4000-8000-000000000004', 'bond', 'Germany 10-year',
    'IRLTLT01DEM156N', 'fred',
    'https://fred.stlouisfed.org/series/IRLTLT01DEM156N', 'OECD / Bundesbank', 'percent',
    'Long-term government bond yield, monthly. Scratch quote.',
    'monthly', 1, 'watching', true, null),
  ('a1000000-0000-4000-8000-000000000011', 'equity', 'S&P/ASX 200',
    '^AXJO', 'yahoo',
    'https://www.asx.com.au/markets/trade-our-cash-market/indices', 'ASX', 'index',
    'Live index print for the desk. Not in the data store.',
    'daily', 2, 'watching', true, null),
  ('a1000000-0000-4000-8000-000000000012', 'equity', 'S&P 500',
    '^GSPC', 'yahoo',
    'https://www.spglobal.com/spdji/en/indices/equity/sp-500/', 'S&P Dow Jones', 'index',
    'Live index print for the desk. Not in the data store.',
    'daily', 2, 'watching', true, null),
  ('a1000000-0000-4000-8000-000000000013', 'equity', 'Nikkei 225',
    '^N225', 'yahoo',
    'https://indexes.nikkei.co.jp/en/nkave', 'Nikkei', 'index',
    'Live index print for the desk. Not in the data store.',
    'daily', 2, 'watching', true, null),
  ('a1000000-0000-4000-8000-000000000021', 'forex', 'AUD / USD',
    'AUDUSD=X', 'yahoo',
    'https://www.rba.gov.au/statistics/frequency/exchange-rates.html', 'Market', 'USD per AUD',
    'Spot. Desk tracking only. RBA publishes a official rate we could farm later.',
    'daily', 1, 'watching', true, null),
  ('a1000000-0000-4000-8000-000000000022', 'forex', 'AUD / JPY',
    'AUDJPY=X', 'yahoo',
    'https://www.rba.gov.au/statistics/frequency/exchange-rates.html', 'Market', 'JPY per AUD',
    'Spot. Desk tracking only.',
    'daily', 1, 'watching', true, null),
  ('a1000000-0000-4000-8000-000000000023', 'forex', 'AUD / EUR',
    'AUDEUR=X', 'yahoo',
    'https://www.rba.gov.au/statistics/frequency/exchange-rates.html', 'Market', 'EUR per AUD',
    'Spot. Desk tracking only.',
    'daily', 1, 'watching', true, null),
  ('a1000000-0000-4000-8000-000000000024', 'forex', 'GBP / AUD',
    'GBPAUD=X', 'yahoo',
    'https://www.rba.gov.au/statistics/frequency/exchange-rates.html', 'Market', 'AUD per GBP',
    'Spot. Desk tracking only.',
    'daily', 1, 'watching', true, null)
on conflict (watch_id) do nothing;
