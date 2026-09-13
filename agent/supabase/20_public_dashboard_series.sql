-- Public read for the series shown on /indices and /metrics/*.
--
-- The allowlist previously lived twice, inline in two policies, and drifted:
-- ABS CPI, ABS wages and the RBA yield curve were loaded but never granted, so
-- anon reads returned nothing for them and the dashboard only worked because it
-- runs as the service role. Keep the list in one function that both policies
-- call, so granting a new public series is a single edit.

create or replace function public_dashboard_metric(mid text)
returns boolean
language sql
immutable
parallel safe
set search_path = public
as $$
  select mid = any (array[
    -- RBA rate indicator
    'rba_hike_prob_market_au',
    'rba_hold_prob_market_au',
    'rba_cut_prob_market_au',
    'rba_hike_prob_fundamentals_au',
    'rba_hold_prob_fundamentals_au',
    'rba_cut_prob_fundamentals_au',
    'asx_ib_implied_yield_au',
    -- rates
    'cash_rate_au',
    'bond_yield_10y_au',
    -- prices and wages
    'cpi_annual_au',
    'cpi_index_au',
    'wpi_annual_au',
    'inflation_rate',
    'real_wage_growth',
    'avg_wage_ppp',
    -- households, credit and housing
    'credit_housing_12m_au',
    'household_debt_income_au',
    'household_debt_to_income',
    'household_savings_rate',
    'years_to_buy_home',
    -- economy, labour and fiscal
    'gdp_per_capita',
    'gdp_nominal_usd',
    'population',
    'productivity_level',
    'productivity_growth_10y',
    'government_debt_gdp',
    'unemployment_rate'
  ]);
$$;

drop policy if exists "public read indicator observations" on observations;
create policy "public read indicator observations"
  on observations for select to anon, authenticated
  using (public_dashboard_metric(metric_id));

drop policy if exists "public read indicator metrics" on metrics;
create policy "public read indicator metrics"
  on metrics for select to anon, authenticated
  using (public_dashboard_metric(metric_id));
