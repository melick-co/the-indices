import assert from 'node:assert/strict';
import { anthropicEntries, costUsd, readAnthropicUsage, sumCosts, SKU } from './story-costs';

// Cost is quantity times price, to the microdollar; no price means no cost, not zero.
assert.equal(costUsd(1_000_000, 0.000003), 3);
assert.equal(costUsd(12_345, 0.000015), 0.185175);
assert.equal(costUsd(8, null), null);
assert.equal(costUsd(8, undefined), null);
assert.equal(costUsd(300, 0), 0);

// Usage is read defensively and only the token classes that were used become rows.
const usage = readAnthropicUsage({ input_tokens: 4200, output_tokens: 900, cache_read_input_tokens: 0 });
assert.equal(usage.cache_creation_input_tokens, 0);
const rows = anthropicEntries('rba-hike-rent-frozen', 'script', 'claude-sonnet-4-6', usage);
assert.deepEqual(rows.map((r) => [r.sku, r.quantity]), [
  [SKU.anthropicInput('claude-sonnet-4-6'), 4200],
  [SKU.anthropicOutput('claude-sonnet-4-6'), 900],
]);
assert.ok(rows.every((r) => r.unit === 'token' && r.provider === 'anthropic' && r.stage === 'script'));

// Totals carry unpriced rows forward as a count so a partial total is never mistaken for a full one.
const total = sumCosts([
  { story_slug: 's', stage: 'voice', provider: 'elevenlabs', unit: 'credit', calls: 9, quantity: 1800, cost_usd: 0.297, unpriced: 0, last_at: '' },
  { story_slug: 's', stage: 'clip', provider: 'elevenlabs', unit: 'second', calls: 5, quantity: 40, cost_usd: 0, unpriced: 5, last_at: '' },
  { story_slug: 's', stage: 'script', provider: 'anthropic', unit: 'token', calls: 2, quantity: 5100, cost_usd: 0.026, unpriced: 0, last_at: '' },
]);
assert.deepEqual(total, { total: 0.323, unpriced: 5, calls: 16 });

console.log('story-costs: all checks passed');
