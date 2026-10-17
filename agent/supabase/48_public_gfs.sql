-- The government's profit and loss (/indices/australia-inc, /australia-inc): its series (gfs_*, loaded by
-- load-gfs.mjs) are official government finance statistics and readable by the public, like the country P&L.
-- Same list as 39_public_pnl.sql, plus the gfs_ prefix. Optional: the site reads with the service role, so the
-- statement shows without it; this keeps anon (public API) access consistent with the rest of the dashboard.

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
  or mid like 'pop\_%'
  -- The national accounts read as a profit and loss statement (ABS, loaded by load-pnl.mjs): official, public.
  or mid like 'pnl\_%'
  -- The government's statement of operations (IMF QGFS as reported by the Australian authorities, load-gfs.mjs).
  or mid like 'gfs\_%';
$$;

notify pgrst, 'reload schema';
