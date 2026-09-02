/** Australia/Sydney calendar helpers for daily trend windows. */

const SYDNEY = 'Australia/Sydney';

/** YYYY-MM-DD for a calendar day in Sydney (daysAgo from today in Sydney). */
export function sydneyDate(daysAgo = 0) {
  const now = new Date();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: SYDNEY }).format(now);
  const [y, m, d] = today.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d - daysAgo, 12, 0, 0));
  return new Intl.DateTimeFormat('en-CA', { timeZone: SYDNEY }).format(utc);
}

/** Map an ISO timestamp to Sydney calendar date (YYYY-MM-DD). */
export function toSydneyDate(iso) {
  if (!iso) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: SYDNEY }).format(new Date(iso));
}

/** Inclusive list of Sydney dates ending at periodEnd for `days` days. */
export function sydneyDateRange(periodEnd, days) {
  const [y, m, d] = periodEnd.split('-').map(Number);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(Date.UTC(y, m - 1, d - i, 12, 0, 0));
    out.push(new Intl.DateTimeFormat('en-CA', { timeZone: SYDNEY }).format(dt));
  }
  return out;
}

/** Prior Sydney date string (YYYY-MM-DD). */
export function priorSydneyDate(isoDate, daysBack = 1) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - daysBack, 12, 0, 0));
  return new Intl.DateTimeFormat('en-CA', { timeZone: SYDNEY }).format(dt);
}

export function formatSydneyDate(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
