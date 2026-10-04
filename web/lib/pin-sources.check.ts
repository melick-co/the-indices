import assert from 'node:assert/strict';
import { periodIn } from './pin-sources';

assert.deepEqual(periodIn('ABS, Consumer Price Index, Australia, June quarter 2026 release.'), { year: 2026, month: 6 });
assert.deepEqual(periodIn('Building Activity, Australia, Q4 2025 release'), { year: 2025, month: 12 });
assert.deepEqual(periodIn('National Accounts, 2026-Q2'), { year: 2026, month: 6 });
assert.deepEqual(periodIn('Monthly CPI, August 2026 release'), { year: 2026, month: 8 });
assert.equal(periodIn('ABS, Wage Price Index, time series'), null);
console.log('pin-sources.check: ok');
