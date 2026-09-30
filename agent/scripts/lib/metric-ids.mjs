/**
 * Pitch metric links.
 * Models write metric_ids freehand, so they drift from the store ("rba_cash_rate",
 * "wpi_growth"). A link must name a real metric_id: known aliases are mapped to it,
 * and anything else is kept on the pitch as unlinked (trigger_rows.unlinked_metrics)
 * so the series it wanted is still on record without posing as a link.
 * Shared by the agent scripts and the web app; keep it dependency-free.
 */

/** Only exact matches: same measure, same basis. */
export const METRIC_ALIASES = {
  cash_rate: 'cash_rate_au',
  rba_cash_rate: 'cash_rate_au',
  cpi_quarterly_aus: 'cpi_annual_au',
  dwelling_stock_total_value: 'dwelling_stock_value_bn',
  housing_credit_growth: 'credit_housing_12m_au',
  net_overseas_migration: 'nom_annual',
  rba_hike_probability_implied: 'rba_hike_prob_market_au',
  wage_price_index: 'wpi_annual_au',
  wpi_annual_change: 'wpi_annual_au',
  wpi_growth: 'wpi_annual_au',
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
