/** RBA Board meeting dates — first Tuesday of each month except January. */

const MEETING_MONTHS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** @param {number} year @param {number} month 1-12 */
function firstTuesday(year, month) {
  const d = new Date(Date.UTC(year, month - 1, 1));
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** @param {Date} [from] */
export function rbaMeetingsInYear(year) {
  return MEETING_MONTHS.map((month) => ({
    date: firstTuesday(year, month),
    label: firstTuesday(year, month).toISOString().slice(0, 10),
  }));
}

/** Next Board meeting on or after `from` (UTC date). */
export function nextRbaMeeting(from = new Date()) {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  for (let y = start.getUTCFullYear(); y <= start.getUTCFullYear() + 2; y++) {
    for (const m of MEETING_MONTHS) {
      const meeting = firstTuesday(y, m);
      if (meeting >= start) {
        return {
          date: meeting,
          iso: meeting.toISOString().slice(0, 10),
          year: y,
          month: m,
        };
      }
    }
  }
  throw new Error('No RBA meeting found within 2 years');
}

/** Days in calendar month (UTC). */
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** ASX rate-tracker day fractions for a meeting in its calendar month. */
export function meetingDayFractions(meetingDate) {
  const year = meetingDate.getUTCFullYear();
  const month = meetingDate.getUTCMonth() + 1;
  const day = meetingDate.getUTCDate();
  const dim = daysInMonth(year, month);
  const nb = (day - 1) / dim;
  const na = 1 - nb;
  return { nb, na, daysInMonth: dim, meetingDay: day };
}
