import type { SupabaseClient } from '@supabase/supabase-js';
import { callClaudeJson } from '../../agent/scripts/lib/claude.mjs';
import { inSource } from '@/lib/source-check';

/**
 * The events store (agent/supabase/34_events.sql): decisions and releases with the factors behind them, and
 * the watch list of upcoming ones. Policy (event-triggers, Oct 2026): every RBA decision and any big move in
 * CPI, wages, unemployment or GDP is significant and gets a breaking story; every watched release refreshes
 * the published articles that quote its series.
 */

export type EventFactor = { factor: string; direction: 'up' | 'down' | 'risk' | 'neutral'; quote: string; source_url: string };
export type EventRow = {
  event_id: string; event_key: string; kind: 'decision' | 'release' | 'announcement'; institution: string;
  series: string; title: string; scheduled_at: string | null; occurred_on: string | null;
  status: 'scheduled' | 'due' | 'occurred' | 'processed' | 'cancelled'; metric_ids: string[];
  outcome: Record<string, unknown> | null; factors: EventFactor[]; summary: string | null; source_url: string | null;
  significance: 'breaking' | 'refresh' | 'none' | null; actions: Record<string, unknown> | null; attempts: number;
};

/**
 * ABS releases we watch: which stored series each one moves, and how big a move in its headline series makes
 * it significant (in the series' own units: percentage points for rates).
 */
export const RELEASES: Array<{
  series: string; title: RegExp; url: string; metric_ids: string[]; thresholds: Record<string, number>;
}> = [
  { series: 'abs:cpi', title: /^Consumer Price Index, Australia/i,
    url: 'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/consumer-price-index-australia/latest-release',
    metric_ids: ['cpi_annual_au', 'trimmed_mean_cpi_au', 'rent_cpi_annual_au', 'cpi_index_au'],
    thresholds: { cpi_annual_au: 0.3, trimmed_mean_cpi_au: 0.3 } },
  { series: 'abs:wpi', title: /^Wage Price Index, Australia/i,
    url: 'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/wage-price-index-australia/latest-release',
    metric_ids: ['wpi_annual_au', 'wpi_private_annual_au', 'wpi_public_annual_au'],
    thresholds: { wpi_annual_au: 0.3 } },
  { series: 'abs:labour-force', title: /^Labour Force, Australia/i,
    url: 'https://www.abs.gov.au/statistics/labour/employment-and-unemployment/labour-force-australia/latest-release',
    metric_ids: ['unemployment_rate_au'],
    thresholds: { unemployment_rate_au: 0.2 } },
  { series: 'abs:national-accounts', title: /^Australian National Accounts: National Income/i,
    url: 'https://www.abs.gov.au/statistics/economy/national-accounts/australian-national-accounts-national-income-expenditure-and-product/latest-release',
    metric_ids: ['gdp_growth_qoq_au', 'gdp_per_capita_qoq_au', 'gdp_per_capita_au', 'gdp_per_hour_worked_index_au', 'market_gva_per_hour_index_au'],
    thresholds: { gdp_growth_qoq_au: 0.3 } },
  { series: 'abs:population', title: /^National, state and territory population/i,
    url: 'https://www.abs.gov.au/statistics/people/population/national-state-and-territory-population/latest-release',
    metric_ids: ['nom_annual', 'erp_persons', 'population_growth_annual'], thresholds: {} },
  { series: 'abs:dwellings-value', title: /^Total Value of Dwellings/i,
    url: 'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/total-value-dwellings/latest-release',
    metric_ids: ['dwelling_stock_value_bn', 'mean_dwelling_price'], thresholds: {} },
  { series: 'abs:lending', title: /^Lending Indicators/i,
    url: 'https://www.abs.gov.au/statistics/economy/finance/lending-indicators/latest-release',
    metric_ids: [], thresholds: {} },
  { series: 'abs:building-approvals', title: /^Building Approvals, Australia/i,
    url: 'https://www.abs.gov.au/statistics/industry/building-and-construction/building-approvals-australia/latest-release',
    metric_ids: [], thresholds: {} },
];

/** RBA decisions move these series and are always significant. */
export const RBA_DECISION_METRICS = ['cash_rate_au', 'rba_hike_prob_market_au', 'rba_cut_prob_market_au', 'rba_hold_prob_market_au'];

// ---------- times ----------

/** A Sydney wall-clock time as a UTC Date (handles AEST/AEDT). */
export function sydneyTime(y: number, m: number, d: number, hh: number, mm: number): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const local = new Date(guess.toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() - (local.getTime() - utc.getTime()));
}
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

// ---------- the calendar (watch list) ----------

