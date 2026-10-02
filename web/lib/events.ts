import type { SupabaseClient } from '@supabase/supabase-js';
import { callClaudeJson } from '../../agent/scripts/lib/claude.mjs';
import { inSource } from '@/lib/source-check';
import { fetchDocument } from '../../agent/scripts/lib/html-text.mjs';
import { storeDocument } from '../../agent/scripts/lib/source-docs.mjs';

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
  /** How often it is released (monthly releases also have quarter-end pages for quarterly series). */
  cadence?: 'monthly' | 'quarterly';
}> = [
  { series: 'abs:cpi', cadence: 'monthly', title: /^Consumer Price Index, Australia/i,
    url: 'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/consumer-price-index-australia/latest-release',
    metric_ids: ['cpi_annual_au', 'trimmed_mean_cpi_au', 'rent_cpi_annual_au', 'cpi_index_au'],
    thresholds: { cpi_annual_au: 0.3, trimmed_mean_cpi_au: 0.3 } },
  { series: 'abs:wpi', cadence: 'quarterly', title: /^Wage Price Index, Australia/i,
    url: 'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/wage-price-index-australia/latest-release',
    metric_ids: ['wpi_annual_au', 'wpi_private_annual_au', 'wpi_public_annual_au'],
    thresholds: { wpi_annual_au: 0.3 } },
  { series: 'abs:labour-force', cadence: 'monthly', title: /^Labour Force, Australia/i,
    url: 'https://www.abs.gov.au/statistics/labour/employment-and-unemployment/labour-force-australia/latest-release',
    metric_ids: ['unemployment_rate_au'],
    thresholds: { unemployment_rate_au: 0.2 } },
  { series: 'abs:national-accounts', cadence: 'quarterly', title: /^Australian National Accounts: National Income/i,
    url: 'https://www.abs.gov.au/statistics/economy/national-accounts/australian-national-accounts-national-income-expenditure-and-product/latest-release',
    metric_ids: ['gdp_growth_qoq_au', 'gdp_per_capita_qoq_au', 'gdp_per_capita_au', 'gdp_per_hour_worked_index_au', 'market_gva_per_hour_index_au'],
    thresholds: { gdp_growth_qoq_au: 0.3 } },
  { series: 'abs:population', cadence: 'quarterly', title: /^National, state and territory population/i,
    url: 'https://www.abs.gov.au/statistics/people/population/national-state-and-territory-population/latest-release',
    metric_ids: ['nom_annual', 'erp_persons', 'population_growth_annual'], thresholds: {} },
  { series: 'abs:dwellings-value', cadence: 'quarterly', title: /^Total Value of Dwellings/i,
    url: 'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/total-value-dwellings/latest-release',
    metric_ids: ['dwelling_stock_value_bn', 'mean_dwelling_price'], thresholds: {} },
  { series: 'abs:lending', cadence: 'quarterly', title: /^Lending Indicators/i,
    url: 'https://www.abs.gov.au/statistics/economy/finance/lending-indicators/latest-release',
    metric_ids: [], thresholds: {} },
  { series: 'abs:building-approvals', cadence: 'monthly', title: /^Building Approvals, Australia/i,
    url: 'https://www.abs.gov.au/statistics/industry/building-and-construction/building-approvals-australia/latest-release',
    metric_ids: [], thresholds: {} },
];

/** RBA decisions move these series and are always significant. */
export const RBA_DECISION_METRICS = ['cash_rate_au', 'rba_hike_prob_market_au', 'rba_cut_prob_market_au', 'rba_hold_prob_market_au'];

// ---------- times ----------

/** A wall-clock time in a time zone as a UTC Date (handles daylight saving). */
export function zonedTime(tz: string, y: number, m: number, d: number, hh: number, mm: number): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const local = new Date(guess.toLocaleString('en-US', { timeZone: tz }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() - (local.getTime() - utc.getTime()));
}

/** A Sydney wall-clock time as a UTC Date (handles AEST/AEDT). */
export function sydneyTime(y: number, m: number, d: number, hh: number, mm: number): Date {
  return zonedTime('Australia/Sydney', y, m, d, hh, mm);
}
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

// ---------- the calendar (watch list) ----------

type Scheduled = Pick<EventRow, 'event_key' | 'kind' | 'institution' | 'series' | 'title' | 'metric_ids' | 'source_url'> & {
  scheduled_at: string; official?: boolean; origin?: string; notes?: string | null;
};

