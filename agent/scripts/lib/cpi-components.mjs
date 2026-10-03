/**
 * CPI components as virtual metrics.
 *
 * Every CPI item lives in cpi_observations (agent/supabase/36_cpi_components.sql), not in `observations`.
 * A story, chart or fact check names one as
 *
 *   cpi:<index_code>:<measure>[:q][:sa]
 *
 *   measure  index | period | annual | contrib_period | contrib_annual
 *   :q       quarterly (default monthly)
 *   :sa      seasonally adjusted (default original; series published only adjusted, such as the trimmed mean,
 *            fall back to it)
 *
 * e.g. cpi:40055:annual (electricity, annual change, monthly) or cpi:999902:annual:q (trimmed mean, quarterly).
 * Readings come back with entity AUS (the eight capitals) and each capital, like a cross-country series.
 */

export const CPI_ID = /^cpi:(\d+):(index|period|annual|contrib_period|contrib_annual)((?::q|:sa)*)$/;

const COLUMN = {
  index: 'index_value',
  period: 'change_period',
  annual: 'change_annual',
  contrib_period: 'contribution_period_pts',
  contrib_annual: 'contribution_annual_pts',
};

const LABEL = {
  index: { name: 'index', unit: 'index' },
  period: { name: 'change on previous period', unit: 'percent' },
  annual: { name: 'annual change', unit: 'percent' },
  contrib_period: { name: 'contribution to the CPI change on previous period', unit: 'percentage points' },
  contrib_annual: { name: 'contribution to annual CPI inflation', unit: 'percentage points' },
};

export const CPI_ENTITY_NAMES = {
  AUS: 'Australia', SYD: 'Sydney', MEL: 'Melbourne', BNE: 'Brisbane', ADL: 'Adelaide',
  PER: 'Perth', HOB: 'Hobart', DRW: 'Darwin', CBR: 'Canberra',
};

export function isCpiId(id) {
  return CPI_ID.test(String(id ?? ''));
}

export function parseCpiId(id) {
  const m = CPI_ID.exec(String(id ?? ''));
  if (!m) return null;
  const flags = m[3] ?? '';
  return { code: m[1], measure: m[2], column: COLUMN[m[2]], frequency: flags.includes(':q') ? 'Q' : 'M', sa: flags.includes(':sa') };
}

export function cpiId(code, measure, { quarterly = false, sa = false } = {}) {
  return `cpi:${code}:${measure}${quarterly ? ':q' : ''}${sa ? ':sa' : ''}`;
}

async function rows(db, p, adjustment) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('cpi_observations')
      .select(`entity, period, ${p.column}`)
      .eq('index_code', p.code).eq('frequency', p.frequency).eq('adjustment', adjustment)
      .not(p.column, 'is', null)
      .order('period', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`cpi_observations for ${p.code}: ${error.message}`);
    for (const r of data ?? []) out.push({ entity: r.entity, period: r.period, value: Number(r[p.column]) });
    if ((data?.length ?? 0) < 1000) return out;
  }
}

/** Every reading of a cpi: id, oldest first, as { entity, period, value }. */
export async function cpiObservations(db, id) {
  const p = parseCpiId(id);
  if (!p) return [];
  const first = await rows(db, p, p.sa ? 'seasonally_adjusted' : 'original');
  if (first.length || p.sa) return first;
  return rows(db, p, 'seasonally_adjusted');
}

/** Metric-style metadata for a cpi: id (null if the item is unknown). */
export async function cpiMeta(db, id) {
  const p = parseCpiId(id);
  if (!p) return null;
  const { data: item } = await db.from('cpi_items').select('name').eq('index_code', p.code).maybeSingle();
  if (!item) return null;
  const label = LABEL[p.measure];
  const freq = p.frequency === 'Q' ? 'quarterly' : 'monthly';
  return {
    metric_id: id,
    name: `CPI: ${item.name}, ${label.name} (${freq}${p.sa ? ', seasonally adjusted' : ''})`,
    unit: label.unit,
    source_org: 'ABS',
    source_dataset: p.frequency === 'Q' ? 'Consumer Price Index, Australia (quarterly)' : 'Consumer Price Index, Australia (monthly)',
    source_tier: 1,
    direction: 'higher_is_more_pressure',
  };
}
