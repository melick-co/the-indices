import { createClient } from '@/lib/supabase-server';
import { CUT_MODEL, REEL_SCENE_ID } from '@/lib/reel-render-types';

/**
 * The cut's rows on story_reel_renders: kind 'reel' on the whole-reel scene id, model 'remotion'.
 * The same ledger ElevenLabs renders use, so the reel page shows the cut beside the generated
 * clips and nothing has to be told where to look.
 */

export type CutRow = {
  render_id: string;
  story_slug: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  prompt_text: string;
  output_url: string | null;
  output_path: string | null;
  error: string | null;
  created_at: string;
};

const COLUMNS = 'render_id, story_slug, status, prompt_text, output_url, output_path, error, created_at';

export async function latestCutRow(slug: string): Promise<CutRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('story_reel_renders')
    .select(COLUMNS)
    .eq('story_slug', slug)
    .eq('scene_id', REEL_SCENE_ID)
    .eq('kind', 'reel')
    .eq('model', CUT_MODEL)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CutRow | null) ?? null;
}

/** A cut that is queued or running is reused rather than doubled; otherwise a queued row is added. */
export async function queueCut(slug: string, note: string): Promise<CutRow> {
  const latest = await latestCutRow(slug);
  if (latest && (latest.status === 'queued' || latest.status === 'running')) return latest;
  const supabase = createClient();
  const { data, error } = await supabase.from('story_reel_renders').insert({
    story_slug: slug,
    scene_id: REEL_SCENE_ID,
    kind: 'reel',
    status: 'queued',
    model: CUT_MODEL,
    runway_endpoint: CUT_MODEL,
    prompt_text: note,
    updated_at: new Date().toISOString(),
  }).select(COLUMNS).single();
  if (error || !data) throw new Error(error?.message ?? 'Could not record the cut');
  return data as CutRow;
}

export async function updateCut(id: string, patch: Record<string, unknown>): Promise<CutRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('story_reel_renders')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('render_id', id)
    .select(COLUMNS)
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Could not update the cut');
  return data as CutRow;
}
