import assert from 'node:assert/strict';
import { checkHighlights, numbersIn } from './story-highlights';

assert.deepEqual(numbersIn('A$2,568 billion, 7.3 per cent, -A$34bn'), ['2568', '7.3', '34']);
const story = {
  title: 'Credit Surges as Collateral Falls', hook: 'The housing credit book reached A$2,568 billion as the RBA lifted rates to a 16-year high.', caveat: '',
  oneNumber: { value: '7.3%', label: 'Housing credit growth' },
  body: { blocks: [
    { type: 'paragraph', text: 'The dwelling stock fell A$34 billion in the June quarter.' },
    { type: 'chart', kind: 'line', series: [{ label: '2023-09', value: 4.2 }, { label: '2026-08', value: 7.3 }] },
  ] },
} as never;
assert.deepEqual(checkHighlights([
  { figure: 'A$2,568bn', label: 'Housing credit', note: 'growing 7.3% a year', direction: 'up', chart: 0 },
  { figure: '-A$34bn', label: 'Dwelling stock', note: 'in the June quarter', direction: 'down', chart: null },
], story), []);
assert.match(checkHighlights([{ figure: 'A$2.6trn', label: 'Housing credit' }, { figure: '-A$34bn', label: 'Dwellings' }], story).join(), /"2.6"/);
assert.match(checkHighlights([{ figure: '7.3%', label: 'x', chart: 3 }, { figure: '7.3%', label: 'y' }], story).join(), /chart 3/);
console.log('story-highlights.check: ok');
assert.match(checkHighlights([{ figure: '7.3%', label: 'one two three four five six seven' }, { figure: '-A$34bn', label: 'Dwellings' }], story).join(), /over 6 words/);
console.log('story-highlights.check: lengths ok');
assert.match(checkHighlights([{ figure: '7.3%', label: 'a', chart: 0 }, { figure: '-A$34bn', label: 'b', chart: 0 }], story).join(), /used twice/);
console.log('story-highlights.check: charts ok');
import { chartFits } from './story-highlights';
const rank = { type: 'chart', kind: 'bars', series: [{ label: 'United States', value: 1425.1 }, { label: 'Germany', value: 600 }] } as never;
assert.equal(chartFits({ figure: '1,425.1k', label: 'US permanent migrants' }, rank), true);
assert.equal(chartFits({ figure: '4.19', label: 'US per 1,000' }, rank), false);
assert.equal(chartFits({ figure: '-A$34bn', label: 'x' }, { type: 'chart', kind: 'line', series: [] } as never), true);
console.log('story-highlights.check: chart fit ok');
