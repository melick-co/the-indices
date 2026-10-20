/**
 * Commonwealth deficits and surpluses by financial year, coloured by the party in office, with the two emergency
 * packages shaded and then trimmed away: the spec for a "bars over time" video (lib/bars-video-types.ts). Pure:
 * lib/bars-video.ts loads the stored series and calls this; bars-borrowing.check.ts tests it.
 *
 * Measure: the Australian Government general government sector underlying cash balance (receipts less payments, less
 * net Future Fund earnings from 2005–06 to 2019–20), outcomes by financial year from Treasury's historical tables,
 * Budget Paper No. 1 Statement 11 Table 11.1 (budget_underlying_cash_balance_au, $ millions;
 * budget_underlying_cash_balance_pct_gdp_au, % of GDP as the table prints it; agent/scripts/load-budget-history.mjs).
 *
 * Sign: a negative balance is a deficit. A bar goes up for a deficit and down for a surplus, so the bar is −(balance),
 * and its % of GDP likewise. A year with no outcome has no bar (a gap, said on screen).
 *
 * Emergency packages (off unless `emergency: true`; parked by the editor, October 2026, because the only year-by-year
 * costings are 2009 and 2021 estimates that exceed what was spent). When on, each year's emergency package cost as Treasury costed it (lib/emergency-packages.ts) widened the deficit, so
 * the trimmed bar is the bar less that cost. It can go below zero: where Treasury's costing is larger than the deficit,
 * the trimmed bar is a surplus. In a year split between governments, the trimmed part splits with the bar, in
 * proportion (Treasury's costings are by year only).
 */
import { bnText, type BarsBar, type BarsSpec } from '@/lib/bars-video-types';
import { EMERGENCY_PACKAGES, type EmergencyPackage } from '@/lib/emergency-packages';
import { GOVERNMENTS, OFFICE_SOURCES, PARTIES, fyName, officeSplit, type Party } from '@/lib/office';

/** Labor red and Coalition blue, chosen to clear 3:1 against the race navy and the house paper (checked in the test). */
export const PARTY_COLOUR: Record<Party, string> = { labor: '#e5534b', coalition: '#3d85d8' };

/** The stored period for the financial year ending June `endYear`: 2008 → "2007-08". */
export const fyKey = (endYear: number) => `${endYear - 1}-${String(endYear).slice(2)}`;

export type BorrowingInput = {
  /** Underlying cash balance by financial year ("2024-25"), $ millions: positive a surplus, negative a deficit. Outcomes only. */
  balance: Map<string, number>;
  /** The same as % of GDP, as Treasury's table prints it. */
  pctGdp: Map<string, number>;
  /** Financial years by their June year, inclusive. */
  fromYear: number;
  toYear: number;
  /** Where the figures come from: the stored series' source_dataset and source_url. */
  source: { dataset: string; url?: string };
  /** Shade the emergency packages and add the trimmed pass. Off by default: nothing from the packages renders. */
  emergency?: boolean;
  /** The emergency packages to shade and trim when `emergency` is on (default: both, as Treasury costed them). */
  packages?: EmergencyPackage[];
};

/** Periods named in the context line, only as timing (never as a cause). June years. */
export const EPISODES = [
  { name: 'the global financial crisis', years: [2009, 2010] },
  { name: 'the COVID-19 pandemic', years: [2020, 2021] },
];

/**
 * The context line: the largest deficits named against the episodes they fall in, as timing only. The three largest
 * when all three fall in an episode, else the two largest when both do; otherwise no line.
 */
export function contextLine(bars: BarsBar[]): string | null {
  const endYear = (p: string) => Number(p.slice(0, 4)) + 1;
  const episodeOf = (b: BarsBar) => EPISODES.find((e) => e.years.includes(endYear(b.period)));
  const ranked = bars.filter((b) => b.value != null && b.value > 0).sort((a, b) => b.value! - a.value!);
  const n = ranked.length >= 3 && ranked.slice(0, 3).every(episodeOf) ? 3 : ranked.length >= 2 && ranked.slice(0, 2).every(episodeOf) ? 2 : 0;
  if (!n) return null;
  const top = ranked.slice(0, n);
  const parts = EPISODES.map((e) => ({ e, years: top.filter((b) => episodeOf(b) === e).map((b) => b.period).sort() }))
    .filter((x) => x.years.length).map((x) => `${x.e.name} (${x.years.join(' and ')})`);
  return `The ${n === 3 ? 'three' : 'two'} largest deficits in this series coincide with ${parts.join(' and ')}.`;
}

