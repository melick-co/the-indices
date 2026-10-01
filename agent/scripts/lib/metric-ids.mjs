/**
 * Pitch metric links.
 * Models write metric_ids freehand, so they drift from the store ("rba_cash_rate",
 * "wpi_growth"). A link must name a real metric_id: known aliases are mapped to it,
 * and anything else is kept on the pitch as unlinked (trigger_rows.unlinked_metrics)
 * so the series it wanted is still on record without posing as a link.
 * Shared by the agent scripts and the web app; keep it dependency-free.
 */

/**
 * Only exact matches: same measure, same basis. Deliberately absent because the
 * store's series is a different measure: household_debt_disposable_income (OECD
 * or RBA basis?), headline_cpi (index or change?). government_debt_gdp is
 * central government only; general government debt is gov_gross_debt_gdp.
 */
export const METRIC_ALIASES = {
  cash_rate: 'cash_rate_au',
  rba_cash_rate: 'cash_rate_au',
  rba_cash_rate_target: 'cash_rate_au',
  cpi_quarterly_aus: 'cpi_annual_au',
  cpi_inflation_annual: 'cpi_annual_au',
  dwelling_stock_total_value: 'dwelling_stock_value_bn',
  residential_dwelling_stock_value: 'dwelling_stock_value_bn',
  residential_dwelling_value_total_au: 'dwelling_stock_value_bn',
  total_value_of_dwellings: 'dwelling_stock_value_bn',
  dwelling_completions_quarterly: 'dwelling_completions',
  mean_dwelling_price_au: 'mean_dwelling_price',
  housing_credit_growth: 'credit_housing_12m_au',
  household_credit_outstanding: 'household_credit_bn',
  household_credit_outstanding_au: 'household_credit_bn',
  net_overseas_migration: 'nom_annual',
  nom_net_overseas_migration: 'nom_annual',
  rba_hike_probability_implied: 'rba_hike_prob_market_au',
  market_implied_rate_hike_probability: 'rba_hike_prob_market_au',
  oecd_gdp_per_hour_worked: 'productivity_level',
  gdp_per_hour_worked: 'productivity_level',
  labour_productivity_level_oecd_ppp: 'productivity_level',
  wage_price_index: 'wpi_annual_au',
  wpi_annual_change: 'wpi_annual_au',
  wpi_growth: 'wpi_annual_au',
  wage_price_index_private_sector: 'wpi_private_annual_au',
  wage_price_index_public_sector: 'wpi_public_annual_au',
  trimmed_mean_cpi: 'trimmed_mean_cpi_au',
  gdp_growth_quarterly: 'gdp_growth_qoq_au',
  // Unqualified "labour productivity" means the annual growth rate, as stories quote it.
  labour_productivity: 'gdp_per_hour_worked_annual_au',
  labour_productivity_growth: 'gdp_per_hour_worked_annual_au',
  market_sector_labour_productivity: 'market_gva_per_hour_annual_au',
  government_spending_pct_gdp: 'gov_expenditure_gdp',
  gross_government_debt_pct_gdp: 'gov_gross_debt_gdp',
  tax_to_gdp_ratio: 'tax_revenue_gdp',
  labour_productivity_index: 'gdp_per_hour_worked_index_au',
};

/**
 * @param {unknown} ids
 * @param {Set<string>} known real metric_ids
 * @returns {{ linked: string[], unlinked: string[] }}
 */
export function normaliseMetricIds(ids, known) {
  const linked = new Set();
  const unlinked = new Set();
  for (const raw of Array.isArray(ids) ? ids : []) {
    const id = String(raw ?? '').trim();
    if (!id) continue;
    const canonical = METRIC_ALIASES[id] ?? id;
    if (known.has(canonical)) linked.add(canonical);
    else unlinked.add(id);
  }
  return { linked: [...linked], unlinked: [...unlinked] };
}

/** Merge newly unlinked ids into a pitch's trigger_rows. */
export function withUnlinked(triggerRows, unlinked) {
  const rows = triggerRows && typeof triggerRows === 'object' ? { ...triggerRows } : {};
  if (!unlinked.length) return rows;
  const prior = Array.isArray(rows.unlinked_metrics) ? rows.unlinked_metrics : [];
  rows.unlinked_metrics = [...new Set([...prior, ...unlinked])];
  return rows;
}

/** @param {{ from: Function }} db Supabase client */
export async function loadKnownMetrics(db) {
  const { data, error } = await db.from('metrics').select('metric_id');
  if (error) throw new Error(`metrics lookup failed: ${error.message}`);
  return new Set((data ?? []).map((m) => m.metric_id));
}
