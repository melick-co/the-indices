import assert from 'node:assert/strict';
import {
  adoptedMetricId, claimRequests, findClaim, normaliseNeeds, orderDemand, requestKey, slug, takenKeys,
} from './claim-requests.mjs';

// ---------- needs: official recurring statistics only
assert.deepEqual(
  normaliseNeeds({ series: 'Unemployment rate, trend, Australia, monthly', org: 'Australian Bureau of Statistics', why: 'claim on jobs' }),
  { series: 'Unemployment rate, trend, Australia, monthly', org: 'ABS', why: 'claim on jobs', tier: 1 },
);
assert.equal(normaliseNeeds({ series: 'Housing credit growth, annual', org: 'Reserve Bank of Australia' }).tier, 1);
assert.equal(normaliseNeeds({ series: 'Gross government debt, % of GDP', org: 'IMF' }).tier, 2);
assert.equal(normaliseNeeds({ series: 'Labour productivity growth, OECD members', org: 'the OECD' }).org, 'OECD');
assert.equal(normaliseNeeds({ series: 'Underlying cash balance, annual', org: 'Parliamentary Budget Office' }).tier, 1);
// Private data, polls and surveys are never requested, whoever is named as publisher.
assert.equal(normaliseNeeds({ series: 'Cotality home value index, national', org: 'Cotality' }), null);
assert.equal(normaliseNeeds({ series: 'CoreLogic home value index', org: 'ABS' }), null);
assert.equal(normaliseNeeds({ series: 'Westpac-Melbourne Institute consumer sentiment', org: 'Westpac' }), null);
assert.equal(normaliseNeeds({ series: 'PropTrack rent index', org: 'RBA' }), null);
assert.equal(normaliseNeeds({ series: 'Two-party preferred vote, Newspoll', org: 'ABS' }), null);
assert.equal(normaliseNeeds({ series: 'NAB business confidence index', org: 'NAB' }), null);
// Forecasts, targets and promises are not series.
assert.equal(normaliseNeeds({ series: 'Treasury forecast of GDP growth 2026-27', org: 'Treasury' }), null);
assert.equal(normaliseNeeds({ series: 'Housing Accord target of 1.2 million homes', org: 'Treasury' }), null);
// Unknown or non-official publishers, junk shapes.
assert.equal(normaliseNeeds({ series: 'Electricity spot price, NSW', org: 'AEMO' }), null);
assert.equal(normaliseNeeds({ series: 'GDP', org: 'ABS' }), null, 'too short to search for');
assert.equal(normaliseNeeds(null), null);
assert.equal(normaliseNeeds('Unemployment rate'), null);
assert.equal(normaliseNeeds({ org: 'ABS' }), null);

// ---------- the dedupe key is the scout's slug
assert.equal(slug('Unemployment rate, trend, Australia, monthly'), 'unemployment_rate_trend_australia_monthly');
assert.equal(requestKey('  Unemployment rate — trend; Australia (monthly) '), requestKey('unemployment rate, trend, australia, monthly'));

// ---------- requests from reviewed claims
const claims = [
  { text: 'The Treasurer said unemployment is 4.1 per cent.', metric_id: 'unemployment_rate_au', verdict: 'agrees', needs: null },
  { text: 'The minister said building approvals rose 5 per cent.', metric_id: null, verdict: 'no series',
    needs: { series: 'Dwelling units approved, monthly, Australia', org: 'ABS', why: 'approvals claim' } },
  { text: 'The minister said approvals were the highest in years.', metric_id: null, verdict: 'no series',
    needs: { series: 'Dwelling units approved, monthly, Australia', org: 'ABS' } }, // same series: one request
  { text: 'An economist expects rates to fall.', metric_id: null, verdict: 'no series', needs: null },
  { text: 'CoreLogic says prices rose.', metric_id: null, verdict: 'no series', needs: { series: 'CoreLogic home values', org: 'CoreLogic' } },
  // Checked against a series, but it carried a need: no request.
  { text: 'x', metric_id: 'cpi_au', verdict: 'partly', needs: { series: 'CPI, monthly indicator', org: 'ABS' } },
];
const reqs = claimRequests(claims, { origin: 'australia_inc', url: 'https://example.gov.au/r', item_id: 'item-1', title: 'Approvals up' });
assert.equal(reqs.length, 1);
assert.equal(reqs[0].key, 'dwelling_units_approved_monthly_australia');
assert.deepEqual(reqs[0].row, {
  action: 'register_data_source', status: 'pending', summary: 'Dwelling units approved, monthly, Australia',
  payload: {
    series: 'Dwelling units approved, monthly, Australia', org: 'ABS', tier: 1, why: 'approvals claim',
    url: 'https://example.gov.au/r', origin: 'australia_inc', claim: 'The minister said building approvals rose 5 per cent.',
    claim_index: 1, item_id: 'item-1', title: 'Approvals up',
  },
});
const econ = claimRequests([{ text: 'Debt is rising.', verdict: 'no series', metric_id: null, needs: { series: 'Household debt to income ratio, quarterly', org: 'RBA' } }],
  { origin: 'economists', url: null, note_id: 'n1' });