type Scheduled = Pick<EventRow, 'event_key' | 'kind' | 'institution' | 'series' | 'title' | 'metric_ids' | 'source_url'> & { scheduled_at: string };

/** "Next Release 18/11/2026 Wage Price Index, Australia, September 2026" lines on stored ABS release pages. */
export function absCalendar(pages: Array<{ url: string; body: string }>): Scheduled[] {
  const out: Scheduled[] = [];
  for (const page of pages) {
    for (const m of page.body.matchAll(/Next Release\s+(\d{2})\/(\d{2})\/(\d{4})\s+([^\n•]+)/gi)) {
      const [, dd, mo, yyyy, rawTitle] = m;
      const title = rawTitle.trim();
      const rel = RELEASES.find((r) => r.title.test(title));
      if (!rel) continue;
      const at = sydneyTime(Number(yyyy), Number(mo), Number(dd), 11, 30); // ABS releases at 11:30am Canberra time
      out.push({
        event_key: `${rel.series}:${yyyy}-${mo}-${dd}`, kind: 'release', institution: 'ABS', series: rel.series,
        title, metric_ids: rel.metric_ids, source_url: rel.url, scheduled_at: at.toISOString(),
      });
    }
  }
  return [...new Map(out.map((e) => [e.event_key, e])).values()];
}

/** RBA Monetary Policy Board meeting dates from the minutes index (it lists future meetings). */
export async function rbaCalendar(years: number[]): Promise<Scheduled[]> {
  const out: Scheduled[] = [];
  for (const y of years) {
    const res = await fetch(`https://www.rba.gov.au/monetary-policy/rba-board-minutes/${y}/`, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; caveat-events/0.1)' }, signal: AbortSignal.timeout(30000),
    }).catch(() => null);
    if (!res?.ok) continue;
    const html = await res.text();
    for (const m of html.matchAll(/rba-board-minutes\/\d{4}\/(\d{4})-(\d{2})-(\d{2})\.html/g)) {
      const [, yyyy, mo, dd] = m;
      const at = sydneyTime(Number(yyyy), Number(mo), Number(dd), 14, 30); // decisions are announced at 2.30pm
      out.push({
        event_key: `rba:decision:${yyyy}-${mo}-${dd}`, kind: 'decision', institution: 'RBA', series: 'rba:decision',
        title: `RBA monetary policy decision, ${Number(dd)} ${at.toLocaleString('en-AU', { month: 'long', timeZone: 'Australia/Sydney' })} ${yyyy}`,
        metric_ids: RBA_DECISION_METRICS, source_url: 'https://www.rba.gov.au/media-releases/', scheduled_at: at.toISOString(),
      });
    }
  }
  return [...new Map(out.map((e) => [e.event_key, e])).values()];
}

/** Add future events to the watch list; existing rows (past or already processed) are left alone. */
export async function scheduleEvents(db: SupabaseClient, events: Scheduled[]): Promise<number> {
  const future = events.filter((e) => new Date(e.scheduled_at).getTime() > Date.now() - 6 * 3600e3);
  if (!future.length) return 0;
  const { data: existing } = await db.from('events').select('event_key').in('event_key', future.map((e) => e.event_key));
  const have = new Set((existing ?? []).map((r) => r.event_key));
  const fresh = future.filter((e) => !have.has(e.event_key)).map((e) => ({ ...e, status: 'scheduled' }));
  if (fresh.length) {
    const { error } = await db.from('events').insert(fresh);
    if (error) throw new Error(error.message);
  }
  return fresh.length;
}

// ---------- recording what happened ----------

type Doc = { url: string; title: string | null; body: string; published: string | null };

/**
 * An RBA decision from its statement: the decision and the factors the Board gave, each with a quote that
 * must appear word for word in the statement (unverifiable factors are dropped). The cash rate itself comes
 * from stored data, not the model.
 */
