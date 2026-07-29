/**
 * Validates the engine against the worked example in the
 * Composite Index Construction Standard v1.0, section 13.
 *
 * If this test fails, either the engine or the published standard is wrong.
 * They must agree.
 */
import { loadMetrics, loadIndex, loadEntities } from '../src/load.js';
import { computeIndex, computeAll } from '../src/compute.js';
import { normalise } from '../src/normalise.js';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}` + (ok ? '' : `  expected ${expected}, got ${actual}`));
}

console.log('\n--- Normalisation (Standard section 5) ---');
check('debt 223 in [0,250] pressure', +normalise(223, [0, 250], 'higher_is_more_pressure').score.toFixed(1), 89.2);
check('years 12.4 in [0,25] pressure', +normalise(12.4, [0, 25], 'higher_is_more_pressure').score.toFixed(1), 49.6);
check('wage 6.0 in [-25,80] inverted', +normalise(6.0, [-25, 80], 'higher_is_less_pressure').score.toFixed(1), 70.5);
check('savings 6.1 in [-5,20] inverted', +normalise(6.1, [-5, 20], 'higher_is_less_pressure').score.toFixed(1), 55.6);

console.log('\n--- Winsorisation (Standard section 5.3) ---');
check('above upper bound clamps to 100', normalise(300, [0, 250], 'higher_is_more_pressure').score, 100);
check('above upper bound sets flag', normalise(300, [0, 250], 'higher_is_more_pressure').winsorised, true);
check('within bounds sets no flag', normalise(100, [0, 250], 'higher_is_more_pressure').winsorised, false);

console.log('\n--- HSI worked example, Australia (Standard section 13) ---');
const metrics = loadMetrics('data/metrics');
const def = loadIndex('hsi', 'indices');
const aus = computeIndex(def, metrics, 'AUS');
check('Australia HSI score', +aus.score!.toFixed(1), 66.2);
check('Australia coverage', aus.coverage, 100);
check('Australia scored', aus.scored, true);

console.log('\n--- Coverage rule (Standard section 7) ---');
const codes = loadEntities('data/entities.json').map((e) => e.code);
const all = computeAll(def, metrics, codes);
const che = all.find((r) => r.entity === 'CHE')!;
check('Switzerland scored on 3 of 4 components', che.scored, true);
check('Switzerland coverage is 75%', che.coverage, 75);
const chl = all.find((r) => r.entity === 'CHL')!;
check('Chile not scored (below threshold)', chl.scored, false);
check('Chile score is null, not imputed', chl.score, null);

console.log('\n--- Weight rescaling (Standard section 7.2) ---');
const cheWeights = che.components.filter((c) => c.normalised !== null)
  .reduce((s, c) => s + c.weight, 0);
check('present weights rescale to 1.000', +cheWeights.toFixed(3), 1);

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