/** "Next Release 18/11/2026 Wage Price Index, Australia, September 2026" lines on stored ABS release pages. */
export function absCalendar(pages: Array<{ url: string; body: string }>): Scheduled[] {
  const out: Scheduled[] = [];
  for (const page of pages) {
    // Days and months may be one digit ("Next Release 2/12/2026").
    for (const m of page.body.matchAll(/Next Release\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+([^\n•]+)/gi)) {
      const [, d1, m1, yyyy, rawTitle] = m;
      const dd = d1.padStart(2, '0');
      const mo = m1.padStart(2, '0');
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

const MONTH_INDEX: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const pad = (n: number) => String(n).padStart(2, '0');
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** Other ABS releases worth having on the watch list as milestones (no stored series yet, so no triggers). */
export const ABS_MILESTONES: RegExp[] = [
  /^Monthly Household Spending Indicator/i, /^Retail Trade, Australia/i, /^Job Vacancies, Australia/i,
  /^International Trade in Goods/i, /^Balance of Payments and International Investment Position/i,
  /^Building Activity, Australia/i, /^Building Approvals, Australia/i, /^Lending Indicators/i,
  /^Producer Price Indexes, Australia/i, /^Selected Living Cost Indexes/i, /^Average Weekly Earnings/i,
  /^Business Indicators, Australia/i, /^Overseas Migration/i, /^Government Finance Statistics/i,
  /^Labour Account Australia/i, /^Residential Property Price Indexes/i, /^Characteristics of Employment/i,
];

/** Every ABS release we track or watch, from the ABS release calendar (six months ahead). */
export async function absReleaseCalendar(months = 6): Promise<Scheduled[]> {
  const out: Scheduled[] = [];
  const now = new Date();
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    const ym = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}`;
    const doc = await fetchDocument(`https://www.abs.gov.au/release-calendar/future-releases/${ym}/all`) as { error?: string; body: string };
    if (doc.error) continue;
    const lines = doc.body.split('\n').map((l) => l.trim());
    for (let j = 0; j < lines.length; j++) {
      const when = /^[A-Za-z]+ (\d{1,2}) ([A-Za-z]+) (\d{4}) (\d{1,2}):(\d{2})(am|pm)/.exec(lines[j]);
      if (!when) continue;
      const title = lines[j + 1] ?? '';
      const ref = lines.slice(j + 2, j + 7).find((l) => /^Reference period /i.test(l))?.replace(/^Reference period /i, '');
      const full = ref ? `${title}, ${ref}` : title;
      const rel = RELEASES.find((r) => r.title.test(title));
      const milestone = !rel && ABS_MILESTONES.some((re) => re.test(title));
      if (!rel && !milestone) continue;
      let hh = Number(when[4]) % 12;
      if (when[6] === 'pm') hh += 12;
      const at = sydneyTime(Number(when[3]), MONTH_INDEX[when[2].toLowerCase()], Number(when[1]), hh, Number(when[5]));
      const series = rel?.series ?? `abs:${slug(title.replace(/, Australia$/i, ''))}`;
      out.push({
        event_key: `${series}:${isoDate(at)}`, kind: 'release', institution: 'ABS', series, title: full,
        metric_ids: rel?.metric_ids ?? [], source_url: rel?.url ?? null, scheduled_at: at.toISOString(),
      });
    }
  }
  return [...new Map(out.map((e) => [e.event_key, e])).values()];
}

/** RBA statistical tables we load (released at 11.30am), from the RBA's weekly release schedule. */
const RBA_TABLES: Record<string, { name: string; metric_ids: string[] }> = {
  D1: { name: 'Growth in Selected Financial Aggregates', metric_ids: ['credit_housing_12m_au'] },
  D2: { name: 'Lending and Credit Aggregates', metric_ids: ['household_credit_bn'] },
  E2: { name: 'Household Finances: Selected Ratios', metric_ids: ['household_debt_income_au'] },
  E13: { name: 'Housing Loan Payments', metric_ids: ['housing_repayments_income_au'] },
};

export async function rbaTableCalendar(): Promise<Scheduled[]> {
  const doc = await fetchDocument('https://www.rba.gov.au/schedules-events/schedule.html') as { error?: string; body: string };
  if (doc.error) return [];
  const year = Number(/Week commencing \d{1,2} [A-Za-z]+ (\d{4})/.exec(doc.body)?.[1] ?? new Date().getUTCFullYear());
  const out: Scheduled[] = [];
  for (const m of doc.body.matchAll(/- ([A-Z]\d{1,2}(?:\.\d)?) [A-Za-z]+, (\d{1,2}) ([A-Za-z]{3}) (\d{1,2})\.(\d{2}) (am|pm)/g)) {
    const code = m[1];
    const table = RBA_TABLES[code];
    if (!table) continue;
    let hh = Number(m[4]) % 12;
    if (m[6] === 'pm') hh += 12;
    const at = sydneyTime(year, MONTH_INDEX[m[3].toLowerCase()], Number(m[2]), hh, Number(m[5]));
    out.push({
      event_key: `rba:table-${code.toLowerCase()}:${isoDate(at)}`, kind: 'release', institution: 'RBA',
      series: `rba:table-${code.toLowerCase()}`, title: `RBA statistical table ${code} (${table.name})`,
      metric_ids: table.metric_ids, source_url: `https://www.rba.gov.au/statistics/tables/#${code.toLowerCase()}`,
      scheduled_at: at.toISOString(),
    });
  }
  return [...new Map(out.map((e) => [e.event_key, e])).values()];
}

/** Statements on Monetary Policy (Feb, May, Aug, Nov decisions) and minutes (two weeks after each meeting). */
export function rbaPublications(meetings: Scheduled[]): Scheduled[] {
  const out: Scheduled[] = [];
  for (const meet of meetings) {
    const [, , day] = meet.event_key.split(':');
    const [y, m, d] = day.split('-').map(Number);
    const mon = MONTHS[m - 1];
    if ([2, 5, 8, 11].includes(m)) {
      out.push({
        event_key: `rba:smp:${day}`, kind: 'announcement', institution: 'RBA', series: 'rba:smp',
        title: `RBA Statement on Monetary Policy, ${MONTH_NAMES[m - 1][0].toUpperCase()}${MONTH_NAMES[m - 1].slice(1)} ${y}`,
        metric_ids: [], source_url: `https://www.rba.gov.au/publications/smp/${y}/${mon}/`, scheduled_at: meet.scheduled_at,
      });
    }
    const minutesDay = new Date(Date.UTC(y, m - 1, d + 14));
    const at = sydneyTime(minutesDay.getUTCFullYear(), minutesDay.getUTCMonth() + 1, minutesDay.getUTCDate(), 11, 30);
    out.push({
      event_key: `rba:minutes:${isoDate(at)}`, kind: 'announcement', institution: 'RBA', series: 'rba:minutes',
      title: `Minutes of the RBA Monetary Policy Board meeting of ${d} ${MONTH_NAMES[m - 1][0].toUpperCase()}${MONTH_NAMES[m - 1].slice(1)} ${y}`,
      metric_ids: [], source_url: `https://www.rba.gov.au/monetary-policy/rba-board-minutes/${y}/${day}.html`,
      scheduled_at: at.toISOString(),
    });
  }
  return out;
}

/** US Federal Reserve (FOMC) decisions: 2pm Washington time on the meeting's second day. */
export async function fedCalendar(): Promise<Scheduled[]> {
  const doc = await fetchDocument('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm') as { error?: string; body: string };
  if (doc.error) return [];
  const flat = doc.body.replace(/\n/g, ' / ');
  const out: Scheduled[] = [];
  for (const section of flat.matchAll(/(\d{4}) FOMC Meetings(.*?)(?=\d{4} FOMC Meetings|$)/g)) {
    const year = Number(section[1]);
    for (const m of section[2].matchAll(/(January|February|March|April|May|June|July|August|September|October|November|December)(?:\/(January|February|March|April|May|June|July|August|September|October|November|December))? \/ (\d{1,2})-(\d{1,2})/g)) {
      const month = MONTH_INDEX[(m[2] ?? m[1]).toLowerCase()];
      const day = Number(m[4]);
      const at = zonedTime('America/New_York', year, month, day, 14, 0);
      out.push({
        event_key: `fed:decision:${year}-${pad(month)}-${pad(day)}`, kind: 'decision', institution: 'US Federal Reserve',
        series: 'fed:decision', title: `US Federal Reserve (FOMC) decision, ${day} ${MONTH_NAMES[month - 1][0].toUpperCase()}${MONTH_NAMES[month - 1].slice(1)} ${year}`,
        metric_ids: [], scheduled_at: at.toISOString(),
        source_url: `https://www.federalreserve.gov/newsevents/pressreleases/monetary${year}${pad(month)}${pad(day)}a.htm`,
      });
    }
  }
  return out;
}

export type WatchRule = {
  institution: string; title: string; series: string; cadence: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly';
  weekday: number | null; day_of_month: number | null; time_local: string; start_date: string; end_date: string | null;
  official: boolean; source_url: string | null; metric_ids: string[]; notes: string | null; origin: string;
};

/** Expand recurring watch rules into dated events for the next `days` days (Sydney time). */
export function expandRules(rules: WatchRule[], days = 60, from = new Date()): Scheduled[] {
  const out: Scheduled[] = [];
  for (const r of rules) {
    const [hh, mm] = r.time_local.split(':').map(Number);
    const start = new Date(`${r.start_date}T00:00:00Z`);
    for (let i = 0; i <= days; i++) {
      const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + i));
      if (d < start || (r.end_date && d > new Date(`${r.end_date}T00:00:00Z`))) continue;
      const weeks = Math.round((d.getTime() - start.getTime()) / (7 * 864e5));
      const hit = r.cadence === 'weekly' ? d.getUTCDay() === r.weekday
        : r.cadence === 'fortnightly' ? d.getUTCDay() === r.weekday && weeks % 2 === 0
          : r.cadence === 'monthly' ? d.getUTCDate() === r.day_of_month
            : d.getUTCDate() === r.day_of_month && (d.getUTCMonth() - start.getUTCMonth() + 12) % 3 === 0;
      if (!hit) continue;
      const at = sydneyTime(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hh, mm);
      out.push({
        event_key: `${r.series}:${isoDate(d)}`, kind: 'release', institution: r.institution, series: r.series,
        title: r.title, metric_ids: r.metric_ids, source_url: r.source_url, scheduled_at: at.toISOString(),
        official: r.official, origin: 'rule', notes: r.notes,
      });
    }
  }
  return out;
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
  const { rate, previous } = await rateAround(db, doc.published ?? '');
  return {
    outcome: {
      decision: reply.decision ?? 'unknown',
      change_bp: reply.change_bp ?? null,
      cash_rate: rate,
      previous_rate: previous,
      statement_url: doc.url,
    },
    factors,
    summary: reply.summary ?? '',
  };
}

