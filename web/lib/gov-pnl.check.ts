import assert from 'node:assert/strict';
import { checkQuarter, fyLabel, gfsId, shifts, usableQuarter, val, yearStatement, yearSum } from '../../agent/scripts/lib/gfs.mjs';
import { GOV_LINES, commonEnd, consecutiveTail, fiscalYears, govChange, govStatement, sumFour, toQuarters, type Quarters } from './gov-pnl-core';

// A quarter that adds up: Commonwealth, March quarter 2026 (IMF QGFS, $m).
const good = {
  revenue: 191902, tax: 178107, tax_income: 139259, tax_payroll: 710, tax_property: 0, tax_goods: 33601, tax_trade: 1608, tax_other: 2929,
  social_contrib: 0, grants_recv: 0, other_rev: 13795,
  expense: 190783, employees: 9797, goods_services: 52053, depreciation: 3646, interest: 8080, subsidies: 4509, grants_paid: 58812,
  social_benefits: 44964, other_exp: 8923,
  nob: 1119, net_investment: 1971, nlb: -852,
};

// ---------- identity checks
assert.deepEqual(checkQuarter(good), { core: [], breakdown: [], flags: [] });
assert.match(checkQuarter({ ...good, nob: 1500 }).core[0], /revenue − expenses/, 'revenue − expenses must equal the operating balance');
assert.equal(checkQuarter({ ...good, nlb: 0 }).core.length, 1, 'operating balance − net investment must equal net lending');
assert.match(checkQuarter({ ...good, nlb: undefined }).core[0], /nlb missing/);
assert.deepEqual(checkQuarter({ ...good, nob: 1122 }).core, [], 'within rounding ($5m)');
// Off by more than rounding but within 0.5%: stored as reported, with a flag. Commonwealth 2007-Q2 as the IMF publishes
// it (totals only): revenue − expenses = 11,590 against a net operating balance of 11,630, $40m or 0.34%.
const q0702 = { revenue: 81808, expense: 70218, nob: 11630, net_investment: 1369, nlb: 10261 };
const c0702 = checkQuarter(q0702);
assert.deepEqual(c0702.core, [], '2007-Q2 is not refused');
assert.equal(c0702.flags.length, 1, '2007-Q2 is flagged');
assert.match(c0702.flags[0], /11,590 but net operating balance = 11,630 \(off by 40, 0\.34%\)/);
const c11650 = checkQuarter({ ...q0702, nob: 11650 });
assert.equal(c11650.core.length, 1, 'beyond 0.5% ($60m on 11,650 is 0.52%) the quarter is refused');
assert.match(c11650.core[0], /revenue − expenses/);
// Quarters published under the Commonwealth code on a wider coverage are not read.
assert.equal(usableQuarter('cwth', '2010-Q3'), false);
assert.equal(usableQuarter('cwth', '2011-Q1'), true);
assert.equal(usableQuarter('all', '2010-Q3'), true);
assert.equal(checkQuarter({ ...good, tax_income: 130000 }).breakdown.length, 1, 'tax components must sum to taxes');
assert.equal(checkQuarter({ ...good, interest: 9000 }).breakdown.length, 1, 'expense components must sum to expenses');
// Optional lines left out of a release count as zero, but only where the quarter has its breakdown.
const { grants_recv: _g, social_contrib: _s, ...noOptional } = good;
assert.deepEqual(checkQuarter(noOptional), { core: [], breakdown: [], flags: [] });
assert.equal(val({ revenue: 1 }, 'tax_payroll'), null, 'a totals-only quarter has no breakdown, not zeros');
assert.equal(val({ tax: 1 }, 'tax_payroll'), 0);
assert.equal(val({ tax: 1 }, 'tax_income'), null, 'required lines never default to zero');

