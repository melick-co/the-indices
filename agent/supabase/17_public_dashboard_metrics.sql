-- Public read for dashboard macro metrics shown on /indices and /metrics/*.

drop policy if exists "public read indicator observations" on observations;
create policy "public read indicator observations"
  on observations for select to anon, authenticated
  using (metric_id in (
    'rba_hike_prob_market_au',
    'rba_hold_prob_market_au',
    'rba_cut_prob_market_au',
    'rba_hike_prob_fundamentals_au',
    'rba_hold_prob_fundamentals_au',
    'rba_cut_prob_fundamentals_au',
    'asx_ib_implied_yield_au',
    'cash_rate_au',
    'inflation_rate',
    'credit_housing_12m_au',
    'gdp_per_capita',
    'gdp_nominal_usd',
    'population',
    'productivity_level',
    'productivity_growth_10y',
    'government_debt_gdp',
    'household_debt_income_au',
    'household_debt_to_income',
    'years_to_buy_home',
    'unemployment_rate'
  ));

drop policy if exists "public read indicator metrics" on metrics;
create policy "public read indicator metrics"
  on metrics for select to anon, authenticated
  using (metric_id in (
    'rba_hike_prob_market_au',
    'rba_hold_prob_market_au',
    'rba_cut_prob_market_au',
    'rba_hike_prob_fundamentals_au',
    'rba_hold_prob_fundamentals_au',
    'rba_cut_prob_fundamentals_au',
    'asx_ib_implied_yield_au',
    'cash_rate_au',
    'inflation_rate',
    'credit_housing_12m_au',
    'gdp_per_capita',
    'gdp_nominal_usd',
    'population',
    'productivity_level',
    'productivity_growth_10y',
    'government_debt_gdp',
    'household_debt_income_au',
    'household_debt_to_income',
    'years_to_buy_home',
    'unemployment_rate'
  ));
