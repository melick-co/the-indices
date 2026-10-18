import assert from 'node:assert/strict';
import { CAVEAT, PARTY_COLOUR, borrowingCaptions, borrowingSpec, desc, fyKey, officeLine, trimCaptions } from './bars-borrowing';
import { UCB, UCB_PCT_GDP, UCB_SOURCE } from './bars-borrowing.fixture';
import { barLabel, barsFrames, barsSeconds, bnText, type BarsBar } from './bars-video-types';
import { EMERGENCY_PACKAGES } from './emergency-packages';
import { daysInclusive, fyName, officeSplit } from './office';
import { barParts } from '../remotion/BarBuild';
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
for (let y = 1998; y <= 2026; y++) assert.ok(Math.abs(officeSplit(y).reduce((t, x) => t + x.share, 0) - 1) < 1e-12, `${fyName(y)} shares sum to 1`);

// ---------- the spec, from Treasury's figures (Budget 2026–27 BP1 Statement 11 Table 11.1)
assert.equal(fyKey(2008), '2007-08', 'the stored period');
const balance = new Map(Object.entries(UCB)), pctGdp = new Map(Object.entries(UCB_PCT_GDP));
const spec = borrowingSpec({ balance, pctGdp, fromYear: 2006, toYear: 2025, source: UCB_SOURCE });
assert.equal(spec.title, 'Commonwealth deficits and surpluses, 2005–06 to 2024–25');
assert.match(spec.subtitle, /^Underlying cash balance, Australian Government general government sector/);
assert.equal(spec.bars.length, 20);
assert.deepEqual(spec.bars.filter((b) => b.value == null), [], 'every year has a figure: publishable');
const bar = (p: string) => spec.bars.find((b) => b.period === p)!;
// Sign: a negative underlying cash balance is a deficit and goes up; a surplus goes down. The share of GDP turns with it.
for (const [fy, ucb] of Object.entries(UCB).filter(([fy]) => fy >= '2005-06')) {
  const b = bar(fy.replace('-', '–'));
  assert.equal(b.value, -ucb, `${fy}: the bar is minus the underlying cash balance`);
  assert.equal(b.pct, -UCB_PCT_GDP[fy] + 0, `${fy}: % of GDP as Treasury prints it, sign turned`);
}
assert.equal(bar('2020–21').value, 134171);
assert.equal(bar('2018–19').value, 690, '2018–19 is a small deficit on the cash measure');
assert.ok(Object.is(bar('2018–19').pct, 0), 'no −0');
// Split bars carry both parties, in the order they held office.
assert.deepEqual(bar('2007–08').segments.map((s) => [s.group, s.share]), [['coalition', 155 / 366], ['labor', 211 / 366]]);
assert.deepEqual(bar('2013–14').segments.map((s) => s.group), ['labor', 'coalition']);
assert.deepEqual(bar('2021–22').segments.map((s) => s.group), ['coalition', 'labor']);

// ---------- the emergency packages: Treasury's year-by-year costings, no year apportioned here
const trims = Object.fromEntries(spec.bars.filter((b) => b.trim).map((b) => [b.period, b.trim]));
assert.deepEqual(trims, {
  '2008–09': 26587, '2009–10': 22352, '2010–11': 12716, '2011–12': 5056,
  '2019–20': 56712, '2020–21': 145909, '2021–22': 53896, '2022–23': 32713, '2023–24': 13266, '2024–25': 8993,
});
for (const p of EMERGENCY_PACKAGES) for (const y of p.years) assert.equal(bar(y.fy.replace('-', '–')).trim, y.cost, `${p.key} ${y.fy}`);
const trimmedOf = (p: string) => bar(p).value! - (bar(p).trim ?? 0);
assert.equal(trimmedOf('2009–10'), 54494 - 22352);
assert.equal(trimmedOf('2020–21'), -11738, "a costing larger than the year's deficit leaves a surplus");
assert.equal(trimmedOf('2022–23'), -22064 - 32713, 'a surplus year with package costs: a larger surplus without them');
assert.equal(trimmedOf('2013–14'), 48456, 'no package, no trim');

// ---------- captions, every number the bar's own figure as the labels round it
assert.deepEqual(spec.captions, [
  { bar: 0, text: '2005–06: a surplus of $15.8bn' },
  { bar: 3, text: '2008–09: a deficit of $27.0bn, after a surplus of $19.8bn in 2007–08' },
  { bar: 15, text: '2020–21: a deficit of $134.2bn (6.4% of GDP), the largest deficit in these years' },
  { bar: 17, text: '2022–23: a surplus of $22.1bn (0.9% of GDP), the largest surplus in these years, the first surplus since 2007–08' },
  { bar: 19, text: '2024–25: a deficit of $10.0bn (0.4% of GDP), the first deficit since 2021–22, the latest full year' },
]);
for (const c of spec.captions) {
  const b = spec.bars[c.bar];
  assert.ok(c.text.includes(bnText(b.value!)), `caption ${c.text} carries ${bnText(b.value!)}`);
  const pct = c.text.match(/\(([\d.]+)% of GDP\)/)?.[1];
  if (pct) assert.equal(Number(pct), Math.abs(b.pct!), `caption ${c.text}: % of GDP is the table's`);
}
// The trimmed view: each package's costliest year, full and trimmed, computed from the same figures.
assert.equal(spec.trim!.heading, 'Without the GFC and COVID-19 emergency packages');
assert.equal(spec.trim!.legend, 'Emergency measures (Treasury costing)');
assert.deepEqual(spec.trim!.captions, [
  { bar: 3, text: '2008–09: a deficit of $27.0bn; without the GFC stimulus packages, a deficit of $0.4bn' },
  { bar: 15, text: '2020–21: a deficit of $134.2bn; without the COVID-19 response measures, a surplus of $11.7bn' },
]);
assert.equal(desc(27013 - 26587), 'a deficit of $0.4bn');
assert.equal(desc(134171 - 145909), 'a surplus of $11.7bn');
assert.deepEqual(trimCaptions(spec.bars, []), []);
assert.equal(bnText(134171), '$134.2bn');
assert.equal(barLabel(-22064, true), '22');

