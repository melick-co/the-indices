/**
 * Commonwealth borrowing by financial year, coloured by the party in office: the spec for a "bars over time" video
 * (lib/bars-video-types.ts). Pure: lib/bars-video.ts loads the stored series and calls this; bars-borrowing.check.ts
 * tests it.
 *
 * Measure: Commonwealth general government net lending (+) / net borrowing (−), the GFS fiscal balance, from the IMF's
 * Quarterly Government Finance Statistics as reported by the Australian authorities (gfs_cwth_nlb, $ millions),
 * summed over the four quarters of each financial year to June. A bar goes up for borrowing and down for a surplus,
 * so the bar is −(net lending). A year missing any quarter has no bar (a gap, said on screen); nothing is estimated.
 * Shares of GDP use GDP over the same four quarters (ABS national accounts, pnl_gdp), as lib/gov-pnl.ts does.
 */
import { bnText, type BarsBar, type BarsSpec } from '@/lib/bars-video-types';
import { GOVERNMENTS, OFFICE_SOURCES, PARTIES, fyName, officeSplit, type Party } from '@/lib/office';

/** Labor red and Coalition blue, chosen to clear 3:1 against the race navy and the house paper (checked in the test). */
export const PARTY_COLOUR: Record<Party, string> = { labor: '#e5534b', coalition: '#3d85d8' };

/** Periods when borrowing rose for reasons outside the budget, named only as timing (never as a cause). */
export const EPISODES = [
  { name: 'the global financial crisis', years: [2009, 2010] },
  { name: 'the COVID-19 pandemic', years: [2020, 2021] },
];

const juneQuarters = (endYear: number) => [`${endYear - 1}-Q3`, `${endYear - 1}-Q4`, `${endYear}-Q1`, `${endYear}-Q2`];

/** Sum over the four quarters of the financial year ending June `endYear`, or null if any is missing. */
export function fySum(series: Map<string, number>, endYear: number): number | null {
  let t = 0;
  for (const q of juneQuarters(endYear)) {
    const v = series.get(q);
    if (v == null || !Number.isFinite(v)) return null;
    t += v;
  }
  return t;
}

/** One decimal, as a share of GDP: borrowing of 136,106 on GDP of 2,091,023 → 6.5. */
export const pctOf = (v: number, gdp: number) => Math.round((v / gdp) * 1000) / 10;

export type BorrowingInput = {
  /** Commonwealth net lending (+) / borrowing (−) by quarter, $ millions, already limited to usable quarters. */
  nlb: Map<string, number>;
  /** GDP by quarter, $ millions. */
  gdp: Map<string, number>;
  /** Financial years by their June year, inclusive. */
  fromYear: number;
  toYear: number;
  /** Quarters stored with a flag (period → why), for the sources card. */
  flagged?: Map<string, string>;
  /** Why a year has no figure (said once on the sources card). */
  gapReason?: string;
};

type Facts = { opening?: boolean; extreme?: 'up' | 'down'; latest?: boolean; firstSince?: string; after?: { period: string; value: number } };

const desc = (v: number) => (v > 0 ? `borrowed ${bnText(v)}` : v < 0 ? `a surplus of ${bnText(v)}` : 'a balanced budget');

/** One caption sentence from what is true of a bar. */
function sentence(b: BarsBar, f: Facts): string {
  const v = b.value!;
  let s = `${b.period}: ${desc(v)}`;
  if ((f.extreme || f.latest) && b.pct != null) s += ` (${Math.abs(b.pct).toFixed(1)}% of GDP)`;
  const tails: string[] = [];
  if (f.extreme) tails.push(f.extreme === 'up' ? 'the most in these years' : 'the largest in these years');
  if (f.firstSince) tails.push(`${v > 0 ? 'the first borrowing year' : 'the first surplus'} since ${f.firstSince}`);
  else if (f.after) tails.push(f.after.value > 0 ? `after borrowing ${bnText(f.after.value)} in ${f.after.period}` : `after a surplus of ${bnText(f.after.value)} in ${f.after.period}`);
  if (f.latest) tails.push('the latest full year');
  return tails.length ? `${s}, ${tails.join(', ')}` : s;
}

/**
 * Captions, all from the data: the opening year, a run of years with no figure, each switch between borrowing and
 * surplus (with "the first since" when the years between are all there), the most borrowed and the largest surplus
 * (with % of GDP), and the latest year. Lower-priority captions are dropped when they would sit on a neighbouring bar
 * of a higher-priority one, so each stays up long enough to read.
 */
