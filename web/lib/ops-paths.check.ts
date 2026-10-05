import assert from 'node:assert/strict';
import { isIndicesPath, isOpsPath } from './ops-paths';

assert.equal(isOpsPath('/foundry'), true);
assert.equal(isOpsPath('/foundry/desk'), true);
assert.equal(isOpsPath('/foundry/work/abc'), true);
assert.equal(isOpsPath('/studio/ask'), true);
assert.equal(isOpsPath('/account'), true);
assert.equal(isOpsPath('/login'), true);
assert.equal(isOpsPath('/indices'), false);
assert.equal(isIndicesPath('/indices'), true);
assert.equal(isIndicesPath('/indices/economy/rates'), true);
assert.equal(isIndicesPath('/indicesx'), false);
assert.equal(isOpsPath('/indices/hsi'), false);
assert.equal(isIndicesPath('/indices/hsi'), true);
assert.equal(isOpsPath('/metrics/gdp_per_capita'), true);
assert.equal(isOpsPath('/stories/wage-spiral/reel'), true);
assert.equal(isOpsPath('/'), false);
assert.equal(isOpsPath('/the-rub'), false);
assert.equal(isOpsPath('/stories/wage-spiral'), false);
assert.equal(isOpsPath('/instruments'), false);

console.log('ops-paths.check: ok');
