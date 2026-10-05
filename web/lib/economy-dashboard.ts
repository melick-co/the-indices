import { createClient } from '@/lib/supabase-server';
import { loadObservations } from '@/lib/chart-from-data';
import { cpiMeta, isCpiId } from '../../agent/scripts/lib/cpi-components.mjs';
import { SECTIONS, indicatorsOf, type Indicator, type Section } from '@/content/dashboard/economy';

/** OECD members: the peer group for cross-country comparisons. */
const OECD = new Set(['AUS', 'AUT', 'BEL', 'CAN', 'CHL', 'COL', 'CRI', 'CZE', 'DNK', 'EST', 'FIN', 'FRA', 'DEU', 'GRC',
  'HUN', 'ISL', 'IRL', 'ISR', 'ITA', 'JPN', 'KOR', 'LVA', 'LTU', 'LUX', 'MEX', 'NLD', 'NZL', 'NOR', 'POL', 'PRT', 'SVK',
  'SVN', 'ESP', 'SWE', 'CHE', 'TUR', 'GBR', 'USA']);

type Obs = { entity: string; period: string; value: number };
export type Point = { period: string; value: number };

export type Status = 'on-target' | 'better' | 'worse' | 'above' | 'below' | 'neutral';

export type Reading = {
  key: string;
  indicator: Indicator & { key: string };
  name: string;
  source: string | null;
  latest: Point | null;
  previous: Point | null;
  history: Point[];
  average: number | null;
  averageYears: number | null;
  status: Status;
  /** One line for tiles: how the latest compares with the benchmark. */
  verdict: string;
  /** What the numbers are telling us: a few sentences generated from the data. */
  summary: string[];
  peers: { metric_id: string; label: string; unit: Indicator['unit']; period: string; rank: number; of: number; median: number; aus: number; rows: Obs[]; bestFirst: boolean } | null;
  /** How the average is described: "10-year average" or "average since August 2025". */
  averageLabel: string | null;
};

export const ordinal = (n: number) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** At least `min` decimal places ("0" → "0.0"), keeping any extra precision the value has ("0.18" stays). */
function atLeast(text: string, min?: number): string {
  if (!min) return text;
  const m = text.match(/^([^0-9-]*-?[\d,]+)(?:\.(\d+))?(.*)$/);
  if (!m) return text;
  const dec = m[2] ?? '';
  return dec.length >= min ? text : `${m[1]}.${dec.padEnd(min, '0')}${m[3]}`;
}

function fmt(n: number, unit: Indicator['unit'], minDecimals?: number): string {
  return atLeast(fmtBase(n, unit), minDecimals);
}

function fmtBase(n: number, unit: Indicator['unit']): string {
  const a = Math.abs(n);
  switch (unit) {
    case 'percent': case 'percent_gdp': return `${round(n, a < 10 ? 2 : 1)}%`;
    case 'pts': return `${n > 0 ? '+' : ''}${round(n, 2)} pts`;
    case 'aud': return `A$${Math.round(n).toLocaleString('en-AU')}`;
    case 'aud_bn': return `A$${Math.round(n).toLocaleString('en-AU')} billion`;
    case 'persons': return Math.round(n).toLocaleString('en-AU');
    case 'per_1000': return `${round(n, 2)} per 1,000`;
    case 'usd': return `US$${Math.round(n).toLocaleString('en-AU')}`;
    case 'years': return `${round(n, 1)} years`;
    case 'points': return `${Math.round(n)} points`;
    case 'score': return `${round(n, 1)} / 10`;
    case 'per_100k': return `${round(n, 1)} per 100,000`;
    case 'ratio': return `${round(n, 2)}×`;
    case 'index': return `${round(n, 1)}`;
    default: return round(n, 2).toLocaleString('en-AU');
  }
}
export { fmt as formatReading };

/** Units whose changes read as an absolute amount ("up 0.2 years"), not a percentage. */
const ABSOLUTE: Partial<Record<NonNullable<Indicator['unit']>, (d: number) => string>> = {
  years: (d) => `${round(d, 1)} years`, points: (d) => `${Math.round(d)} points`, score: (d) => `${round(d, 1)} points`,
  per_100k: (d) => `${round(d, 1)} per 100,000`, ratio: (d) => `${round(d, 2)}`, index: (d) => `${round(d, 1)} points`,
};
export { ABSOLUTE as absoluteChange };

