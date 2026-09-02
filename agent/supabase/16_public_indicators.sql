-- Public read for indicator metrics shown on /indicators/* and the home page.
-- Observations RLS otherwise requires authenticated users only.

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
    'credit_housing_12m_au'
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
    'credit_housing_12m_au'
  ));