export function borrowingCaptions(bars: BarsBar[]): { bar: number; text: string }[] {
  const facts: Facts[] = bars.map(() => ({}));
  const known = bars.map((b, i) => ({ b, i })).filter((x) => x.b.value != null);
  if (!known.length) return [];
  facts[known[0].i].opening = true;
  facts[known.at(-1)!.i].latest = true;
  const up = [...known].sort((a, b) => b.b.value! - a.b.value!)[0];
  if (up.b.value! > 0) facts[up.i].extreme = 'up';
  const down = [...known].sort((a, b) => a.b.value! - b.b.value!)[0];
  if (down.b.value! < 0) facts[down.i].extreme = 'down';
  for (let i = 1; i < bars.length; i++) {
    const a = bars[i - 1].value, v = bars[i].value;
    if (a == null || v == null || Math.sign(a) === Math.sign(v) || v === 0) continue;
    facts[i].after = { period: bars[i - 1].period, value: a };
    // The first surplus (or borrowing) since the last one, if every year between has a figure.
    for (let k = i - 1; k >= 0; k--) {
      if (bars[k].value == null) break;
      if (Math.sign(bars[k].value!) === Math.sign(v)) { facts[i].firstSince = bars[k].period; break; }
    }
  }
  // Priority: extremes, the latest year, gaps, the opening year, then switches.
  const rank = (f: Facts) => (f.extreme ? 0 : f.latest ? 1 : f.opening ? 3 : f.after ? 4 : 9);
  const candidates: { bar: number; text: string; p: number }[] = [];
  bars.forEach((b, i) => {
    if (b.value != null && rank(facts[i]) < 9) candidates.push({ bar: i, text: sentence(b, facts[i]), p: rank(facts[i]) });
    if (b.value == null && (i === 0 || bars[i - 1].value != null)) {
      let j = i;
      while (j + 1 < bars.length && bars[j + 1].value == null) j++;
      candidates.push({ bar: i, text: j > i ? `${b.period} to ${bars[j].period}: no Commonwealth figure` : `${b.period}: no Commonwealth figure`, p: 2 });
    }
  });
  const kept: typeof candidates = [];
  for (const c of [...candidates].sort((a, b) => a.p - b.p || a.bar - b.bar)) {
    if (c.p > 1 && kept.some((k) => Math.abs(k.bar - c.bar) <= 1)) continue;
    kept.push(c);
  }
  return kept.sort((a, b) => a.bar - b.bar).map(({ bar, text }) => ({ bar, text }));
}

/** The context line: the largest borrowing years named against the episodes they fall in, as timing only. */
export function contextLine(bars: BarsBar[]): string | null {
  const top = bars.filter((b) => b.value != null && b.value > 0).sort((a, b) => b.value! - a.value!).slice(0, 2);
  if (top.length < 2) return null;
  const endYear = (p: string) => Number(p.slice(0, 4)) + 1;
  const hits = EPISODES.map((e) => ({ e, years: top.filter((b) => e.years.includes(endYear(b.period))).map((b) => b.period) })).filter((h) => h.years.length);
  if (!hits.length) return null;
  const named = hits.map((h) => (hits.length > 1 ? `${h.e.name} (${h.years.sort().join(' and ')})` : h.e.name));
  const which = top.map((b) => b.period).sort().join(' and ');
  return `The two largest borrowing years in this series, ${which}, coincide with ${named.join(' and ')}.`;
}

/** Quarters the loader stored with a flag, as its metadata note lists them ("…: 2007-Q2, revenue − expenses …"). */
export function flaggedFromBasis(basis: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  const at = basis?.indexOf('Stored as reported with a flag') ?? -1;
  if (!basis || at < 0) return out;
  const list = basis.slice(basis.indexOf(':', at) + 1);
  for (const part of list.split(';')) {
    const m = part.trim().match(/^(\d{4}-Q[1-4]), (.+)$/);
    if (m) out.set(m[1], m[2].replace(/\.$/, ''));
  }
  return out;
}

const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "Coalition (Howard) to 2 December 2007; Labor (Rudd, Gillard, Rudd) from 3 December 2007; …" over the years shown. */
export function officeLine(fromYear: number, toYear: number): string {
  const start = `${fromYear - 1}-07-01`, end = `${toYear}-06-30`;
  const inWindow = GOVERNMENTS.filter((g, i) => g.from <= end && (GOVERNMENTS[i + 1]?.from ?? '9999') > start);
  return inWindow.map((g, i) => {
    const who = `${PARTIES[g.party].label} (${g.pms})`;
    if (i > 0 || g.from >= start) return `${who} from ${longDate(g.from)}`;
    const next = inWindow[1];
    return next ? `${who} to ${longDate(new Date(Date.parse(`${next.from}T00:00:00Z`) - 864e5).toISOString().slice(0, 10))}` : who;
  }).join('; ');
}