// "The first since" only when every year between has a figure.
const mk = (vals: (number | null)[]): BarsBar[] => vals.map((v, i) => ({ period: fyName(2001 + i), value: v, segments: [] }));
const caps = borrowingCaptions(mk([-5, 10, 20, null, 30, 40, -3, 8, 9]));
assert.ok(!caps.some((c) => /first surplus since/.test(c.text)), 'a gap between surpluses: no "first since"');
assert.ok(caps.some((c) => c.text === '2003–04: no figure'));

// ---------- what a bar draws through the trimmed pass (value intervals; t = 0 before, 1 after)
// A deficit with a smaller package: solid to the trimmed level, hatched above it, shrinking away.
assert.deepEqual(barParts(54494, 22352, 0), { d: 54494, w: 32142, solid: [0, 32142], hatched: [32142, 54494] });
assert.deepEqual(barParts(54494, 22352, 1), { d: 32142, w: 32142, solid: [0, 32142], hatched: null });
// A package larger than the deficit: the whole bar hatched (nothing drawn below zero yet), then a surplus.
assert.deepEqual(barParts(134171, 145909, 0), { d: 134171, w: -11738, solid: null, hatched: [0, 134171] });
assert.deepEqual(barParts(134171, 145909, 1), { d: -11738, w: -11738, solid: [-11738, 0], hatched: null });
// A surplus year with package costs: the hatched part extends the surplus, then the bar settles there.
assert.deepEqual(barParts(-22064, 32713, 0), { d: -22064, w: -54777, solid: [-22064, 0], hatched: [-54777, -22064] });
assert.deepEqual(barParts(-22064, 32713, 1).solid, [-54777, 0]);
assert.deepEqual(barParts(48456, 0, 0.5), { d: 48456, w: 48456, solid: [0, 48456], hatched: null }, 'no package: unchanged');

// ---------- the caveat card and sources card
assert.deepEqual(spec.caveat, CAVEAT);
assert.deepEqual(spec.caveat, [
  'Colour shows which party was in office, not what caused the result.',
  "Recessions also cut tax revenue; that shortfall is not in Treasury's package costings, so it stays in the trimmed bars.",
  'The size and design of each package were government decisions; the trimmed bars exclude the packages as Treasury costed them, not what would otherwise have happened.',
]);
assert.deepEqual(spec.sources.map((s) => s.org), ['Treasury', 'Treasury', 'Treasury', 'National Archives of Australia', 'Parliament of Australia']);
assert.match(spec.sources[0].dataset, /Table 11\.1$/);
assert.match(spec.sources[1].dataset, /2009-10 Budget, Budget Paper No\. 1, Statement 4.*Table 1: The components of fiscal policy/);
assert.match(spec.sources[2].dataset, /2021-22 Budget fact sheet: Recovery and response support/);
assert.ok(spec.notes.includes("2025–26 is not shown: Treasury's figure for it is still an estimate."));
assert.ok(spec.notes.some((t) => t.startsWith('Hatched, 2008–09 to 2011–12: the GFC stimulus packages')));
assert.ok(spec.notes.some((t) => t.startsWith('Hatched, 2019–20 to 2024–25: the COVID-19 response measures')));
assert.ok(spec.notes.includes("Where a package's costing is larger than that year's deficit (2020–21, 2021–22), the trimmed bar is a surplus."));
assert.ok(spec.notes.includes('2007–08: Coalition 155 days, Labor 211 days.'));
assert.equal(officeLine(2006, 2025), 'Coalition (Howard) to 2 December 2007; Labor (Rudd, Gillard, Rudd) from 3 December 2007; Coalition (Abbott, Turnbull, Morrison) from 18 September 2013; Labor (Albanese) from 23 May 2022');
assert.equal(officeLine(2015, 2020), 'Coalition (Abbott, Turnbull, Morrison)', 'one government over the whole window: no dates');
const gappy = borrowingSpec({ balance: new Map([['2019-20', -5]]), pctGdp: new Map(), fromYear: 2020, toYear: 2021, source: UCB_SOURCE, packages: [] });
assert.ok(gappy.notes.includes("No bar for 2020–21: no outcome in Treasury's table."));
assert.equal(gappy.trim, undefined, 'no packages: no trimmed pass');

// ---------- house style: Australian English, no em dashes, the caveat about timing never about cause
const words = [spec.title, spec.subtitle, spec.legendNote ?? '', ...spec.captions.map((c) => c.text), ...spec.trim!.captions.map((c) => c.text), spec.trim!.heading, ...spec.caveat, ...spec.notes, ...spec.takeaways].join('\n');
assert.ok(!words.includes('—'), 'no em dashes');

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

// ---------- length: about a minute
assert.ok(barsSeconds(spec) >= 50 && barsSeconds(spec) <= 65, `${barsSeconds(spec)}s`);
assert.equal(barsFrames(spec), Math.round(barsSeconds(spec) * 30));

console.log(`bars-borrowing checks passed (${barsSeconds(spec).toFixed(1)}s video)`);
