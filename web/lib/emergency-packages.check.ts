import assert from 'node:assert/strict';
import { EMERGENCY_PACKAGES, packageCosts } from './emergency-packages';

const gfc = EMERGENCY_PACKAGES.find((p) => p.key === 'gfc')!;
const covid = EMERGENCY_PACKAGES.find((p) => p.key === 'covid')!;

// ---------- GFC: each year's stimulus line is the table's own "effect of policy decisions" less "other policy decisions"
gfc.years.forEach((y, i) => assert.equal(y.cost, gfc.statedTotals[i].value, `${y.fy}: ${gfc.statedTotals[i].label}`));
// The statement's text: "reduced the budget balance by $22.4 billion in 2009-10 and $12.7 billion in 2010-11".
assert.equal((gfc.years.find((y) => y.fy === '2009-10')!.cost / 1000).toFixed(1), '22.4');
assert.equal((gfc.years.find((y) => y.fy === '2010-11')!.cost / 1000).toFixed(1), '12.7');
assert.equal(gfc.years.reduce((t, y) => t + y.cost, 0), 66711);

// ---------- COVID-19: the rows add to the totals the fact sheet prints
const sum = (part: string) => covid.years.reduce((t, y) => t + (y.parts?.[part] ?? 0), 0);
assert.equal(sum('economic'), covid.statedTotals[0].value, 'economic response: $291,414m');
assert.equal(sum('health'), covid.statedTotals[1].value, 'health measures: $20,075m');
assert.equal(covid.years.reduce((t, y) => t + y.cost, 0), covid.statedTotals[2].value, '$311 billion');
assert.equal(Math.round(covid.statedTotals[2].value / 1000), 311);
for (const y of covid.years) assert.equal(y.cost, (y.parts!.economic ?? 0) + (y.parts!.health ?? 0), y.fy);

// ---------- no year in both, financial years in order, every source a Treasury document with a URL and date
const costs = packageCosts();
assert.equal(costs.size, 10);
assert.equal(costs.get('2020-21')!.cost, 145909);
assert.equal(costs.get('2020-21')!.key, 'covid');
assert.equal(costs.get('2008-09')!.key, 'gfc');
assert.throws(() => packageCosts([gfc, { ...gfc, key: 'covid' }]), /in two packages/);
for (const p of EMERGENCY_PACKAGES) {
  assert.equal(p.source.org, 'Treasury');
  assert.match(p.source.url, /^https:\/\/(reference-budget\.tspace\.gov\.au|archive\.budget\.gov\.au)\//);
  assert.match(p.source.published, /^\d{4}-\d{2}-\d{2}$/);
  p.years.forEach((y, i) => {
    assert.match(y.fy, /^\d{4}-\d{2}$/);
    assert.ok(y.cost > 0, `${p.key} ${y.fy}: a cost`);
    if (i) assert.equal(Number(y.fy.slice(0, 4)), Number(p.years[i - 1].fy.slice(0, 4)) + 1);
  });
}

console.log('emergency-packages checks passed');