assert.equal(econ[0].row.payload.note_id, 'n1');
assert.equal(econ[0].row.payload.item_id, undefined);
assert.match(econ[0].row.payload.why, /economists/);
assert.deepEqual(claimRequests(undefined, { origin: 'economists' }), []);

// ---------- what is already requested or recently tried
const now = Date.parse('2026-10-17T00:00:00Z');
const taken = takenKeys([
  { summary: 'x', payload: { series: 'Dwelling units approved, monthly, Australia' }, status: 'pending', created_at: '2026-01-01' },
  { summary: 'Wage price index, annual', payload: {}, status: 'approved', created_at: '2025-01-01' },
  { summary: 'Old rejected', payload: { series: 'Old rejected' }, status: 'rejected', created_at: '2026-01-01', reviewed_at: '2026-01-02' },
  { summary: 'New rejected', payload: { name: 'New rejected' }, status: 'rejected', created_at: '2026-10-10', reviewed_at: '2026-10-11' },
], [
  { requested_id: 'claim:job_vacancies_quarterly', last_tried: '2026-10-01T00:00:00Z' },
  { requested_id: 'net_overseas_migration', last_tried: '2026-10-15T00:00:00Z' },
  { requested_id: 'claim:stale_try', last_tried: '2026-08-01T00:00:00Z' },
], now);
assert.ok(taken.has('dwelling_units_approved_monthly_australia'));
assert.ok(taken.has('wage_price_index_annual'));
assert.ok(!taken.has('old_rejected'), 'an old editor rejection does not block a new request');
assert.ok(taken.has('new_rejected'));
assert.ok(taken.has('job_vacancies_quarterly'));
assert.ok(taken.has('net_overseas_migration'));
assert.ok(!taken.has('stale_try'), 'tried more than RETRY_DAYS ago');

// ---------- the adopted series
assert.equal(adoptedMetricId({ payload: { adopted_metric_id: 'dwelling_approvals_au' } }), 'dwelling_approvals_au');
assert.equal(adoptedMetricId({ payload: {}, review_note: 'Adopted by the source scout as dwelling_approvals_au: abs BA_GCCSA …' }), 'dwelling_approvals_au');
assert.equal(adoptedMetricId({ payload: {}, review_note: 'Source scout rejected: no match' }), null);
assert.equal(adoptedMetricId({ payload: { adopted_metric_id: 'Bad Id!' }, review_note: null }), null);
assert.equal(adoptedMetricId(null), null);

// ---------- finding the claim again
assert.equal(findClaim(claims, { claim: 'The minister said building approvals rose 5 per cent.', claim_index: 3 }), 1);
assert.equal(findClaim(claims, { claim: 'A claim that was rewritten', claim_index: 1 }), -1, 'a changed claim is not re-checked by position');
assert.equal(findClaim(claims, { claim_index: 1 }), 1);
assert.equal(findClaim(null, { claim: 'x' }), -1);

// ---------- scout order
const s = (id, origin, created_at) => ({ id, origin, created_at });
const order = orderDemand(
  [s('foundry_a', null, '2026-10-16'), s('claim_old', 'economists', '2026-10-10'), s('claim_new', 'australia_inc', '2026-10-16'),
    s('claim_mid', 'australia_inc', '2026-10-12'), s('claim_4', 'economists', '2026-10-11'), s('claim_5', 'economists', '2026-10-09')],
  [{ id: 'pitch_x' }, { id: 'pitch_y' }],
  6,
).map((t) => t.id);
assert.deepEqual(order, ['claim_new', 'claim_mid', 'claim_4', 'claim_old', 'foundry_a', 'claim_5']);
assert.deepEqual(orderDemand([], [{ id: 'p' }], 6).map((t) => t.id), ['p']);
assert.deepEqual(orderDemand([s('f', undefined, '2026-10-01')], [{ id: 'p' }], 6).map((t) => t.id), ['f', 'p']);

console.log('claim-requests.check: ok');
