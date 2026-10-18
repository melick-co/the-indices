import assert from 'node:assert/strict';
import { borrowingCaptions, borrowingSpec, contextLine, flaggedFromBasis, fySum, officeLine, pctOf, PARTY_COLOUR } from './bars-borrowing';
import { GDP, NLB, NLB_BASIS } from './bars-borrowing.fixture';
import { barLabel, barsFrames, barsSeconds, bnText, type BarsBar } from './bars-video-types';
import { daysInclusive, fyName, officeSplit } from './office';
import { PAPER } from '../remotion/theme';

// ---------- days in office
assert.equal(daysInclusive('2007-07-01', '2008-06-30'), 366, 'FY2007–08 has 29 February 2008');
assert.equal(daysInclusive('2012-07-01', '2013-06-30'), 365);
assert.equal(daysInclusive('2023-07-01', '2024-06-30'), 366, 'FY2023–24 has 29 February 2024');
assert.equal(fyName(2008), '2007–08');

const split = (y: number) => officeSplit(y).map((s) => [s.party, s.days]);
// Howard to 2 December 2007, Rudd sworn in 3 December 2007 (the day of the change counts to the incoming party).
assert.deepEqual(split(2008), [['coalition', 155], ['labor', 211]]);
// Rudd to 17 September 2013, Abbott sworn in 18 September 2013.
assert.deepEqual(split(2014), [['labor', 79], ['coalition', 286]]);
// Morrison to 22 May 2022, Albanese sworn in 23 May 2022.
assert.deepEqual(split(2022), [['coalition', 326], ['labor', 39]]);
assert.deepEqual(split(2006), [['coalition', 365]]);
assert.deepEqual(split(2024), [['labor', 366]]);
assert.deepEqual(split(2012), [['labor', 366]], 'FY2011–12 has 29 February 2012');
for (let y = 1998; y <= 2026; y++) {
  const s = officeSplit(y);
  assert.ok(Math.abs(s.reduce((t, x) => t + x.share, 0) - 1) < 1e-12, `${fyName(y)} shares sum to 1`);
}
assert.equal(officeSplit(2008)[0].share, 155 / 366);

// ---------- financial-year sums
const nlb = new Map(Object.entries(NLB)), gdp = new Map(Object.entries(GDP));
assert.equal(fySum(nlb, 2007), -1962 + 4065 + 5889 + 10261, 'FY2006–07: September 2006 to June 2007, with the flagged 2007-Q2');
assert.equal(fySum(nlb, 2007), 18253, 'matches the IMF annual figure for 2007 (QGFS, FREQUENCY=A)');
assert.equal(fySum(nlb, 2021), -136106);
assert.equal(fySum(nlb, 2008), null, 'FY2007–08: 2007-Q4 to 2008-Q2 not published');
assert.equal(fySum(nlb, 2011), null, 'FY2010–11: the 2010 quarters are a coverage break, left out');
assert.equal(fySum(nlb, 2026), null, 'FY2025–26: the June quarter 2026 is not out');

// ---------- the spec, from the figures the APIs returned
const spec = borrowingSpec({ nlb, gdp, fromYear: 2006, toYear: 2025, flagged: flaggedFromBasis(NLB_BASIS), gapReason: 'not published' });
assert.equal(spec.bars.length, 20);
assert.equal(spec.bars[0].period, '2005–06');
assert.equal(spec.bars.at(-1)!.period, '2024–25');
assert.deepEqual(spec.bars.filter((b) => b.value == null).map((b) => b.period), ['2007–08', '2008–09', '2009–10', '2010–11']);
const bar = (p: string) => spec.bars.find((b) => b.period === p)!;
assert.equal(bar('2005–06').value, -17316, 'a surplus goes below zero');
assert.equal(bar('2020–21').value, 136106, 'borrowing goes above zero');
// % of GDP recomputed here from the fixture's quarters, independently of the builder.
const gdpFy = (y: number) => [`${y - 1}-Q3`, `${y - 1}-Q4`, `${y}-Q1`, `${y}-Q2`].reduce((t, q) => t + GDP[q], 0);
assert.equal(gdpFy(2021), 488801 + 532595 + 513885 + 555742);
assert.equal(bar('2020–21').pct, Math.round((136106 / gdpFy(2021)) * 1000) / 10);
assert.equal(bar('2020–21').pct, 6.5);
assert.equal(bar('2022–23').pct, -0.9, '21,925 / 2,577,014 = 0.85%');
assert.equal(bar('2024–25').pct, 1.6);
assert.equal(pctOf(44806, gdpFy(2025)), 1.6);
// Split bars carry both parties, in the order they held office.
assert.deepEqual(bar('2013–14').segments.map((s) => s.group), ['labor', 'coalition']);
assert.deepEqual(bar('2021–22').segments.map((s) => s.group), ['coalition', 'labor']);
assert.equal(bar('2013–14').segments[0].share, 79 / 365);
assert.deepEqual(bar('2007–08').segments, [], 'no segments where there is no figure');

