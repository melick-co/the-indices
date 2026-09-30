import assert from 'node:assert/strict';
import { normaliseMetricIds, withUnlinked } from './metric-ids.mjs';

const known = new Set(['cash_rate_au', 'wpi_annual_au', 'household_debt_to_income']);

// Aliases map to the real id and collapse duplicates; unknown ids are kept aside.
assert.deepEqual(
  normaliseMetricIds(['rba_cash_rate', 'cash_rate', 'cash_rate_au', 'wpi_growth', 'trimmed_mean_cpi', ' ', null], known),
  { linked: ['cash_rate_au', 'wpi_annual_au'], unlinked: ['trimmed_mean_cpi'] },
);
// An alias whose target is not in the store is unlinked under its original name.
assert.deepEqual(normaliseMetricIds(['net_overseas_migration'], known), { linked: [], unlinked: ['net_overseas_migration'] });
assert.deepEqual(normaliseMetricIds(undefined, known), { linked: [], unlinked: [] });

assert.deepEqual(withUnlinked({ a: 1 }, []), { a: 1 });
assert.deepEqual(withUnlinked({ unlinked_metrics: ['x'] }, ['x', 'y']), { unlinked_metrics: ['x', 'y'] });
assert.deepEqual(withUnlinked(null, ['z']), { unlinked_metrics: ['z'] });

console.log('metric-ids.check: ok');
