import { createClient } from '@/lib/supabase-server';
import { normaliseLinks, type BottomLine, type IncItem } from '@/lib/australia-inc';

/**
 * Reads for the public Australia Inc. pages. Only published rows: held Bottom Lines and unpublished items belong to
 * the newsdesk. Every read tolerates the tables not existing yet (before migration 46), returning nothing.
 */

const BL_COLS = 'id, day, status, headline, paragraphs, items, check, published_at';

function toBottomLine(row: Record<string, unknown>): BottomLine {
  const paragraphs = (Array.isArray(row.paragraphs) ? row.paragraphs : []) as Array<{ text?: unknown; links?: unknown }>;
  return {
    id: String(row.id), day: String(row.day), status: row.status as BottomLine['status'], headline: (row.headline as string) ?? null,
    paragraphs: paragraphs.filter((p) => typeof p.text === 'string' && p.text.trim()).map((p) => ({ text: p.text as string, links: normaliseLinks(p.links) })),
    items: Array.isArray(row.items) ? row.items as BottomLine['items'] : [],
    check: (row.check ?? {}) as BottomLine['check'], published_at: (row.published_at as string) ?? null,
  };
}

export async function loadLatestBottomLine(): Promise<BottomLine | null> {
  try {
    const { data, error } = await createClient().from('bottom_lines').select(BL_COLS).eq('status', 'published').order('day', { ascending: false }).limit(1).maybeSingle();
    return error || !data ? null : toBottomLine(data);
  } catch { return null; }
}

export async function loadBottomLine(day: string): Promise<BottomLine | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  try {
    const { data, error } = await createClient().from('bottom_lines').select(BL_COLS).eq('status', 'published').eq('day', day).maybeSingle();
    return error || !data ? null : toBottomLine(data);
  } catch { return null; }
}

export async function listBottomLines(limit = 60): Promise<Array<{ day: string; headline: string | null }>> {
  try {
    const { data, error } = await createClient().from('bottom_lines').select('day, headline').eq('status', 'published').order('day', { ascending: false }).limit(limit);
    return error ? [] : (data ?? []) as Array<{ day: string; headline: string | null }>;
  } catch { return []; }
}

export async function loadIncItems(limit = 30): Promise<IncItem[]> {
  try {
    const { data, error } = await createClient().from('inc_items')
      .select('id, title, url, publisher, published_at, kind, summary, claims, links, status')
      .eq('status', 'published').order('published_at', { ascending: false, nullsFirst: false }).limit(limit);
    if (error) return [];
    return (data ?? []).map((r) => ({ ...r, claims: Array.isArray(r.claims) ? r.claims : [], links: normaliseLinks(r.links) })) as IncItem[];
  } catch { return []; }
}
