/**
 * RBA Board meeting dates. The Board has met eight times a year since 2024 (two-day meetings, decision at 2:30pm
 * Sydney on the second day), on dates the RBA publishes; the events store holds them (rba:decision events from
 * the RBA's own calendar, web/lib/events.ts). The first-Tuesday rule below is only a fallback when the store has
 * no upcoming decision: it is the pre-2024 schedule and picks months with no meeting.
 */

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

/** Next RBA decision on or after `from`, from the events store; the first-Tuesday fallback if none is stored. */
export async function nextRbaDecision(db, from = new Date()) {
  const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const { data } = await db.from('events').select('scheduled_at')
    .eq('series', 'rba:decision').gte('scheduled_at', day.toISOString())
    .order('scheduled_at', { ascending: true }).limit(1);
  const at = data?.[0]?.scheduled_at;
  if (!at) return { ...nextRbaMeeting(from), source: 'fallback' };
  // Decisions are announced at 2:30pm Sydney (early morning UTC), so the UTC date is the Sydney date.
  const d = new Date(at);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return { date, iso: date.toISOString().slice(0, 10), year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, source: 'events' };
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