/**
 * The cash rate after an RBA decision and before it, from stored data. Changes take effect the day after the
 * announcement, so the rate "after" is the latest change effective within three days of the decision.
 */
export async function rateAround(db: SupabaseClient, day: string): Promise<{ rate: number | null; previous: number | null }> {
  if (!day) return { rate: null, previous: null };
  const plus3 = new Date(Date.parse(`${day}T00:00:00Z`) + 3 * 864e5).toISOString().slice(0, 10);
  const [{ data: after }, { data: before }] = await Promise.all([
    db.from('observations').select('period, value').eq('metric_id', 'cash_rate_au').lte('period', plus3).order('period', { ascending: false }).limit(1),
    db.from('observations').select('period, value').eq('metric_id', 'cash_rate_au').lte('period', day).order('period', { ascending: false }).limit(1),
  ]);
  return { rate: after?.[0]?.value ?? null, previous: before?.[0]?.value ?? null };
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
      .in('status', ['occurred', 'processed']).eq('official', true).overlaps('metric_ids', ids).gte('occurred_on', since)
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

// ---------- past releases (milestones) ----------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** The reference period at the end of a release title: "…, September 2026" or "…, June Quarter 2026". */
export function refPeriodOf(title: string): { year: number; month: number } | null {
  const m = /(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+quarter)?\s+(\d{4})\s*$/i.exec(title.trim());
  return m ? { year: Number(m[2]), month: MONTH_NAMES.indexOf(m[1].toLowerCase()) + 1 } : null;
}

/** The page for one release ("…/wage-price-index-australia/mar-2026" or "…/mar-quarter-2026"), if it exists. */
export async function releasePage(baseUrl: string, year: number, month: number) {
  const mon = MONTHS[month - 1];
  for (const slug of [`${mon}-${year}`, `${mon}-quarter-${year}`]) {
    const doc = await fetchDocument(`${baseUrl}/${slug}`) as { error?: string; url: string; title: string | null; body: string };
    if (!doc.error) return doc;
  }
  return null;
}

/** The stored value for a reference period, and the one before it (monthly or quarterly series). */
export async function valuesAt(db: SupabaseClient, metricIds: string[], thresholds: Record<string, number>, year: number, month: number) {
  // Series are stored by month ("2026-03"), quarter ("2026-Q1"), period-end date ("2025-12-31") or year ("2025").
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const periods = [`${year}-${mm}`, `${year}-${mm}-${lastDay}`, ...(month % 3 === 0 ? [`${year}-Q${month / 3}`] : []), ...(month === 12 ? [`${year}`] : [])];
  const values: Record<string, { period: string; value: number; previous: number | null }> = {};
  const reasons: string[] = [];
  for (const id of metricIds) {
    const { data: hit } = await db.from('observations').select('period, value').eq('metric_id', id).eq('entity', 'AUS').in('period', periods).limit(1);
    if (!hit?.length) continue;
    const { data: prev } = await db.from('observations').select('value').eq('metric_id', id).eq('entity', 'AUS')
      .lt('period', hit[0].period).order('period', { ascending: false }).limit(1);
    const value = Number(hit[0].value);
    const previous = prev?.length ? Number(prev[0].value) : null;
    values[id] = { period: hit[0].period, value, previous };
    const t = thresholds[id];
    if (t != null && previous != null && Math.abs(value - previous) >= t - 1e-9) reasons.push(`${id} moved ${(value - previous).toFixed(2)}`);
  }
  return { values, reasons };
}

/**
 * Record past releases of one ABS series as events (milestones for timelines): release date from the release
 * page, figures from stored data, the page stored as a source document. Existing events are left alone.
 */
export async function absHistory(db: SupabaseClient, rel: (typeof RELEASES)[number], fromYear: number, log: (m: string) => void = () => {}) {
  const base = rel.url.replace(/\/latest-release$/, '');
  const now = new Date();
  let added = 0;
  for (let y = fromYear; y <= now.getUTCFullYear(); y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === now.getUTCFullYear() && m > now.getUTCMonth() + 1) break;
      if (rel.cadence === 'quarterly' && m % 3 !== 0) continue;
      const page = await releasePage(base, y, m);
      if (!page) continue;
      const released = /Released\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(page.body);
      if (!released) continue;
      const day = `${released[3]}-${released[2].padStart(2, '0')}-${released[1].padStart(2, '0')}`;
      const key = `${rel.series}:${day}`;
      const { data: have } = await db.from('events').select('event_id, outcome').eq('event_key', key).maybeSingle();
      if (have) {
        // Recorded before its series was loaded: fill in the figures now.
        if (!Object.keys(((have.outcome ?? {}) as { values?: object }).values ?? {}).length) {
          const { values, reasons } = await valuesAt(db, rel.metric_ids, rel.thresholds, y, m);
          if (Object.keys(values).length) {
            await db.from('events').update({ outcome: { values, reasons }, significance: reasons.length ? 'breaking' : 'refresh', updated_at: new Date().toISOString() }).eq('event_id', have.event_id);
            log(`  ${day}: filled in ${Object.keys(values).join(', ')}`);
          }
        }
        continue;
      }
      await storeDocument(db, { ...page, publisher: 'ABS', kind: 'release', published: day }).catch(() => {});
      const { values, reasons } = await valuesAt(db, rel.metric_ids, rel.thresholds, y, m);
      const { error } = await db.from('events').insert({
        event_key: key, kind: 'release', institution: 'ABS', series: rel.series, title: page.title ?? key,
        occurred_on: day, status: 'processed', metric_ids: rel.metric_ids, outcome: { values, reasons },
        source_url: page.url, significance: reasons.length ? 'breaking' : 'refresh',
        summary: reasons.length ? `Significant: ${reasons.join('; ')}` : 'Routine release',
        actions: { note: 'history; no triggers' }, processed_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
      added++;
      log(`  ${day}: ${page.title} ${Object.entries(values).map(([k, v]) => `${k}=${v.value}`).join(' ')}`);
    }
  }
  return added;
}
