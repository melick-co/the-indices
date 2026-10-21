import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase-server';
import { loadObservations } from '@/lib/chart-from-data';
import { chartPathFor } from '@/lib/australia-inc';
import {
  TERMS, assess, baselineObs, changeBetween, difference, inTerm, latestObs, marker, sumFourQuarters, summaryLine,
  type Assessment, type Commitment, type Obs, type Rating, type TermKey,
} from '@/lib/scorecard';
import { OUTCOMES, type OutcomeDef, type SeriesRef } from '@/lib/scorecard-outcomes';

/**
 * Reads for /australia-inc/scorecard. Every read tolerates the tables not existing yet (before migration 49): the page
 * then shows its empty states. Ratings are worked out here from the stored series at render time, with the same pure
 * rules the weekly maintenance run uses to log rating changes (lib/scorecard.ts).
 */

export type CommitmentRow = Commitment & {
  id: string; slug: string; title: string; quote: string; source_url: string; source_title: string | null; source_date: string | null;
  metric_id: string | null; target_unit: string | null; baseline_period: string | null; status: 'active' | 'awaiting_data' | 'held' | 'retired';
  series_label: string | null; data_note: string | null; rating: string | null; updated_at: string | null;
  check?: { basis?: { start_basis?: string | null }; verified_against?: 'live' | 'cache' | null; document_fetched_at?: string | null } | null;
};

export type ScoredCommitment = CommitmentRow & { a: Assessment; seriesHref: string | null; seriesName: string | null };

export type OutcomeRow = {
  def: OutcomeDef;
  base: Obs | null; latest: Obs | null; change: number | null; mark: string;
  second?: { base: Obs | null; latest: Obs | null; change: number | null; mark: string };
  oecd: { base: Obs | null; latest: Obs | null; change: number | null; entity: string } | null;
  issue: string | null;
};

export type ScorecardData = {
  term: TermKey;
  installed: boolean;
  promises: ScoredCommitment[];
  awaiting: CommitmentRow[];
  outcomes: OutcomeRow[];
  summary: string;
};

const COLS = 'id, slug, title, quote, source_url, source_title, source_date, metric_id, series_label, target_value, target_unit, target_date, start_date, direction, baseline_value, baseline_period, method, status, data_note, rating, updated_at, check';

async function commitments(db: SupabaseClient): Promise<CommitmentRow[] | null> {
  try {
    const { data, error } = await db.from('scorecard_commitments').select(COLS).in('status', ['active', 'awaiting_data']).order('target_date', { ascending: true });
    if (error) return null;
    return (data ?? []).map((r) => ({ ...r, target_value: Number(r.target_value), baseline_value: r.baseline_value == null ? null : Number(r.baseline_value) })) as CommitmentRow[];
  } catch { return null; }
}

/** One series as the page shows it: transformed (four-quarter sums, $bn) or differenced. */
export async function seriesOf(db: SupabaseClient, ref: SeriesRef): Promise<Obs[]> {
  const load = async (id: string) => (await loadObservations(db, id).catch(() => [])).filter((o) => o.entity === 'AUS').map(({ period, value }) => ({ period, value }));
  let obs = await load(ref.metric_id);
  if (ref.minus) obs = difference(obs, await load(ref.minus));
  if (ref.transform === 'sum4' || ref.transform === 'sum4_bn') obs = sumFourQuarters(obs);
  if (ref.transform === 'bn' || ref.transform === 'sum4_bn') obs = obs.map((o) => ({ ...o, value: o.value / 1000 }));
  return obs;
}

function compare(obs: Obs[], date: string, kind: OutcomeDef['change']) {
  const base = baselineObs(obs, date);
  const latest = latestObs(obs);
  const change = base && latest && base.period !== latest.period ? changeBetween(base.value, latest.value, kind) : null;
  return { base, latest, change, mark: marker(change) };
}

export async function loadOutcome(db: SupabaseClient, def: OutcomeDef, term: TermKey): Promise<OutcomeRow> {
  const date = TERMS[term].date;
  const p = compare(await seriesOf(db, def.primary), date, def.change);
  const second = def.secondary ? compare(await seriesOf(db, def.secondary), date, def.change) : undefined;
  let oecd: OutcomeRow['oecd'] = null;
  if (def.oecd) {
    const all = await loadObservations(db, def.oecd.metric_id).catch(() => []);
    for (const e of def.oecd.entities) {
      const rows = all.filter((o) => o.entity === e).map(({ period, value }) => ({ period, value }));
      if (!rows.length) continue;
      const c = compare(rows, date, def.change);
      if (c.change != null) { oecd = { base: c.base, latest: c.latest, change: c.change, entity: e }; break; }
    }
  }
  const issue = !p.latest ? 'Awaiting official data: the series is not in the store yet.'
    : !p.base ? 'The stored series does not reach back to the baseline.'
      : p.base.period === p.latest.period ? 'No reading since the baseline yet.' : null;
  return { def, ...p, second, oecd, issue };
}

export async function loadScorecard(term: TermKey): Promise<ScorecardData> {
  const db = createClient();
  const rows = await commitments(db);
  const live = (rows ?? []).filter((r) => inTerm(r, term));
  const names = new Map<string, { name: string; url: string | null }>();
  const ids = [...new Set(live.map((r) => r.metric_id).filter((x): x is string => !!x && !x.startsWith('cpi:')))];
  if (ids.length) {
    const { data } = await db.from('metrics').select('metric_id, name, source_url').in('metric_id', ids);
    for (const m of data ?? []) names.set(m.metric_id, { name: m.name, url: m.source_url });
  }
  const promises: ScoredCommitment[] = [];
  for (const r of live.filter((x) => x.status === 'active' && x.metric_id)) {
    const obs = (await loadObservations(db, r.metric_id!).catch(() => [])).filter((o) => o.entity === 'AUS').map(({ period, value }) => ({ period, value }));
    const meta = names.get(r.metric_id!);
    promises.push({ ...r, a: assess(r, obs), seriesHref: chartPathFor(r.metric_id)?.path ?? meta?.url ?? null, seriesName: r.series_label ?? meta?.name ?? r.metric_id });
  }
  const outcomes = await Promise.all(OUTCOMES.map((d) => loadOutcome(db, d, term).catch(() => ({ def: d, base: null, latest: null, change: null, mark: '', oecd: null, issue: 'Could not be read.' }) as OutcomeRow)));
  return {
    term, installed: rows != null, promises,
    awaiting: live.filter((x) => x.status === 'awaiting_data'),
    outcomes,
    summary: summaryLine(promises.map((p) => p.a.rating)),
  };
}

/** The one-line summary for /australia-inc (the current term), or null before there is anything to say. */
export async function loadScorecardSummary(): Promise<string | null> {
  try {
    const db = createClient();
    const rows = await commitments(db);
    if (!rows?.length) return null;
    const live = rows.filter((r) => r.status === 'active' && r.metric_id && inTerm(r, '2025'));
    const ratings: Rating[] = [];
    for (const r of live) {
      const obs = (await loadObservations(db, r.metric_id!).catch(() => [])).filter((o) => o.entity === 'AUS').map(({ period, value }) => ({ period, value }));
      ratings.push(assess(r, obs).rating);
    }
    return summaryLine(ratings) || null;
  } catch { return null; }
}