type Facts = { opening?: boolean; extreme?: 'up' | 'down'; latest?: boolean; firstSince?: string; after?: { period: string; value: number } };

/** A bar's value in words: "a deficit of $27.0bn", "a surplus of $22.1bn". */
export const desc = (v: number) => (v > 0 ? `a deficit of ${bnText(v)}` : v < 0 ? `a surplus of ${bnText(v)}` : 'a balanced budget');
const kind = (v: number) => (v > 0 ? 'deficit' : 'surplus');

/** One caption sentence from what is true of a bar. */
function sentence(b: BarsBar, f: Facts): string {
  const v = b.value!;
  let s = `${b.period}: ${desc(v)}`;
  if ((f.extreme || f.latest) && b.pct != null) s += ` (${Math.abs(b.pct).toFixed(1)}% of GDP)`;
  const tails: string[] = [];
  if (f.extreme) tails.push(`the largest ${f.extreme === 'up' ? 'deficit' : 'surplus'} in these years`);
  if (f.firstSince) tails.push(`the first ${kind(v)} since ${f.firstSince}`);
  else if (f.after) tails.push(`after ${desc(f.after.value)} in ${f.after.period}`);
  if (f.latest) tails.push('the latest full year');
  return tails.length ? `${s}, ${tails.join(', ')}` : s;
}

/**
 * Captions, all from the data: the opening year, a run of years with no figure, each switch between deficit and
 * surplus (with "the first since" when the years between are all there), the largest deficit and the largest surplus
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
    // The first surplus (or deficit) since the last one, if every year between has a figure.
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
      candidates.push({ bar: i, text: j > i ? `${b.period} to ${bars[j].period}: no figure` : `${b.period}: no figure`, p: 2 });
    }
  });
  const kept: typeof candidates = [];
  for (const c of [...candidates].sort((a, b) => a.p - b.p || a.bar - b.bar)) {
    if (c.p > 1 && kept.some((k) => Math.abs(k.bar - c.bar) <= 1)) continue;
    kept.push(c);
  }
  return kept.sort((a, b) => a.bar - b.bar).map(({ bar, text }) => ({ bar, text }));
}

/**
 * Captions for the trimmed view: for each package, the year it cost the most, full and trimmed. In bar order.
 * "2020–21: a deficit of $134.2bn; without the COVID-19 response measures, a surplus of $11.7bn".
 */
