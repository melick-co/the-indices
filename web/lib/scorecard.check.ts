import assert from 'node:assert/strict';
import {
  EVALUATIVE, TERMS, assess, baselineObs, changeBetween, changedFields, coversStart, decideStatus, difference, inTerm, latestObs, marker,
  normaliseDraft, ratingForRatio, spanOf, sumFourQuarters, summaryLine, termOf, type Commitment, type Obs,
} from './scorecard';
import { OUTCOMES, CPI_NOTE } from './scorecard-outcomes';
import { SEED } from './scorecard-seed';

// ---------- terms and the toggle
assert.equal(termOf(undefined), '2025');
assert.equal(termOf('2022'), '2022');
assert.equal(termOf(['2022']), '2022');
assert.equal(termOf('1999'), '2025', 'anything else is the current term');
assert.equal(TERMS['2025'].date, '2025-05-03');
assert.equal(TERMS['2022'].date, '2022-05-21');

// ---------- periods
assert.deepEqual(spanOf('2025-Q2'), { start: Date.UTC(2025, 3, 1), end: Date.UTC(2025, 5, 30), point: false });
assert.deepEqual(spanOf('2022-05'), { start: Date.UTC(2022, 4, 1), end: Date.UTC(2022, 4, 31), point: false });
assert.deepEqual(spanOf('2024-25'), { start: Date.UTC(2024, 6, 1), end: Date.UTC(2025, 5, 30), point: false }, 'a financial year');
assert.equal(spanOf('2024-26'), null, 'not a financial year');
assert.equal(spanOf('2026-09-30')?.point, true);
assert.equal(spanOf('nonsense'), null);

// ---------- baseline period selection, both terms
const quarterly: Obs[] = ['2022-Q1', '2022-Q2', '2022-Q3', '2025-Q1', '2025-Q2', '2025-Q3'].map((period, i) => ({ period, value: i }));
assert.equal(baselineObs(quarterly, TERMS['2025'].date)?.period, '2025-Q2', '3 May 2025 is in the June quarter');
assert.equal(baselineObs(quarterly, TERMS['2022'].date)?.period, '2022-Q2', '21 May 2022 is in the June quarter');
const monthly: Obs[] = ['2022-04', '2022-05', '2022-06', '2025-04', '2025-05'].map((period, i) => ({ period, value: i }));
assert.equal(baselineObs(monthly, TERMS['2022'].date)?.period, '2022-05');
assert.equal(baselineObs(monthly, TERMS['2025'].date)?.period, '2025-05');
const annual: Obs[] = [{ period: '2021', value: 1 }, { period: '2022', value: 2 }, { period: '2025', value: 3 }];
assert.equal(baselineObs(annual, TERMS['2022'].date)?.period, '2022');
const fy: Obs[] = [{ period: '2021-22', value: 1 }, { period: '2024-25', value: 2 }];
assert.equal(baselineObs(fy, TERMS['2022'].date)?.period, '2021-22', 'May 2022 is in 2021-22');
assert.equal(baselineObs(fy, TERMS['2025'].date)?.period, '2024-25');
// The cash rate is stored by decision date: the baseline is the rate in force on election day.
const cash: Obs[] = [{ period: '2020-11-04', value: 0.1 }, { period: '2022-05-04', value: 0.35 }, { period: '2022-06-08', value: 0.85 }, { period: '2025-02-19', value: 4.1 }, { period: '2025-05-21', value: 3.85 }];
assert.equal(baselineObs(cash, TERMS['2022'].date)?.value, 0.35);
assert.equal(baselineObs(cash, TERMS['2025'].date)?.value, 4.1, 'the May 2025 cut came after the election');
assert.equal(baselineObs([{ period: '2024-Q4', value: 1 }], TERMS['2022'].date), null, 'a series that does not reach back has no baseline');
assert.equal(latestObs(cash)?.period, '2025-05-21');

// ---------- transforms and changes
const flows: Obs[] = ['2024-Q1', '2024-Q2', '2024-Q3', '2024-Q4', '2025-Q1'].map((period) => ({ period, value: 10 }));
assert.deepEqual(sumFourQuarters(flows), [{ period: '2024-Q4', value: 40 }, { period: '2025-Q1', value: 40 }]);
assert.deepEqual(difference([{ period: 'a', value: 3.4 }], [{ period: 'a', value: 2.1 }]), [{ period: 'a', value: 1.3 }]);
assert.equal(changeBetween(4, 4.5, 'pp'), 0.5);
assert.equal(changeBetween(100, 110, 'pct'), 10);
assert.equal(changeBetween(0, 1, 'pct'), null);
assert.equal(marker(0.2), '▲');
assert.equal(marker(-0.2), '▼');
assert.equal(marker(0), '▬');
assert.equal(marker(null), '');