export async function extractRbaDecision(db: SupabaseClient, doc: Doc): Promise<{
  outcome: Record<string, unknown>; factors: EventFactor[]; summary: string;
}> {
  const reply = await callClaudeJson(`Below is a Reserve Bank of Australia monetary policy decision statement.

<statement url="${doc.url}">
${doc.body.slice(0, 12000)}
</statement>

Extract the decision and the factors the Board gave for it. For each factor, copy a short verbatim quote from
the statement that states it (exactly as written). Direction: "up" if it pushes inflation or rates up, "down"
if it pushes them down, "risk" for an uncertainty the Board flags, "neutral" otherwise. At most 8 factors.

Respond ONLY with JSON:
{"decision":"raise|cut|hold","change_bp":25,"summary":"one sentence, plain words","factors":[{"factor":"short label","direction":"up|down|risk|neutral","quote":"verbatim"}]}`,
  { label: 'rba decision' }) as { decision?: string; change_bp?: number; summary?: string; factors?: Array<Omit<EventFactor, 'source_url'>> };
  const norm = (t: string) => t.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  const body = norm(doc.body);
  const factors = (reply.factors ?? [])
    .filter((f) => f?.quote && inSource(f.quote, [body]))
    .map((f) => ({ ...f, source_url: doc.url }));
  // The rate from stored data: the cash rate in effect on or after the decision day.
  const day = doc.published ?? '';
  const { data: obs } = await db.from('observations').select('period, value')
    .eq('metric_id', 'cash_rate_au').gte('period', day).order('period').limit(1);
  const { data: prior } = await db.from('observations').select('period, value')
    .eq('metric_id', 'cash_rate_au').lt('period', day).order('period', { ascending: false }).limit(1);
  const rate = obs?.[0]?.value ?? prior?.[0]?.value ?? null;
  return {
    outcome: {
      decision: reply.decision ?? 'unknown',
      change_bp: reply.change_bp ?? null,
      cash_rate: rate,
      previous_rate: prior?.[0]?.value ?? null,
      statement_url: doc.url,
    },
    factors,
    summary: reply.summary ?? '',
  };
}

/** Latest two stored values for each of a release's series, and whether the move is significant. */
export async function releaseOutcome(db: SupabaseClient, metricIds: string[], thresholds: Record<string, number>) {
  const values: Record<string, { period: string; value: number; previous: number | null; previous_period: string | null; record: 'high' | 'low' | null }> = {};
  const reasons: string[] = [];
  for (const id of metricIds) {
    const { data } = await db.from('observations').select('period, value')
      .eq('metric_id', id).eq('entity', 'AUS').order('period', { ascending: false }).limit(120);
    const rows = (data ?? []).filter((r) => r.value != null);
    if (!rows.length) continue;
    const [latest, prev] = rows;
    const history = rows.slice(1).map((r) => Number(r.value));
    const record = history.length >= 20
      ? (Number(latest.value) > Math.max(...history) ? 'high' : Number(latest.value) < Math.min(...history) ? 'low' : null)
      : null;
    values[id] = { period: latest.period, value: Number(latest.value), previous: prev ? Number(prev.value) : null, previous_period: prev?.period ?? null, record };
    const t = thresholds[id];
    if (t != null && prev && Math.abs(Number(latest.value) - Number(prev.value)) >= t - 1e-9) {
      reasons.push(`${id} moved ${(Number(latest.value) - Number(prev.value)).toFixed(2)} (threshold ${t})`);
    }
    if (t != null && record) reasons.push(`${id} at a ${record} over the last ${history.length} readings`);
  }
  return { values, significant: reasons.length > 0, reasons };
}

// ---------- context for the writer ----------

/**
 * Events relevant to a story's series: recent decisions and releases with their factors, and what is coming
 * up. Each carries the URL of the release that announced it, for timelines.
 */
export async function eventsContext(db: SupabaseClient, metricIds: string[]): Promise<string> {
  const ids = [...new Set([...metricIds, ...RBA_DECISION_METRICS.slice(0, 1)])];
  const since = isoDate(new Date(Date.now() - 2 * 365 * 864e5));
  const [{ data: past, error }, { data: next }] = await Promise.all([
    db.from('events').select('title, occurred_on, series, outcome, factors, summary, source_url')
      .in('status', ['occurred', 'processed']).overlaps('metric_ids', ids).gte('occurred_on', since)
      .order('occurred_on', { ascending: false }).limit(12),
    db.from('events').select('title, scheduled_at, source_url')
      .eq('status', 'scheduled').overlaps('metric_ids', ids).gte('scheduled_at', new Date().toISOString())
      .order('scheduled_at').limit(4),
  ]);
  if (error || (!past?.length && !next?.length)) return '';
  const lines = (past ?? []).map((e) => {
    const factors = (e.factors as EventFactor[] ?? []).slice(0, 5).map((f) => `    - ${f.factor} (${f.direction}): "${f.quote}"`).join('\n');
    return `- ${e.occurred_on}: ${e.title}. ${e.summary ?? ''} Source: ${e.source_url}\n    Outcome: ${JSON.stringify(e.outcome)}${factors ? `\n    Factors:\n${factors}` : ''}`;
  });
  const coming = (next ?? []).map((e) => `- ${String(e.scheduled_at).slice(0, 10)}: ${e.title} (${e.source_url})`);
  return `${lines.length ? `Recent decisions and releases (newest first):\n${lines.join('\n')}` : ''}${coming.length ? `\n\nComing up:\n${coming.join('\n')}` : ''}`;
}
