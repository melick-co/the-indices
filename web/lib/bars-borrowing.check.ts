import assert from 'node:assert/strict';
import { borrowingCaptions, borrowingSpec, contextLine, fyKey, officeLine, PARTY_COLOUR } from './bars-borrowing';
import { FISCAL_BALANCE, FISCAL_BALANCE_PCT_GDP, FISCAL_SOURCE } from './bars-borrowing.fixture';
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

// ---------- the spec, from Treasury's figures (Budget 2026–27 BP1 Statement 11 Table 11.6)
assert.equal(fyKey(2008), '2007-08', 'the stored period');
const balance = new Map(Object.entries(FISCAL_BALANCE)), pctGdp = new Map(Object.entries(FISCAL_BALANCE_PCT_GDP));
const spec = borrowingSpec({ balance, pctGdp, fromYear: 2006, toYear: 2025, source: FISCAL_SOURCE });
assert.equal(spec.bars.length, 20);
assert.equal(spec.bars[0].period, '2005–06');
assert.equal(spec.bars.at(-1)!.period, '2024–25');
assert.deepEqual(spec.bars.filter((b) => b.value == null), [], 'every year has a figure: publishable');
const bar = (p: string) => spec.bars.find((b) => b.period === p)!;
// Sign: a negative fiscal balance is borrowing and goes up; a surplus goes down. The share of GDP turns with it.
for (const [fy, fb] of Object.entries(FISCAL_BALANCE).filter(([fy]) => fy >= '2005-06')) {
  const b = bar(fy.replace('-', '–'));
  assert.equal(b.value, -fb, `${fy}: the bar is minus the fiscal balance`);
  assert.equal(b.pct, -FISCAL_BALANCE_PCT_GDP[fy] + 0, `${fy}: % of GDP as Treasury prints it, sign turned`);
}
assert.equal(bar('2005–06').value, -16094, 'a surplus of $16.1bn goes below zero');
assert.equal(bar('2020–21').value, 136108, 'a fiscal balance of −$136.1bn is borrowing, above zero');
assert.equal(bar('2020–21').pct, 6.5);
assert.equal(bar('2009–10').pct, 4.2);
assert.equal(bar('2022–23').pct, -0.9);
assert.ok(Object.is(borrowingSpec({ balance: new Map([['2019-20', -5]]), pctGdp: new Map([['2019-20', 0]]), fromYear: 2020, toYear: 2020, source: FISCAL_SOURCE }).bars[0].pct, 0), 'no −0');
// Split bars carry both parties, in the order they held office; FY2007–08 now draws as two colours.
assert.deepEqual(bar('2007–08').segments.map((s) => [s.group, s.share]), [['coalition', 155 / 366], ['labor', 211 / 366]]);
assert.deepEqual(bar('2013–14').segments.map((s) => s.group), ['labor', 'coalition']);
assert.deepEqual(bar('2021–22').segments.map((s) => s.group), ['coalition', 'labor']);
assert.equal(bar('2013–14').segments[0].share, 79 / 365);
assert.deepEqual(bar('2008–09').segments, [{ group: 'labor', share: 1 }]);

// Every caption number is the bar's own figure, as the labels round it.
assert.deepEqual(spec.captions, [
  { bar: 0, text: '2005–06: a surplus of $16.1bn' },
  { bar: 3, text: '2008–09: borrowed $30.4bn, after a surplus of $20.5bn in 2007–08' },
  { bar: 13, text: '2018–19: a surplus of $1.4bn, the first surplus since 2007–08' },
  { bar: 15, text: '2020–21: borrowed $136.1bn (6.5% of GDP), the most in these years' },
  { bar: 17, text: '2022–23: a surplus of $21.9bn (0.9% of GDP), the largest in these years, the first surplus since 2018–19' },
  { bar: 19, text: '2024–25: borrowed $44.8bn (1.6% of GDP), the first borrowing year since 2021–22, the latest full year' },
]);
for (const c of spec.captions) {
  const b = spec.bars[c.bar];
  if (b.value != null) assert.ok(c.text.includes(bnText(b.value)), `caption ${c.text} carries ${bnText(b.value)}`);
  const pct = c.text.match(/\(([\d.]+)% of GDP\)/)?.[1];
  if (pct) assert.equal(Number(pct), Math.abs(b.pct!), `caption ${c.text}: % of GDP is the table's`);
}
assert.equal(bnText(136108), '$136.1bn');
assert.equal(barLabel(136108), '136.1');
assert.equal(barLabel(-21926, true), '22');

// "The first since" only when every year between has a figure.
const mk = (vals: (number | null)[]): BarsBar[] => vals.map((v, i) => ({ period: fyName(2001 + i), value: v, segments: [] }));
const caps = borrowingCaptions(mk([-5, 10, 20, null, 30, 40, -3, 8, 9]));
assert.ok(!caps.some((c) => /first surplus since/.test(c.text)), 'a gap between surpluses: no "first since"');
assert.ok(caps.some((c) => c.text === '2003–04: no Commonwealth figure'));

// The context line names episodes only where the largest borrowing years fall in them, and only as timing.
assert.equal(contextLine(spec.bars), 'The three largest borrowing years in this series coincide with the global financial crisis (2009–10) and the COVID-19 pandemic (2019–20 and 2020–21).');
assert.equal(contextLine(mk([1, 2, 3])), null);
const ctx = (vals: [string, number][]) => contextLine(vals.map(([period, value]) => ({ period, value, segments: [] })));
assert.equal(ctx([['2008–09', 50], ['2020–21', 90], ['2015–16', 10]]), 'The two largest borrowing years in this series coincide with the global financial crisis (2008–09) and the COVID-19 pandemic (2020–21).', 'third largest outside an episode: the two');
assert.equal(ctx([['2019–20', 50], ['2020–21', 90], ['2015–16', 60]]), null, 'second largest outside an episode: no line');

// ---------- the sources card
assert.deepEqual(spec.sources[0], { org: 'Treasury', dataset: FISCAL_SOURCE.dataset, url: FISCAL_SOURCE.url });
assert.ok(spec.notes.includes("2025–26 is not shown: Treasury's figure for it is still an estimate."));
assert.ok(spec.notes.includes('2007–08: Coalition 155 days, Labor 211 days.'));
assert.ok(!spec.notes.some((t) => t.startsWith('No bar')));
const gappy = borrowingSpec({ balance: new Map([['2019-20', -5]]), pctGdp: new Map(), fromYear: 2020, toYear: 2021, source: FISCAL_SOURCE });
assert.ok(gappy.notes.includes("No bar for 2020–21: no outcome in Treasury's table."));
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
