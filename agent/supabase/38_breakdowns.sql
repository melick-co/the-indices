-- Official series published by category (country of birth, visa group, reason for travel), for the population page.
--
-- A single-series metric can't hold 250 countries or 16 visa groups, so these live here, one row per dataset,
-- category, region and period. Loaded by agent/scripts/load-population.mjs from the ABS Data API:
--
--   erp_cob              ERP_COB          residents by country of birth, as at 30 June (persons)
--   migrant_arrivals_visa    OMAD_VISA    overseas migrant arrivals by visa group, quarterly (persons)
--   migrant_departures_visa  OMAD_VISA    overseas migrant departures by visa group, quarterly (persons)
--   visitors_reason      OAD_REASON       short-term visitor arrivals by main reason for the trip, monthly (persons)
--   visitors_country     OAD_COUNTRY      short-term visitor arrivals by country of residence, monthly (persons)
--   residents_trips_reason   OAD_REASON   Australian residents returning from short trips abroad, by main reason (persons)
--   residents_trips_country  OAD_COUNTRY  the same by main destination country (persons)

create table if not exists breakdowns (
  dataset        text not null,
  category       text not null,          -- the ABS code (e.g. 1201 New Zealand, 3 Higher education sector)
  category_name  text not null,
  category_level text not null default 'item',   -- 'total', 'group' (a regional or visa total) or 'item'
  region         text not null default 'AUS',
  period         text not null,          -- 2025, 2026-Q1 or 2026-07, as the ABS publishes it
  value          numeric not null,
  source_url     text not null,
  updated_at     timestamptz not null default now(),
  primary key (dataset, category, region, period)
);

create index if not exists breakdowns_dataset_period on breakdowns (dataset, period);

alter table breakdowns enable row level security;

-- Official statistics: public.
drop policy if exists "public reads breakdowns" on breakdowns;
create policy "public reads breakdowns" on breakdowns for select to anon, authenticated using (true);

-- The population page's series (pop_*) are official ABS statistics: readable by the public, like the rest of the
-- dashboard's series. Same list as 28_instruments.sql, plus the pop_ prefix.
create or replace function public_dashboard_metric(mid text)
returns boolean
language sql
immutable
parallel safe
set search_path = public
as $$
  select mid = any (array[
    'rba_hike_prob_market_au',
    'rba_hold_prob_market_au',
    'rba_cut_prob_market_au',
    'rba_hike_prob_fundamentals_au',
    'rba_hold_prob_fundamentals_au',
    'rba_cut_prob_fundamentals_au',
    'asx_ib_implied_yield_au',
    'cash_rate_au',
    'bond_yield_10y_au',
    'cpi_annual_au',
    'cpi_index_au',
    'wpi_annual_au',
    'inflation_rate',
    'real_wage_growth',
    'avg_wage_ppp',
    'credit_housing_12m_au',
    'household_debt_income_au',
    'household_debt_to_income',
    'household_savings_rate',
    'years_to_buy_home',
    'gdp_per_capita',
    'gdp_nominal_usd',
    'population',
    'productivity_level',
    'productivity_growth_10y',
    'government_debt_gdp',
    'unemployment_rate',
    'ags_face_value_bn',
    'ags_interest_payments_bn',
    'gst_receipts_bn',
    'gdp_nominal_aud_bn',
    'household_credit_bn',
    'erp_persons',
    'nom_annual',
    'natural_increase_annual',
    'population_growth_annual',
    'dwelling_completions',
    'dwelling_stock_value_bn',
    'mean_dwelling_price'
  ])
  -- Population and its components (ABS ERP_COMP_Q, loaded by load-population.mjs): official, public.
  or mid like 'pop\_%';
$$;

notify pgrst, 'reload schema';