/** Change wording: points for rates, the amount for scores and years, per cent for other levels. */
function changeText(latest: number, prev: number, unit: Indicator['unit']): string {
  const abs = unit && ABSOLUTE[unit];
  if (abs) {
    const d = latest - prev;
    return abs(Math.abs(d)) === abs(0) ? 'unchanged' : `${d > 0 ? 'up' : 'down'} ${abs(Math.abs(d))}`;
  }
  const rate = unit === 'percent' || unit === 'percent_gdp' || unit === 'pts';
  const d = rate ? latest - prev : prev ? ((latest - prev) / Math.abs(prev)) * 100 : 0;
  if (Math.abs(d) < 0.005) return 'unchanged';
  return `${d > 0 ? 'up' : 'down'} ${round(Math.abs(d), 2)}${rate ? ' pts' : '%'}`;
}

/** Periods (2026-Q2, 2026-08, 2026-09-30, 2025) as dates for averaging windows. */
function periodDate(p: string): Date {
  if (/^\d{4}-Q[1-4]$/.test(p)) return new Date(Date.UTC(Number(p.slice(0, 4)), (Number(p[6]) - 1) * 3, 1));
  if (/^\d{4}-\d{2}$/.test(p)) return new Date(`${p}-01T00:00:00Z`);
  if (/^\d{4}$/.test(p)) return new Date(Date.UTC(Number(p), 0, 1));
  return new Date(`${p.slice(0, 10)}T00:00:00Z`);
}

