/**
 * Which party formed the Australian Government, and for how many days of each financial year. Pure, so
 * office.check.ts can run it.
 *
 * Dates are the days each Prime Minister was sworn in, where the party in government changed (a change of leader
 * within a party is not a change here). A government holds office from its swearing-in day, inclusive, so the day of
 * the change counts to the incoming party. Sources:
 *   National Archives of Australia, Australia's Prime Ministers (naa.gov.au/explore-collection/australias-prime-ministers)
 *   Parliamentary Handbook, Prime Ministers (handbook.aph.gov.au/parliamentarians/prime-ministers)
 *   Parliamentary Library, Party leadership changes and challenges: a quick guide (aph.gov.au, 2022–23)
 */
export type Party = 'coalition' | 'labor';

export const PARTIES: Record<Party, { label: string; inOffice: string }> = {
  labor: { label: 'Labor', inOffice: 'Labor in office' },
  coalition: { label: 'Coalition', inOffice: 'Coalition in office' },
};

/** Each change of the party in government: the party, from its swearing-in day (YYYY-MM-DD), and the PMs it covers. */
export const GOVERNMENTS: { party: Party; from: string; pms: string }[] = [
  { party: 'coalition', from: '1996-03-11', pms: 'Howard' },
  { party: 'labor', from: '2007-12-03', pms: 'Rudd, Gillard, Rudd' },
  { party: 'coalition', from: '2013-09-18', pms: 'Abbott, Turnbull, Morrison' },
  { party: 'labor', from: '2022-05-23', pms: 'Albanese' },
];

export const OFFICE_SOURCES = [
  { org: 'National Archives of Australia', dataset: "Australia's Prime Ministers (dates in office)", url: 'https://www.naa.gov.au/explore-collection/australias-prime-ministers' },
  { org: 'Parliament of Australia', dataset: 'Parliamentary Handbook, Prime Ministers', url: 'https://handbook.aph.gov.au/parliamentarians/prime-ministers' },
];

const DAY = 864e5;
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Days from `a` to `b` inclusive of both (ISO dates), 0 if b is before a. */
export function daysInclusive(a: string, b: string): number {
  return Math.max(0, Math.round((utc(b) - utc(a)) / DAY) + 1);
}

/** The financial year ending 30 June of `endYear`: its first and last days. */
export function fyBounds(endYear: number): { start: string; end: string } {
  return { start: `${endYear - 1}-07-01`, end: `${endYear}-06-30` };
}

/** The financial year label used across the site: 2008 → "2007–08". */
export const fyName = (endYear: number) => `${endYear - 1}–${String(endYear).slice(2)}`;

/**
 * Days each party was in office in the financial year ending 30 June `endYear`, in the order they held office.
 * Shares sum to 1. FY2007–08: Coalition 155 days (1 July to 2 December 2007), Labor 211 (3 December 2007 to 30 June
 * 2008, a leap year).
 */
export function officeSplit(endYear: number, governments = GOVERNMENTS): { party: Party; days: number; share: number }[] {
  const { start, end } = fyBounds(endYear);
  const total = daysInclusive(start, end);
  const out: { party: Party; days: number; share: number }[] = [];
  governments.forEach((g, i) => {
    const next = governments[i + 1];
    const from = g.from > start ? g.from : start;
    // The day before the next government is sworn in.
    const to = next ? new Date(utc(next.from) - DAY).toISOString().slice(0, 10) : end;
    const last = to < end ? to : end;
    const days = from <= last ? daysInclusive(from, last) : 0;
    if (days > 0) out.push({ party: g.party, days, share: days / total });
  });
  const sum = out.reduce((t, x) => t + x.days, 0);
  if (sum !== total) throw new Error(`officeSplit ${fyName(endYear)}: ${sum} days of ${total} covered`);
  return out;
}
