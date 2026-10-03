import type { StructuredStory } from '@/lib/article-from-pitch';

type Note = { n: number; text: string; url?: string };

/**
 * One source, one footnote: footnotes that cite the same URL are merged into the first (their descriptions
 * joined when they differ), every [^n] marker and numbered footnote field is pointed at the merged note, and
 * the notes are renumbered 1, 2, 3 … in order. Mutates and returns the story.
 */
export function mergeDuplicateFootnotes<T extends Pick<StructuredStory, 'hook' | 'body' | 'evidence'> & Record<string, unknown>>(story: T): T {
  const notes = [...((story.evidence?.footnotes ?? []) as Note[])].sort((a, b) => a.n - b.n);
  if (notes.length < 2) return story;
  const key = (u?: string) => (u ?? '').trim().replace(/\/$/, '').toLowerCase();
  const kept: Note[] = [];
  const target = new Map<number, Note>();
  for (const f of notes) {
    const same = f.url && kept.find((k) => k.url && key(k.url) === key(f.url));
    if (same) {
      const t = f.text.trim();
      if (t && !same.text.includes(t)) same.text = `${same.text.replace(/\.?\s*$/, '.')} ${t}`;
      target.set(f.n, same);
    } else {
      const copy = { ...f };
      kept.push(copy);
      target.set(f.n, copy);
    }
  }
  if (kept.length === notes.length && kept.every((k, i) => k.n === i + 1)) return story;
  const renumber = new Map<number, number>();
  kept.forEach((k, i) => renumber.set(k.n, i + 1));
  const to = (n: number) => renumber.get(target.get(n)?.n ?? n) ?? n;
  // Markers: remap, then collapse a repeated marker ([^2][^2]) left by the merge.
  const text = (t: unknown) => (typeof t !== 'string' ? t
    : t.replace(/\[\^(\d+)\]/g, (_, n) => `[^${to(Number(n))}]`).replace(/(\[\^\d+\])\1+/g, '$1'));
  const s = story as Record<string, unknown>;
  for (const k of ['hook', 'caveat', 'kicker', 'title']) if (k in s) s[k] = text(s[k]);
  const one = s.one_number as { footnote?: number } | null | undefined;
  if (one?.footnote) one.footnote = to(one.footnote);
  for (const b of (story.body?.blocks ?? []) as unknown as Record<string, unknown>[]) {
    for (const k of ['text', 'caption']) if (k in b) b[k] = text(b[k]);
    if (Array.isArray(b.items)) b.items = b.items.map(text);
    if (typeof b.footnote === 'number') b.footnote = to(b.footnote);
    if (Array.isArray(b.events)) {
      for (const e of b.events as { label: string; footnote?: number }[]) {
        e.label = text(e.label) as string;
        if (e.footnote) e.footnote = to(e.footnote);
      }
    }
  }
  story.evidence = { ...story.evidence, footnotes: kept.map((k) => ({ ...k, n: renumber.get(k.n)! })) } as T['evidence'];
  return story;
}