// Every caption number is the bar's own figure, as the labels round it.
assert.deepEqual(spec.captions, [
  { bar: 0, text: '2005–06: a surplus of $17.3bn' },
  { bar: 2, text: '2007–08 to 2010–11: no Commonwealth figure' },
  { bar: 13, text: '2018–19: a surplus of $2.6bn, after borrowing $5.3bn in 2017–18' },
  { bar: 15, text: '2020–21: borrowed $136.1bn (6.5% of GDP), the most in these years' },
  { bar: 17, text: '2022–23: a surplus of $21.9bn (0.9% of GDP), the largest in these years, the first surplus since 2018–19' },
  { bar: 19, text: '2024–25: borrowed $44.8bn (1.6% of GDP), the first borrowing year since 2021–22, the latest full year' },
]);
for (const c of spec.captions) {
  const b = spec.bars[c.bar];
  if (b.value != null) assert.ok(c.text.includes(bnText(b.value)), `caption ${c.text} carries ${bnText(b.value)}`);
}
assert.equal(bnText(136106), '$136.1bn');
assert.equal(barLabel(136106), '136.1');
assert.equal(barLabel(-21925, true), '22');

// "The first since" only when every year between has a figure.
const mk = (vals: (number | null)[]): BarsBar[] => vals.map((v, i) => ({ period: fyName(2001 + i), value: v, segments: [] }));
const caps = borrowingCaptions(mk([-5, 10, 20, null, 30, 40, -3, 8, 9]));
assert.ok(!caps.some((c) => /first surplus since/.test(c.text)), 'a gap between surpluses: no "first since"');
assert.ok(caps.some((c) => c.text === '2003–04: no Commonwealth figure'));

// The context line names an episode only where the largest borrowing years fall in it.
assert.equal(contextLine(spec.bars), 'The two largest borrowing years in this series, 2019–20 and 2020–21, coincide with the COVID-19 pandemic.');
assert.equal(contextLine(mk([1, 2, 3])), null);
assert.equal(
  contextLine([{ period: '2008–09', value: 50, segments: [] }, { period: '2020–21', value: 90, segments: [] }, { period: '2015–16', value: 10, segments: [] }]),
  'The two largest borrowing years in this series, 2008–09 and 2020–21, coincide with the global financial crisis (2008–09) and the COVID-19 pandemic (2020–21).',
);

// ---------- the sources card
assert.deepEqual(flaggedFromBasis(NLB_BASIS), new Map([['2007-Q2', 'revenue − expenses = 11,590 but net operating balance = 11,630 (off by 40, 0.34%)']]));
assert.deepEqual(flaggedFromBasis('Net lending, quarterly'), new Map());
assert.ok(spec.notes.some((t) => t.startsWith('2006–07 includes 2007-Q2') && t.includes('off by $40m (0.34%)')));
assert.ok(spec.notes.includes('2025–26 is not shown: its four quarters are not all published yet.'));
assert.ok(spec.notes.includes('No bar for 2007–08 to 2010–11: not published.'));
assert.equal(officeLine(2006, 2025), 'Coalition (Howard) to 2 December 2007; Labor (Rudd, Gillard, Rudd) from 3 December 2007; Coalition (Abbott, Turnbull, Morrison) from 18 September 2013; Labor (Albanese) from 23 May 2022');
assert.equal(officeLine(2015, 2020), 'Coalition (Abbott, Turnbull, Morrison)', 'one government over the whole window: no dates');

// ---------- house style: Australian English, no em dashes, no adjectives about parties in the copy
const words = [spec.title, spec.subtitle, spec.legendNote ?? '', ...spec.captions.map((c) => c.text), ...spec.caveat, ...spec.notes, ...spec.takeaways].join('\n');
assert.ok(!words.includes('—'), 'no em dashes');
assert.ok(spec.caveat.includes('Colour shows which party was in office, not what caused the result.'));
assert.ok(!/\b(caus|because|due to|led to|blame)/i.test(spec.caveat.slice(1).join(' ')), 'context is timing, never cause');

// ---------- colours: each clears 3:1 (graphics) against the video's navy and the house paper
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
for (const [party, colour] of Object.entries(PARTY_COLOUR)) {
  assert.ok(contrast(colour, '#0f1830') >= 3, `${party} on navy: ${contrast(colour, '#0f1830').toFixed(2)}`);
  assert.ok(contrast(colour, PAPER) >= 3, `${party} on paper: ${contrast(colour, PAPER).toFixed(2)}`);
}

// ---------- length: about 40 to 60 seconds
assert.ok(barsSeconds(spec) >= 40 && barsSeconds(spec) <= 60, `${barsSeconds(spec)}s`);
assert.equal(barsFrames(spec), Math.round(barsSeconds(spec) * 30));

console.log(`bars-borrowing checks passed (${barsSeconds(spec).toFixed(1)}s video)`);
