import assert from 'node:assert/strict';
import { rankEntities, numbersIn, allowedNumbers, unsupportedFigures } from './revise-pitches.mjs';

// Household debt to income, OECD 2024: Australia is third, not second.
const rank = rankEntities([
  { entity: 'CHE', value: 224 }, { entity: 'AUS', value: 223 }, { entity: 'NOR', value: 236 },
  { entity: 'DNK', value: 210 }, { entity: 'NLD', value: 190 }, { entity: 'CAN', value: 180 },
], '2024');
assert.equal(rank.aus_rank, 3);
assert.equal(rank.of, 6);
assert.deepEqual(rank.top.slice(0, 3), ['1. NOR 236', '2. CHE 224', '3. AUS 223']);

// Numbers: counts and years are ignored, rates are kept.
assert.deepEqual(numbersIn('Three hikes in 2026 took the cash rate to 4.6% over 5 meetings'), [4.6]);
assert.deepEqual(numbersIn('$12,689 billion; 0.8pp gap; 97.6 per cent'), [12689, 0.8, 97.6]);

// Identifiers are not figures: ABS catalogue numbers, table and series codes.
assert.deepEqual(numbersIn('ABS 6345.0 shows wages up 3.4%'), [3.4]);
assert.deepEqual(numbersIn('Source: ABS cat. no. 5206.0, Table 12; series A2325846C'), []);
assert.deepEqual(numbersIn('the 6401.0 release'), []);
assert.deepEqual(numbersIn('RBA Table D2 and 2026-Q2 data'), []);
// But a real figure next to those words still counts.
assert.deepEqual(numbersIn('ABS says 6,345 dwellings; $6345.0 million'), [6345, 6345]);

const reference = {
  cash_rate_au: { latest: { period: '2026-09-30', value: 4.6 }, earlier: [{ period: '2026-05-06', value: 4.35 }] },
  rba_hike_prob_market_au: { latest: { period: '2026-10-06', value: 0 } },
  rba_hold_prob_market_au: { latest: { period: '2026-10-06', value: 97.6 } },
  mean_dwelling_price: { latest: { period: '2026-Q2', value: 1100000 } },
  trimmed_mean_cpi: { missing: true },
};
const allowed = allowedNumbers(reference, 'Original hook citing a 3.1% wage print.');
const rev = (hook) => ({ headline: 'x', hook, mechanism: '', caveat: '', chart_hint: '' });

assert.deepEqual(unsupportedFigures(rev('Cash rate is 4.6%, markets price a 97.6% hold.'), allowed), []);
assert.deepEqual(unsupportedFigures(rev('Mean dwelling price is $1.1 million.'), allowed), []);
assert.deepEqual(unsupportedFigures(rev('Wages at 3.1% trail the cash rate.'), allowed), []);
assert.deepEqual(unsupportedFigures(rev('Markets price a 100% chance of a hike.'), allowed), [100]);
assert.deepEqual(unsupportedFigures(rev('Trimmed mean CPI is 2.7%.'), allowed), [2.7]);

console.log('revise-pitches checks passed');
