import { createClient } from '@/lib/supabase-server';
import { loadObservations } from '@/lib/chart-from-data';
import { CORE, ITEMS, gfsId, qIndex, qLabel } from '../../agent/scripts/lib/gfs.mjs';
import { commonEnd, fiscalYears, govStatement, sumFour, toQuarters, type GovPnlData, type Sector } from '@/lib/gov-pnl-core';

export type { GovPnlData, GovStatement } from '@/lib/gov-pnl-core';

/**
 * The government's profit and loss: the general government statement of operations (GFS), quarterly, loaded by
 * agent/scripts/load-gfs.mjs (gfs_cwth_* for the Commonwealth, gfs_all_* for all levels of government combined;
 * $ millions, accrual, current prices, original), summed over four quarters.
 */
export async function loadGovPnl(): Promise<GovPnlData | null> {
  const db = createClient();
  const suffixes = ITEMS.map(([s]) => s as string);
  const load = async (sector: Sector) => {
    const rows: { suffix: string; period: string; value: number }[] = [];
    await Promise.all(suffixes.map(async (suffix) => {
      const obs = await loadObservations(db, gfsId(sector, suffix)).catch(() => []);
      for (const o of obs) if (o.entity === 'AUS') rows.push({ suffix, period: o.period, value: o.value });
    }));
    // A quarter counts only with every core line (the loader stores nothing less).
    const q = toQuarters(rows);
    for (const [p, v] of q) if (CORE.some((s: string) => v[s] == null)) q.delete(p);
    return q;
  };
  const [cwth, all] = await Promise.all([load('cwth'), load('all')]);
  const end = commonEnd(cwth, all);
  if (!end) return null;
  const prior = qLabel(qIndex(end) - 4);

  const gdpObs = await loadObservations(db, 'pnl_gdp').catch(() => []);
  const gdp = new Map(gdpObs.filter((o) => o.entity === 'AUS').map((o) => [o.period, o.value]));
  const allEnd = [...all.keys()].sort().reverse().find((p) => govStatement(all, p)) ?? end;
  const ahead = allEnd > end ? govStatement(all, allEnd) : null;

  const pop = (await loadObservations(db, 'pop_erp_q').catch(() => [])).filter((o) => o.entity === 'AUS');
  const p = [...pop].reverse().find((x) => x.period <= end) ?? null;
  return {
    end,
    cwth: { now: govStatement(cwth, end)!, prior: govStatement(cwth, prior) },
    all: { now: govStatement(all, end)!, prior: govStatement(all, prior) },
    allAhead: ahead ? { end: allEnd, nob: ahead.nob, nlb: ahead.nlb } : null,
    population: p ? { value: p.value, period: p.period } : null,
    gdp: sumFour(gdp, end),
    years: fiscalYears(cwth, all, gdp),
  };
}
