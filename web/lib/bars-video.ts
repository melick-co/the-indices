import { createClient } from '@/lib/supabase-server';
import { loadObservations } from '@/lib/chart-from-data';
import { COVERAGE_BREAKS, gfsId, usableQuarter } from '../../agent/scripts/lib/gfs.mjs';
import { borrowingSpec, flaggedFromBasis } from '@/lib/bars-borrowing';
import type { BarsSpec } from '@/lib/bars-video-types';

/**
 * "Bars over time" videos the renderer knows (web/scripts/render-races.ts renders them when their key is passed, e.g.
 * VISUAL_KEY=bars:gov_borrowing; the Foundry Make page lists them beside the races). Each is built from stored
 * official series only.
 */
export const BAR_VIDEOS = [{ key: 'bars:gov_borrowing', label: 'Commonwealth borrowing by year, coloured by the party in office' }];

type Db = ReturnType<typeof createClient>;

/** The last financial year (by its June year) whose four quarters are all in `series`. */
function lastCompleteYear(series: Map<string, number>): number | null {
  const junes = [...series.keys()].filter((p) => p.endsWith('-Q2')).map((p) => Number(p.slice(0, 4))).sort((a, b) => b - a);
  return junes.find((y) => [`${y - 1}-Q3`, `${y - 1}-Q4`, `${y}-Q1`, `${y}-Q2`].every((q) => series.has(q))) ?? null;
}

/** Commonwealth borrowing: the 20 latest complete financial years. */
async function govBorrowing(db: Db): Promise<BarsSpec | null> {
  const obs = (await loadObservations(db, gfsId('cwth', 'nlb')).catch(() => [])).filter((o) => o.entity === 'AUS' && usableQuarter('cwth', o.period));
  if (!obs.length) return null;
  const nlb = new Map(obs.map((o) => [o.period, o.value]));
  const gdp = new Map((await loadObservations(db, 'pnl_gdp').catch(() => [])).filter((o) => o.entity === 'AUS').map((o) => [o.period, o.value]));
  const toYear = lastCompleteYear(nlb);
  if (!toYear) return null;
  const { data: meta } = await db.from('metrics').select('basis').eq('metric_id', gfsId('cwth', 'nlb')).maybeSingle();
  return borrowingSpec({
    nlb, gdp, fromYear: toYear - 19, toYear, flagged: flaggedFromBasis(meta?.basis as string | undefined),
    gapReason: `the IMF's quarterly series has no Commonwealth quarters from 2007-Q4 to 2009-Q4, and publishes ${COVERAGE_BREAKS.cwth[0]} to ${COVERAGE_BREAKS.cwth.at(-1)} on a wider coverage than the Commonwealth`,
  });
}

export async function buildBarVideos(): Promise<BarsSpec[]> {
  const db = createClient();
  const all = await Promise.all([govBorrowing(db)]);
  return all.filter((s): s is BarsSpec => !!s);
}
