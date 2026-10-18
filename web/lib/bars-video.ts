import { createClient } from '@/lib/supabase-server';
import { loadObservations } from '@/lib/chart-from-data';
import { borrowingSpec } from '@/lib/bars-borrowing';
import type { BarsSpec } from '@/lib/bars-video-types';

/**
 * "Bars over time" videos the renderer knows (web/scripts/render-races.ts renders them when their key is passed, e.g.
 * VISUAL_KEY=bars:gov_borrowing; the Foundry Make page lists them beside the races). Each is built from stored
 * official series only.
 */
export const BAR_VIDEOS = [{ key: 'bars:gov_borrowing', label: 'Commonwealth borrowing by year, coloured by the party in office' }];

type Db = ReturnType<typeof createClient>;

const FISCAL = 'budget_fiscal_balance_au', FISCAL_PCT = 'budget_fiscal_balance_pct_gdp_au';

/** Commonwealth borrowing: the 20 latest financial years with an outcome in Treasury's historical table. */
async function govBorrowing(db: Db): Promise<BarsSpec | null> {
  const series = async (id: string) => new Map((await loadObservations(db, id).catch(() => [])).filter((o) => o.entity === 'AUS').map((o) => [o.period, o.value]));
  const [balance, pctGdp] = await Promise.all([series(FISCAL), series(FISCAL_PCT)]);
  const years = [...balance.keys()].filter((p) => /^\d{4}-\d{2}$/.test(p)).map((p) => Number(p.slice(0, 4)) + 1).sort((a, b) => a - b);
  if (!years.length) return null;
  const toYear = years.at(-1)!;
  const { data: meta } = await db.from('metrics').select('source_dataset, source_url').eq('metric_id', FISCAL).maybeSingle();
  return borrowingSpec({
    balance, pctGdp, fromYear: toYear - 19, toYear,
    source: { dataset: (meta?.source_dataset as string | undefined) ?? 'Budget Paper No. 1, Statement 11: Historical Australian Government Data, Table 11.6', url: (meta?.source_url as string | undefined) ?? undefined },
  });
}

export async function buildBarVideos(): Promise<BarsSpec[]> {
  const db = createClient();
  const all = await Promise.all([govBorrowing(db)]);
  return all.filter((s): s is BarsSpec => !!s);
}
