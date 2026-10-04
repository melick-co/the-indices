import assert from 'node:assert/strict';
import { correctionsIn, isFiguresOnly, withCorrections } from './refresh-story';

// Figure, period and direction-word swaps are updates.
assert.ok(isFiguresOnly('Trimmed mean inflation of 3.6 per cent in the June quarter 2026[^2]', 'Trimmed mean inflation of 3.4 per cent in the September quarter 2026[^2]'));
assert.ok(isFiguresOnly('unemployment rose to 4.6% in August', 'unemployment fell to 4.4% in September'));
assert.ok(isFiguresOnly('up for three straight quarters', 'up for four straight quarters'));
// New words or reasoning are a rewrite.
assert.ok(!isFiguresOnly('Private wages trail inflation', 'Private wages now outpace inflation'));
assert.ok(!isFiguresOnly('rose to 4.6% in August.', 'rose to 4.6% in August, the highest since 2021.'));
// Corrections stay on the record through later updates.
const corr = 'Correction, 4 October 2026: an earlier version quoted pricing for a meeting that is not scheduled.';
assert.equal(withCorrections('Updated 29 October 2026: figures brought up to date.', corr), `Updated 29 October 2026: figures brought up to date. ${corr}`);
assert.equal(withCorrections(corr, `Updated 3 October 2026: rewritten. ${corr}`), corr);
assert.equal(withCorrections('Updated: new.', 'Updated 3 October: old routine note.'), 'Updated: new.');
// Older formats ("Correction:", "Corrections:") are kept too.
assert.equal(correctionsIn('Rewritten in our news format. Correction: an earlier version said two; it was three.').length, 1);
assert.match(withCorrections('Updated: charts.', 'Rewritten. Corrections: the rate count was wrong.'), /Corrections: the rate count/);
console.log('refresh-story.check: ok');