function periodLabel(p: string): string {
  if (p.startsWith('latest')) return p;
  if (/^\d{4}-Q[1-4]$/.test(p)) return `${['March', 'June', 'September', 'December'][Number(p[6]) - 1]} quarter ${p.slice(0, 4)}`;
  if (/^\d{4}-\d{2}$/.test(p)) return periodDate(p).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  if (/^\d{4}$/.test(p)) return p;
  return periodDate(p).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
export { periodLabel };

async function seriesOf(db: ReturnType<typeof createClient>, ind: Indicator): Promise<{ aus: Point[]; all: Obs[] }> {
  const all = await loadObservations(db, ind.metric_id).catch(() => [] as Obs[]);
  let aus = all.filter((o) => o.entity === 'AUS').sort((a, b) => a.period.localeCompare(b.period)).map(({ period, value }) => ({ period, value }));
  if (ind.minus) {
    const other = new Map((await loadObservations(db, ind.minus).catch(() => [] as Obs[]))
      .filter((o) => o.entity === 'AUS').map((o) => [o.period, o.value]));
    aus = aus.filter((p) => other.has(p.period)).map((p) => ({ period: p.period, value: round(p.value - other.get(p.period)!, 2) }));
  }
  return { aus, all };
}

/**
 * Cross-section of OECD members for a series, with Australia's rank and the median. Ranked best first when the
 * measure has a direction (so 1st is always best), otherwise highest first.
 */
function peerTable(all: Obs[], metric_id: string, label: string, unit: Indicator['unit'], higherIsBetter?: boolean): Reading['peers'] {
  const build = (rows: Obs[], period: string): Reading['peers'] => {
    const sorted = [...rows].sort((a, b) => (higherIsBetter === false ? a.value - b.value : b.value - a.value));
    const aus = sorted.find((r) => r.entity === 'AUS');
    if (!aus) return null;
    const vals = sorted.map((r) => r.value).sort((a, b) => a - b);
    const median = vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2;
    return { metric_id, label, unit, period, rank: sorted.indexOf(aus) + 1, of: sorted.length, median: round(median, 2), aus: aus.value, rows: sorted, bestFirst: higherIsBetter !== undefined };
  };
  const periods = [...new Set(all.filter((o) => o.entity === 'AUS').map((o) => o.period))].sort().reverse();
  if (!periods.length) return null;
  // 1. Australia's latest period, when at least ten OECD members report it.
  const same = all.filter((o) => o.period === periods[0] && OECD.has(o.entity));
  if (same.length >= 10) return build(same, periods[0]);
  // 2. Annual surveys run in different years: each member's latest reading within three years of Australia's,
  //    so the comparison uses Australia's latest figure (the one on the tile) rather than an old common year.
  if (/^\d{4}$/.test(periods[0])) {
    const y = Number(periods[0]);
    const latestOf = new Map<string, Obs>();
    for (const o of all) {
      if (!OECD.has(o.entity) || !/^\d{4}$/.test(o.period) || Math.abs(Number(o.period) - y) > 3) continue;
      const cur = latestOf.get(o.entity);
      if (o.entity === 'AUS' ? o.period === periods[0] : !cur || o.period > cur.period) latestOf.set(o.entity, o);
    }
    const rows = [...latestOf.values()];
    if (rows.length >= 10) {
      const ps = rows.map((r) => r.period).sort();
      return build(rows, ps[0] === ps.at(-1) ? ps[0] : `latest available, ${ps[0]}–${ps.at(-1)}`);
    }
  }
  // 3. Otherwise the latest period Australia shares with at least ten members.
  for (const period of periods.slice(1)) {
    const rows = all.filter((o) => o.period === period && OECD.has(o.entity));
    if (rows.length >= 10) return build(rows, period);
  }
  return null;
}

function judge(ind: Indicator, latest: number, average: number | null): Status {
  const b = ind.benchmark;
  if (b.kind === 'target') return latest >= b.low && latest <= b.high ? 'on-target' : latest > b.high ? 'above' : 'below';
  const ref = b.kind === 'floor' ? b.value : average;
  if (ref == null || Math.abs(latest - ref) < 1e-9) return 'neutral';
  if (ind.higherIsBetter === undefined) return latest > ref ? 'above' : 'below';
  return (latest > ref) === ind.higherIsBetter ? 'better' : 'worse';
}

async function readIndicator(db: ReturnType<typeof createClient>, ind: Indicator & { key: string }): Promise<Reading> {
  const [{ aus, all }, meta] = await Promise.all([
    seriesOf(db, ind),
    isCpiId(ind.metric_id)
      ? cpiMeta(db, ind.metric_id)
      : db.from('metrics').select('name, source_org, source_dataset').eq('metric_id', ind.metric_id).maybeSingle().then((r) => r.data),
  ]);
  const latest = aus.at(-1) ?? null;
  const previous = aus.at(-2) ?? null;
  const years = ind.benchmark.kind === 'average' ? ind.benchmark.years : 10;
  const byOecd = ind.benchmark.kind === 'oecd';
  let average: number | null = null;
  let averageLabel: string | null = null;
  if (latest) {
    const from = periodDate(latest.period);
    from.setUTCFullYear(from.getUTCFullYear() - years);
    const window = aus.filter((p) => periodDate(p.period) > from);
    if (window.length >= 3) {
      if (ind.step) {
        // A policy rate holds between decisions: weight each setting by how long it held (to today for the last).
        const start = Math.max(from.getTime(), periodDate(window[0].period).getTime());
        const before = aus.filter((p) => periodDate(p.period) <= from).at(-1);
        const pts = before ? [{ ...before, period: from.toISOString().slice(0, 10) }, ...window] : window;
        let sum = 0, span = 0;
        pts.forEach((p, i) => {
          const a = Math.max(periodDate(p.period).getTime(), start);
          const b = i + 1 < pts.length ? periodDate(pts[i + 1].period).getTime() : Date.now();
          if (b > a) { sum += p.value * (b - a); span += b - a; }
        });
        average = span ? round(sum / span, 2) : null;
      } else {
        average = round(window.reduce((s, p) => s + p.value, 0) / window.length, 2);
      }
      // Name the average by the span the data actually cover.
      const first = periodDate(window[0].period);
      const covered = (periodDate(latest.period).getTime() - first.getTime()) / (365.25 * 864e5);
      averageLabel = covered >= years * 0.85 || ind.step ? `${years}-year average` : `average since ${periodLabel(window[0].period)}`;
    }
  }
  // Cross-country: the series itself when it covers other countries, else the configured peer series.
  let peers = all.some((o) => o.entity !== 'AUS') ? peerTable(all, ind.metric_id, byOecd ? (ind.short ?? ind.label) : ind.label, ind.unit, ind.higherIsBetter) : null;
  if (!peers && ind.peers) peers = peerTable(await loadObservations(db, ind.peers.metric_id).catch(() => []), ind.peers.metric_id, ind.peers.label, ind.peers.unit as Indicator['unit'], ind.higherIsBetter);

  let status: Status = latest ? judge(ind, latest.value, average) : 'neutral';
  // With too little history for an average, judge against the OECD median instead.
  // Judged against the OECD median: always for well-being measures, and when there is too little history.
  const byPeers = latest && peers && (byOecd || (average == null && ind.benchmark.kind === 'average'));
  if (byPeers && ind.higherIsBetter !== undefined) {
    // Exactly at the median is neither better nor worse (not a fall-back to the reading's own average).
    status = peers!.aus === peers!.median ? 'neutral' : (peers!.aus > peers!.median) === ind.higherIsBetter ? 'better' : 'worse';
  }
  const b = ind.benchmark;
  const u = ind.unit;
  let verdict = '';
  const summary: string[] = [];
  if (latest) {
    const p = latest.period;
    const when = /^\d{4}-Q/.test(p) ? `in the ${periodLabel(p)}` : /^\d{4}-\d{2}$/.test(p) ? `in ${periodLabel(p)}` : /^\d{4}$/.test(p) ? `in ${p}` : null;
    const was = ind.step
      ? `${ind.subject ?? ind.label} has been ${fmt(latest.value, u, ind.decimals)} since ${periodLabel(p)}`
      : `${ind.subject ?? ind.label} was ${fmt(latest.value, u, ind.decimals)} ${when ?? `at ${periodLabel(p)}`}`;
    summary.push(`${was}${previous ? `, ${changeText(latest.value, previous.value, u)} on the previous reading (${fmt(previous.value, u, ind.decimals)})` : ''}.`);
    if (b.kind === 'target') {
      verdict = status === 'on-target' ? `Within the ${b.low}–${b.high}% target` : `${status === 'above' ? 'Above' : 'Below'} the ${b.low}–${b.high}% target`;
      summary.push(status === 'on-target'
        ? `That is inside the RBA's ${b.low}–${b.high} per cent target band.`
        : `That is ${round(status === 'above' ? latest.value - b.high : b.low - latest.value, 2)} pts ${status} the RBA's ${b.low}–${b.high} per cent target band.`);
    } else if (b.kind === 'floor') {
      const gap = round(latest.value - b.value, 2);
      const unitWord = u === 'percent' || u === 'pts' ? ' pts' : '';
      verdict = `${gap >= 0 ? 'Above' : 'Below'} ${b.short ?? 'benchmark'}`;
      summary.push(`The benchmark is ${b.label}. The latest reading is ${Math.abs(gap)}${unitWord} ${gap >= 0 ? 'above' : 'below'} it.`);
    }
    if (average != null && averageLabel) {
      const diff = latest.value - average;
      const near = Math.abs(diff) <= Math.max(0.1, Math.abs(average) * 0.02);
      if (b.kind === 'average') verdict = near ? `Near its ${averageLabel}` : `${diff > 0 ? 'Above' : 'Below'} its ${averageLabel}`;
      // For OECD-judged measures the average is context; the verdict comes from the comparison below.
      summary.push(near
        ? `It is close to its ${averageLabel} of ${fmt(average, u)}.`
        : `It is ${diff > 0 ? 'above' : 'below'} its ${averageLabel} of ${fmt(average, u)}${ind.higherIsBetter === undefined ? '' : `, which is ${(diff > 0) === ind.higherIsBetter ? 'a better' : 'a worse'} reading than usual`}.`);
    }
    if (peers) {
      const mid = peers.aus > peers.median ? 'above' : peers.aus < peers.median ? 'below' : 'at';
      if (!verdict || b.kind === 'oecd') {
        verdict = mid === 'at' ? 'At the OECD median'
          : ind.higherIsBetter === undefined ? `${mid === 'above' ? 'Above' : 'Below'} the OECD median`
            : (mid === 'above') === ind.higherIsBetter ? 'Better than the OECD median' : 'Worse than the OECD median';
      }
      // Lower-case the label's first letter only when it is an ordinary word (keeps "GDP", "Treasury").
      const name = /^[A-Z][a-z]/.test(peers.label) ? peers.label.charAt(0).toLowerCase() + peers.label.slice(1) : peers.label;
      const rank = peers.bestFirst ? `${ordinal(peers.rank)} best of ${peers.of}` : `${ordinal(peers.rank)} highest of ${peers.of}`;
      summary.push(`Across ${peers.of} OECD countries (${periodLabel(peers.period)}), Australia ranks ${rank} on ${name}, ${mid} the median of ${fmt(peers.median, peers.unit)}.`);
    }
  }
  return {
    key: ind.key, indicator: ind, name: (meta as { name?: string } | null)?.name ?? ind.label,
    source: [(meta as { source_org?: string } | null)?.source_org, (meta as { source_dataset?: string } | null)?.source_dataset].filter(Boolean).join(', ') || null,
    latest, previous, history: aus.slice(-(ind.history ?? 40)), average, averageYears: average != null ? years : null, averageLabel,
    status, verdict, summary, peers,
  };
}

export type SectionReading = { section: Section; headline: Reading; others: Reading[] };

export async function loadSection(section: Section): Promise<SectionReading> {
  const db = createClient();
  const [headline, ...others] = await Promise.all(indicatorsOf(section).map((i) => readIndicator(db, i)));
  return { section, headline, others: others.filter((r) => r.latest) };
}

export async function loadDashboard(sections: Section[]): Promise<SectionReading[]> {
  return Promise.all(sections.map(loadSection));
}

export const loadEconomyDashboard = () => loadDashboard(SECTIONS);

export async function loadIndicator(section: Section, key: string): Promise<Reading | null> {
  const ind = indicatorsOf(section).find((i) => i.key === key);
  return ind ? readIndicator(createClient(), ind) : null;
}