// ---------- rating thresholds
assert.equal(ratingForRatio(1.1), 'ahead');
assert.equal(ratingForRatio(1.0999), 'on track');
assert.equal(ratingForRatio(0.9), 'on track');
assert.equal(ratingForRatio(0.8999), 'behind');
assert.equal(ratingForRatio(0.6), 'behind');
assert.equal(ratingForRatio(0.5999), 'off track');
assert.equal(ratingForRatio(-1), 'off track');

// ---------- a count (the Housing Accord): 1,200 over five years from mid-2024, 60 a quarter needed
const accord: Commitment = { method: 'cumulative_sum', target_value: 1200, start_date: '2024-07-01', target_date: '2029-06-30' };
const quarters = (from: [number, number], n: number, value: number | ((i: number) => number)) => Array.from({ length: n }, (_, i) => {
  const k = from[0] * 4 + (from[1] - 1) + i;
  return { period: `${Math.floor(k / 4)}-Q${(k % 4) + 1}`, value: typeof value === 'function' ? value(i) : value };
});
const before = { period: '2024-Q2', value: 999 };
let a = assess(accord, [before, ...quarters([2024, 3], 8, 60)]);
assert.equal(a.progress, 480, 'quarters before the start are not counted');
assert.equal(a.rating, 'on track', `even pace is on track (${a.ratio})`);
assert.ok(Math.abs(a.pct! - 40) < 1e-9);
a = assess(accord, quarters([2024, 3], 8, 45));
assert.equal(a.rating, 'behind', `45 a quarter against 60+ needed (${a.ratio})`);
a = assess(accord, quarters([2024, 3], 8, 30));
assert.equal(a.rating, 'off track', `${a.ratio}`);
a = assess(accord, quarters([2024, 3], 8, 80));
assert.equal(a.rating, 'ahead', `${a.ratio}`);
a = assess(accord, quarters([2024, 3], 1, 60));
assert.equal(a.rating, 'not yet rated', 'one reading is too few');
assert.equal(assess(accord, []).rating, 'not yet rated');
// Met and missed once the data covers the deadline.
assert.equal(assess(accord, quarters([2024, 3], 20, 61)).rating, 'met');
assert.equal(assess(accord, quarters([2024, 3], 20, 50)).rating, 'missed');
// Reached early: a count cannot fall back.
assert.equal(assess(accord, quarters([2024, 3], 10, 130)).rating, 'met');

// ---------- a level (a bulk billing rate from 78 to 90 per cent by 2030)
const bulk: Commitment = { method: 'level', target_value: 90, start_date: '2025-03-25', target_date: '2030-12-31', direction: 'increase' };
const lv = (pairs: Array<[string, number]>) => pairs.map(([period, value]) => ({ period, value }));
a = assess(bulk, lv([['2025-Q1', 78], ['2025-Q2', 78.5], ['2025-Q3', 79], ['2025-Q4', 79.5], ['2026-Q1', 80], ['2026-Q2', 80.5]]));
assert.ok(a.ratio! > 0.9 && a.ratio! < 1.1, `2 points a year against about 2 needed: on track (${a.ratio})`);
assert.equal(a.rating, 'on track');
a = assess(bulk, lv([['2025-Q1', 78], ['2026-Q2', 77]]));
assert.equal(a.rating, 'off track', 'moving away from the target');
a = assess(bulk, lv([['2025-Q1', 78], ['2026-Q2', 91]]));
assert.equal(a.rating, 'ahead', 'a level reached early is ahead, not met: it can fall back');
assert.equal(assess(bulk, lv([['2025-Q1', 78], ['2030-Q4', 90.2]])).rating, 'met');
assert.equal(assess(bulk, lv([['2025-Q1', 78], ['2030-Q4', 89]])).rating, 'missed');
assert.equal(assess(bulk, lv([['2026-Q1', 80], ['2026-Q2', 81]])).readings, 2, 'starts from the first reading when none precedes the start');