export function borrowingSpec(input: BorrowingInput): BarsSpec {
  const { nlb, gdp, fromYear, toYear } = input;
  const bars: BarsBar[] = [];
  for (let y = fromYear; y <= toYear; y++) {
    const lend = fySum(nlb, y);
    const g = fySum(gdp, y);
    const value = lend == null ? null : -lend;
    const segments = officeSplit(y).map((s) => ({ group: s.party, share: s.share }));
    bars.push({ period: fyName(y), value, segments: value == null ? [] : segments, pct: value != null && g ? pctOf(value, g) : null });
  }
  const first = fyName(fromYear), last = fyName(toYear);
  const missing = bars.filter((b) => b.value == null).map((b) => b.period);
  const next = toYear + 1;
  // Quarter → the financial year it belongs to (September and December quarters fall in the year to the next June).
  const fyOfQuarter = (q: string) => Number(q.slice(0, 4)) + (Number(q.slice(-1)) >= 3 ? 1 : 0);
  const flaggedYears = [...(input.flagged ?? new Map<string, string>())].filter(([q]) => fyOfQuarter(q) >= fromYear && fyOfQuarter(q) <= toYear);
  const splitYears = bars.map((b, i) => ({ b, s: officeSplit(fromYear + i) })).filter((x) => x.s.length > 1 && x.b.value != null);
  const context = contextLine(bars);
  const known = bars.filter((b) => b.value != null);
  const peak = [...known].sort((a, b) => b.value! - a.value!)[0];
  const lastBar = known.at(-1);

  return {
    key: 'bars:gov_borrowing',
    title: `Commonwealth borrowing, ${first} to ${last}`,
    subtitle: 'Net lending or borrowing, Commonwealth general government, $ billion each financial year, coloured by the party in office',
    unit: 'aud_m',
    axis: { up: 'Borrowed', down: 'Surplus', unitLabel: '$ billion' },
    groups: (['labor', 'coalition'] as Party[]).map((p) => ({ key: p, label: PARTIES[p].inOffice, colour: PARTY_COLOUR[p] })),
    legendNote: 'Two colours in one bar: the government changed that year, split by days in office',
    bars,
    captions: borrowingCaptions(bars),
    caveat: [
      'Colour shows which party was in office, not what caused the result.',
      'A year with a change of government is split by days in office.',
      ...(context ? [context] : []),
    ],
    sources: [
      { org: 'IMF', dataset: 'Quarterly Government Finance Statistics, Australia, as reported by the Australian authorities', url: 'https://data.imf.org/en/datasets/IMF.STA:QGFS' },
      { org: 'ABS', dataset: 'Australian National Accounts, GDP (income), for shares of GDP', url: 'https://data.api.abs.gov.au/rest/data/ABS,ANA_INC' },
      ...OFFICE_SOURCES,
    ],
    notes: [
      'Net lending or borrowing (the GFS fiscal balance), accrual basis, current prices: the four quarters of each financial year to June added up.',
      ...(missing.length ? [`No bar for ${missing.length > 1 ? `${missing[0]} to ${missing.at(-1)}` : missing[0]}: ${input.gapReason ?? 'a quarter of the year is not published'}.`] : []),
      ...flaggedYears.map(([q, why]) => `${fyName(fyOfQuarter(q))} includes ${q}, which does not quite add up as published: ${why.replace(' (off by ', ', off by $').replace(/, ([\d.]+%)\)$/, 'm ($1)')}. Its net lending is used as reported.`),
      `${fyName(next)} is not shown: its four quarters are not all published yet.`,
      `Party in office from each Prime Minister's swearing-in day: ${officeLine(fromYear, toYear)}.`,
      ...splitYears.map(({ b, s }) => `${b.period}: ${s.map((x) => `${PARTIES[x.party].label} ${x.days} days`).join(', ')}.`),
    ],
    takeaways: [
      ...(peak && peak.value! > 0 ? [`The Commonwealth borrowed the most in ${peak.period}: ${bnText(peak.value!)}${peak.pct != null ? `, ${peak.pct.toFixed(1)}% of GDP` : ''}.`] : []),
      ...(lastBar ? [`In ${lastBar.period}, the latest full financial year, it ${lastBar.value! > 0 ? `borrowed ${bnText(lastBar.value!)}` : `ran a surplus of ${bnText(lastBar.value!)}`}${lastBar.pct != null ? ` (${Math.abs(lastBar.pct).toFixed(1)}% of GDP)` : ''}.`] : []),
      'Colour shows which party was in office, not what caused the result.',
    ],
  };
}