// ---------- four-quarter sums
const q = (rev: number, exp: number, ni = 0) => ({ revenue: rev, expense: exp, nob: rev - exp, net_investment: ni, nlb: rev - exp - ni });
const m: Quarters = new Map([['2025-Q2', q(100, 90)], ['2025-Q3', q(110, 100, 5)], ['2025-Q4', q(120, 130)], ['2026-Q1', q(130, 120, 2)], ['2026-Q2', q(140, 150)]]);
assert.equal(yearSum(m, 'revenue', '2026-Q1'), 460);
assert.equal(yearSum(m, 'nlb', '2026-Q1'), 460 - 440 - 7);
assert.equal(yearSum(m, 'revenue', '2025-Q4'), null, 'a missing quarter means no year');
assert.equal(yearSum(m, 'tax_income', '2026-Q1'), null, 'totals-only quarters give no breakdown');
const st = yearStatement(new Map([['2026-Q1', good], ['2025-Q4', good], ['2025-Q3', good], ['2025-Q2', good]]), '2026-Q1')!;
assert.equal(st.revenue, 4 * 191902);
assert.equal(st.tax_goods_other, 4 * (33601 + 1608 + 2929), 'GST, customs and other taxes are shown together');
assert.equal(st.other_rev_all, 4 * (191902 - 178107));
assert.equal(yearStatement(m, '2025-Q4'), null);
assert.equal(fyLabel('2026-Q2'), '2025–26');

// ---------- the page's helpers
const rows = [{ suffix: 'revenue', period: '2026-Q1', value: 5 }, { suffix: 'nob', period: '2026-Q1', value: 1 }];
assert.deepEqual(toQuarters(rows).get('2026-Q1'), { revenue: 5, nob: 1 });
const all: Quarters = new Map([...m].map(([p, v]) => [p, { ...v }]));
assert.equal(commonEnd(new Map([...m].filter(([p]) => p !== '2026-Q2')), all), '2026-Q1', 'the latest year both sectors have');
assert.equal(govStatement(m, '2026-Q2')!.revenue, 500);
const gdp = new Map([['2025-Q3', 1000], ['2025-Q4', 1000], ['2026-Q1', 1000], ['2026-Q2', 1000]]);
assert.equal(sumFour(gdp, '2026-Q2'), 4000);
assert.equal(sumFour(gdp, '2026-Q1'), null);
const years = fiscalYears(m, all, gdp);
assert.equal(years.length, 1);
assert.equal(years[0].fy, '2025–26');
assert.equal(years[0].allNlb, Math.round(((500 - 500 - 7) / 4000) * 1000) / 10);

assert.deepEqual(consecutiveTail([{ fy: '2005–06' }, { fy: '2007–08' }, { fy: '2008–09' }]).map((y) => y.fy), ['2007–08', '2008–09'], 'a gap year starts the run afresh');
assert.deepEqual(consecutiveTail([]), []);

// Change column: per cent for lines, dollars for balances (they cross zero).
const rev = GOV_LINES.find((l) => l.key === 'rev')!, nlb = GOV_LINES.find((l) => l.key === 'nlb')!;
assert.deepEqual(govChange(rev, 110, 100), { text: '▲ 10.0%', up: true });
assert.deepEqual(govChange(nlb, -66600, -4000), { text: '−$62.6bn', up: false });
assert.equal(govChange(rev, 110, null), null);

// Labels: every line reads a value from a full statement; the bottom lines are the balances.
for (const l of GOV_LINES) {
  if (l.kind === 'sub') continue;
  assert.equal(typeof l.get(st as never), 'number', `${l.key} reads a value`);
  assert.ok(l.label && !/_/.test(l.label), `${l.key} has a plain-English label`);
}
assert.deepEqual(GOV_LINES.filter((l) => l.kind === 'bottom').map((l) => l.key), ['nob', 'nlb']);
assert.equal(GOV_LINES.find((l) => l.key === 'inv')!.get(st as never), -4 * 1971, 'net investment is a deduction');
assert.equal(gfsId('cwth', 'nlb'), 'gfs_cwth_nlb');

// Reclassification flag: a line swings while its total holds.
const a = new Map([['2024-Q2', { ...good }], ['2025-Q2', { ...good, tax_goods: 2392, tax_other: 2929 + 33601 - 2392 }]]);
assert.deepEqual(shifts(a, ['tax_goods', 'tax_other'], 'tax').map((s: { line: string }) => s.line), ['tax_goods', 'tax_other']);

console.log('gov-pnl checks passed');
