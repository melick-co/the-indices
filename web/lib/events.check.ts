import assert from 'node:assert/strict';
import { absCalendar, sydneyTime } from './events';

// AEST (UTC+10) before the 4 October 2026 switch, AEDT (UTC+11) after.
assert.equal(sydneyTime(2026, 9, 29, 14, 30).toISOString(), '2026-09-29T04:30:00.000Z');
assert.equal(sydneyTime(2026, 11, 3, 14, 30).toISOString(), '2026-11-03T03:30:00.000Z');
assert.equal(sydneyTime(2026, 11, 18, 11, 30).toISOString(), '2026-11-18T00:30:00.000Z');

const cal = absCalendar([{
  url: 'https://www.abs.gov.au/x',
  body: 'Reference period\nJune 2026\nFuture releases\n• Next Release 18/11/2026 Wage Price Index, Australia, September 2026\n• Next Release 17/02/2027 Wage Price Index, Australia, December 2026\n• Next Release 01/12/2026 Something Unwatched, Australia, 2026\n• Next Release 2/12/2026 Australian National Accounts: National Income, Expenditure and Product, September 2026',
}]);
assert.deepEqual(cal.map((e) => [e.event_key, e.title, e.scheduled_at]), [
  ['abs:wpi:2026-11-18', 'Wage Price Index, Australia, September 2026', '2026-11-18T00:30:00.000Z'],
  ['abs:wpi:2027-02-17', 'Wage Price Index, Australia, December 2026', '2027-02-17T00:30:00.000Z'],
  ['abs:national-accounts:2026-12-02', 'Australian National Accounts: National Income, Expenditure and Product, September 2026', '2026-12-02T00:30:00.000Z'],
]);
assert.deepEqual(cal[0].metric_ids, ['wpi_annual_au', 'wpi_private_annual_au', 'wpi_public_annual_au']);
console.log('events.check: ok');
import { refPeriodOf } from './events';
assert.deepEqual(refPeriodOf('Wage Price Index, Australia, September 2026'), { year: 2026, month: 9 });
assert.deepEqual(refPeriodOf('Total Value of Dwellings, June Quarter 2026'), { year: 2026, month: 6 });
assert.equal(refPeriodOf('Something else'), null);
console.log('refPeriodOf: ok');
