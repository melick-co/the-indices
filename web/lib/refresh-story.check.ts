import assert from 'node:assert/strict';
import { isFiguresOnly } from './refresh-story';

// Figure, period and direction-word swaps are updates.
assert.ok(isFiguresOnly('Trimmed mean inflation of 3.6 per cent in the June quarter 2026[^2]', 'Trimmed mean inflation of 3.4 per cent in the September quarter 2026[^2]'));
assert.ok(isFiguresOnly('unemployment rose to 4.6% in August', 'unemployment fell to 4.4% in September'));
assert.ok(isFiguresOnly('up for three straight quarters', 'up for four straight quarters'));
// New words or reasoning are a rewrite.
assert.ok(!isFiguresOnly('Private wages trail inflation', 'Private wages now outpace inflation'));
assert.ok(!isFiguresOnly('rose to 4.6% in August.', 'rose to 4.6% in August, the highest since 2021.'));
console.log('refresh-story.check: ok');
