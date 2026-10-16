'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase-server';
import { dispatchTask } from '@/lib/github-dispatch';
import { sydneyDay } from '@/lib/dates';
import { strictCheckRub } from '@/lib/rub-check';
import { approvable, statusFor, type RubCheck } from '@/lib/rub-rules';

const OPEN = ['pending', 'draft'];

function refresh(slug?: string) {
  revalidatePath('/foundry/rub');
  revalidatePath('/the-rub');
  if (slug) revalidatePath(`/the-rub/${slug}`);
  revalidatePath('/');
}

async function load(id: string) {
  const { data, error } = await createClient().from('rubs').select('id, slug, status, check, metric_ids').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('That column is gone.');
  return data as { id: string; slug: string; status: string; check: RubCheck | null; metric_ids: string[] | null };
}

/** Publish a column whose strict check passed for its current copy. Re-runs nothing; the database gate checks too. */
export async function approveRub(id: string) {
  await requireAdmin();
  const row = await load(id);
  if (row.status !== 'pending' || !approvable(row.check)) throw new Error('Only a column that passed the strict check (with the claim audit) can be approved.');
  const now = new Date().toISOString();
  const { data, error } = await createClient().from('rubs')
    .update({ status: 'published', published: sydneyDay(), reviewed_at: now })
    .eq('id', id).eq('status', 'pending').select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('It changed while you were looking. Reload and try again.');
  refresh(row.slug);
}

export async function rejectRub(id: string, note: string) {
  await requireAdmin();
  const row = await load(id);
  if (!OPEN.includes(row.status)) throw new Error('Only a pending or draft column can be rejected.');
  const { error } = await createClient().from('rubs')
    .update({ status: 'rejected', review_note: note.trim() || null, reviewed_at: new Date().toISOString() })
    .eq('id', id).in('status', OPEN);
  if (error) throw new Error(error.message);
  refresh();
}

export type RubEdit = { title: string; paragraphs: string[]; keywords: string[]; metric_ids: string[] };

/** Save an editor's copy and re-run the strict check on it: passed → pending, failed → draft. */
export async function saveRubEdit(id: string, edit: RubEdit): Promise<RubCheck> {
  await requireAdmin();
  const row = await load(id);
  if (!OPEN.includes(row.status)) throw new Error('Only a pending or draft column can be edited here.');
  const db = createClient();
  const copy = {
    title: edit.title.trim(),
    paragraphs: edit.paragraphs.map((p) => p.trim()).filter(Boolean),
  };
  const keywords = [...new Set(edit.keywords.map((k) => k.toLowerCase().trim()).filter(Boolean))];
  const metricIds = [...new Set(edit.metric_ids.map((m) => m.trim()).filter(Boolean))];
  const check = await strictCheckRub(db, copy, metricIds);
  const { error } = await db.from('rubs')
    .update({ ...copy, keywords, metric_ids: metricIds, check, status: statusFor(check), review_note: null })
    .eq('id', id).in('status', OPEN);
  if (error) throw new Error(error.message);
  refresh();
  return check;
}

/** Start a fresh draft on the runner (workflow task rub-draft). It lands here when it is done. */
export async function draftRubNow() {
  await requireAdmin();
  return dispatchTask('rub-draft');
}
