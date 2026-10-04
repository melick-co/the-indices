import { releasePage } from '@/lib/events';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** The reference period a footnote names: "June quarter 2026", "Q2 2026", "2026-Q2", "August 2026". */
export function periodIn(text: string): { year: number; month: number } | null {
  let m = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:quarter\s+)?(\d{4})\b/i.exec(text);
  if (m) return { year: Number(m[2]), month: MONTHS.indexOf(m[1].toLowerCase()) + 1 };
  m = /\bQ([1-4])\s+(\d{4})\b/i.exec(text) ?? null;
  if (m) return { year: Number(m[2]), month: Number(m[1]) * 3 };
  m = /\b(\d{4})-Q([1-4])\b/i.exec(text);
  if (m) return { year: Number(m[1]), month: Number(m[2]) * 3 };
  return null;
}

/**
 * ABS "latest-release" addresses always open the newest release, so a footnote citing the June quarter CPI ends
 * up opening August's. Each one is pinned to the dated release page for the period its footnote names, when that
 * page exists. Mutates the footnotes; returns how many were pinned.
 */
export async function pinReleaseLinks(story: { evidence?: { footnotes?: Array<{ n: number; text: string; url?: string }> } | null }): Promise<number> {
  let pinned = 0;
  for (const f of story.evidence?.footnotes ?? []) {
    const m = /^(https:\/\/www\.abs\.gov\.au\/statistics\/.+?)\/latest-release\/?$/.exec(f.url ?? '');
    if (!m) continue;
    // A footnote for a release schedule ("next release …") needs the latest-release page, which lists it.
    if (/\b(next release|scheduled|release calendar|release date)\b/i.test(f.text)) continue;
    const period = periodIn(f.text);
    if (!period) continue;
    const page = await releasePage(m[1], period.year, period.month).catch(() => null);
    if (page?.url) { f.url = page.url; pinned++; }
  }
  return pinned;
}