export function trimCaptions(bars: BarsBar[], packages: EmergencyPackage[]): { bar: number; text: string }[] {
  const out: { bar: number; text: string }[] = [];
  for (const p of packages) {
    const inView = p.years.map((y) => ({ y, i: bars.findIndex((b) => b.period === y.fy.replace('-', '–')) }))
      .filter((x) => x.i >= 0 && bars[x.i].value != null && bars[x.i].trim);
    if (!inView.length) continue;
    const { i } = inView.sort((a, b) => b.y.cost - a.y.cost)[0];
    const b = bars[i];
    out.push({ bar: i, text: `${b.period}: ${desc(b.value!)}; without ${p.name}, ${desc(b.value! - b.trim!)}` });
  }
  return out.sort((a, b) => a.bar - b.bar);
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

export const COLOUR_CAVEAT = 'Colour shows which party was in office, not what caused the result.';

/** The caveat card with the emergency packages shown (parked). */
export const EMERGENCY_CAVEAT = [
  'Colour shows which party was in office, not what caused the result.',
  'Recessions also cut tax revenue; that shortfall is not in Treasury\'s package costings, so it stays in the trimmed bars.',
  'The size and design of each package were government decisions; the trimmed bars exclude the packages as Treasury costed them, not what would otherwise have happened.',
];

export function borrowingSpec(input: BorrowingInput): BarsSpec {
  const { balance, pctGdp, fromYear, toYear } = input;
  const emergency = input.emergency ?? false;
  const packages = emergency ? (input.packages ?? EMERGENCY_PACKAGES) : [];
  const costOf = new Map(packages.flatMap((p) => p.years.map((y) => [y.fy, y.cost] as const)));
  const bars: BarsBar[] = [];
  for (let y = fromYear; y <= toYear; y++) {
    const ucb = balance.get(fyKey(y));
    const value = ucb == null ? null : -ucb;
    const pct = pctGdp.get(fyKey(y));
    const segments = officeSplit(y).map((s) => ({ group: s.party, share: s.share }));
    const cost = costOf.get(fyKey(y));
    // −0 (a balance under 0.05% of GDP) reads as 0.
    bars.push({
      period: fyName(y), value, segments: value == null ? [] : segments, pct: value == null || pct == null ? null : -pct + 0,
      ...(value != null && cost ? { trim: cost } : {}),
    });
  }
  const first = fyName(fromYear), last = fyName(toYear);
  const missing = bars.filter((b) => b.value == null).map((b) => b.period);
  const splitYears = bars.map((b, i) => ({ b, s: officeSplit(fromYear + i) })).filter((x) => x.s.length > 1 && x.b.value != null);
  const known = bars.filter((b) => b.value != null);
  const peak = [...known].sort((a, b) => b.value! - a.value!)[0];
  const lastBar = known.at(-1);
  const trimmed = bars.filter((b) => b.trim);
  const flipped = trimmed.filter((b) => b.value! > 0 && b.value! - b.trim! < 0).map((b) => b.period);
  const usedPackages = packages.filter((p) => p.years.some((y) => trimmed.some((b) => b.period === y.fy.replace('-', '–'))));
  const range = (p: EmergencyPackage) => {
    const ys = p.years.map((y) => y.fy.replace('-', '–')).filter((fy) => trimmed.some((b) => b.period === fy));
    return ys.length > 1 ? `${ys[0]} to ${ys.at(-1)}` : ys[0];
  };

  return {
    key: 'bars:gov_borrowing',
    title: `Commonwealth deficits and surpluses, ${first} to ${last}`,
    subtitle: 'Underlying cash balance, Australian Government general government sector, $ billion each financial year, coloured by the party in office',
    unit: 'aud_m',
    axis: { up: 'Deficit', down: 'Surplus', unitLabel: '$ billion' },
    groups: (['labor', 'coalition'] as Party[]).map((p) => ({ key: p, label: PARTIES[p].inOffice, colour: PARTY_COLOUR[p] })),
    legendNote: 'Two colours in one bar: the government changed that year, split by days in office',
    bars,
    captions: borrowingCaptions(bars),
    caveat: emergency ? EMERGENCY_CAVEAT : [COLOUR_CAVEAT, ...(contextLine(bars) ? [contextLine(bars)!] : [])],
    ...(trimmed.length ? {
      trim: {
        legend: 'Emergency measures (Treasury costing)',
        heading: 'Without the GFC and COVID-19 emergency packages',
        captions: trimCaptions(bars, usedPackages),
      },
    } : {}),
    sources: [
      { org: 'Treasury', dataset: input.source.dataset, ...(input.source.url ? { url: input.source.url } : {}) },
      ...usedPackages.map((p) => ({ org: 'Treasury', dataset: `${p.source.document}, ${p.source.table}`, url: p.source.url })),
      ...OFFICE_SOURCES,
    ],
    notes: [
      'Underlying cash balance: receipts less payments (less net Future Fund earnings from 2005–06 to 2019–20), general government sector; outcomes from the Final Budget Outcomes. A deficit is drawn up, a surplus down.',
      "Shares of GDP as printed in Treasury's table.",
      ...(missing.length ? [`No bar for ${missing.join(', ')}: no outcome in Treasury's table.`] : []),
      `${fyName(toYear + 1)} is not shown: Treasury's figure for it is still an estimate.`,
      ...usedPackages.map((p) => `Hatched, ${range(p)}: ${p.name}, Treasury's costing of their effect on the underlying cash balance by year, as published at the time (estimates; Treasury has not published actual costs by year).`),
      ...(flipped.length ? [`Where a package's costing is larger than that year's deficit (${flipped.join(', ')}), the trimmed bar is a surplus.`] : []),
      ...(splitYears.some(({ b }) => b.trim) ? ['In a year split between governments, the hatched part is split in the same proportion as the bar (the costings are by year only).'] : []),
      `Party in office from each Prime Minister's swearing-in day: ${officeLine(fromYear, toYear)}.`,
      ...splitYears.map(({ b, s }) => `${b.period}: ${s.map((x) => `${PARTIES[x.party].label} ${x.days} days`).join(', ')}.`),
    ],
    takeaways: [
      ...(peak && peak.value! > 0 ? [`The largest deficit in these years was in ${peak.period}: ${bnText(peak.value!)}${peak.pct != null ? `, ${peak.pct.toFixed(1)}% of GDP` : ''}.`] : []),
      ...(lastBar ? [`In ${lastBar.period}, the latest full financial year, the budget had ${desc(lastBar.value!)}${lastBar.pct != null ? ` (${Math.abs(lastBar.pct).toFixed(1)}% of GDP)` : ''}.`] : []),
      ...trimCaptions(bars, usedPackages).map((c) => `${c.text} (the packages as Treasury costed them).`),
      'Colour shows which party was in office, not what caused the result.',
    ],
  };
}