// A decrease, and a % change from a reference level (emissions 43% below 2005).
const down: Commitment = { method: 'level', target_value: 2, start_date: '2025-01-01', target_date: '2027-12-31', direction: 'decrease' };
assert.equal(assess(down, lv([['2024-Q4', 5], ['2025-Q4', 4]])).rating, 'on track', 'one point a year needed, one achieved');
const cut: Commitment = { method: 'change', target_value: 43, start_date: '2022-09-13', target_date: '2030-12-31', direction: 'decrease', baseline_value: 600 };
a = assess(cut, lv([['2022', 480], ['2023', 465], ['2024', 450]]));
assert.ok(Math.abs(a.progress! - 25) < 1e-9, 'a 25% cut on 600');
assert.equal(assess({ ...cut, baseline_value: null }, lv([['2022', 480]])).rating, 'not yet rated', 'no reference level, no rating');

// ---------- terms and the summary
assert.equal(inTerm({ target_date: '2025-04-01' }, '2025'), false, 'a deadline before this term is shown only since taking office');
assert.equal(inTerm({ target_date: '2025-04-01' }, '2022'), true);
assert.equal(summaryLine([]), '');
assert.equal(summaryLine(['on track', 'behind', 'on track']), 'Of 3 promises with data: 2 on track, 1 behind.');

// ---------- the strict check, fail closed
const pass = { quote_found: true, audited: true, confirmed: true, metric_id: 'x', covered: true };
assert.equal(decideStatus(pass), 'active');
assert.equal(decideStatus({ ...pass, audited: false }), 'held', 'no audit, not shown');
assert.equal(decideStatus({ ...pass, quote_found: false }), 'held');
assert.equal(decideStatus({ ...pass, confirmed: false }), 'held');
assert.equal(decideStatus({ ...pass, metric_id: null }), 'awaiting_data');
assert.equal(decideStatus({ ...pass, covered: false }), 'awaiting_data');
assert.equal(coversStart(accord, quarters([2024, 3], 2, 1)), true);
assert.equal(coversStart(accord, quarters([2024, 4], 2, 1)), false, 'the first quarter of the window is missing');
assert.equal(coversStart(bulk, lv([['2025-Q1', 78]])), true);
assert.equal(coversStart(bulk, lv([['2025-Q2', 78]])), false);

const good = { title: 'Homes built', quote: 'to build 1.2 million new homes over five years', source_url: 'https://treasury.gov.au/x', target_value: 1200000, target_unit: 'homes', method: 'cumulative_sum', start_date: '2024-07-01', target_date: '2029-06-30' };
assert.equal(normaliseDraft(good).ok, true);
assert.equal(normaliseDraft({ ...good, source_url: 'https://alp.org.au/x' }).ok, false, 'a party document is not official');
assert.equal(normaliseDraft({ ...good, quote: 'build homes' }).ok, false);
assert.equal(normaliseDraft({ ...good, target_value: 'lots' }).ok, false);
assert.equal(normaliseDraft({ ...good, target_value: null }).ok, false);
assert.equal(normaliseDraft({ ...good, method: 'vibes' }).ok, false);
assert.equal(normaliseDraft({ ...good, target_date: '2024-01-01' }).ok, false);
assert.equal(normaliseDraft({ ...good, title: 'A failed housing promise' }).ok, false, 'no evaluative words');
const n = normaliseDraft(good);
assert.ok(n.ok && n.draft.slug === 'homes-built');
assert.deepEqual(changedFields({ target_value: 1, quote: 'a' }, { target_value: 2, quote: 'a' }), ['target_value']);

// ---------- seeds and fixed texts follow the house rules
for (const s of SEED) {
  const r = normaliseDraft(s);
  assert.ok(r.ok, `seed ${s.slug}: ${r.ok ? '' : r.reason}`);
  assert.ok(!EVALUATIVE.test(s.title), s.slug);
}
for (const o of OUTCOMES) {
  for (const t of [o.title, o.control, o.note ?? '']) assert.ok(!EVALUATIVE.test(t), `${o.key}: "${t}"`);
  assert.ok(o.control.length > 40, `${o.key} has a control note`);
}
const inflation = OUTCOMES.find((o) => o.key === 'inflation')!;
assert.equal(inflation.primary.metric_id, 'cpi_annual_au');
assert.equal(inflation.secondary?.metric_id, 'trimmed_mean_cpi_au', 'headline CPI and the trimmed mean together');
assert.match(CPI_NOTE, /trimmed mean is the RBA's preferred measure of underlying inflation/);
assert.match(OUTCOMES.find((o) => o.key === 'cash-rate')!.control, /independent/);

console.log('scorecard checks passed');
