'use server';

import { requireAdmin } from '@/lib/auth';
import { dispatchTask, recentRuns } from '@/lib/github-dispatch';
import { buildDatasets } from '@/lib/visuals-data';

export type MakeKind = 'article' | 'graphic' | 'race' | 'picture' | 'clip' | 'highlights' | 'brief' | 'house-track';

/**
 * Start one piece of work on the runner. Every pipeline keeps its own checks (fact check, number check, picture
 * check, captions from the data); finished pieces land in the production queue or on the story.
 */
export async function make(kind: MakeKind, target: string, brief?: string) {
  await requireAdmin();
  const t = target.trim();
  switch (kind) {
    case 'article': return dispatchTask('articles', { pitch: t });
    case 'graphic': return dispatchTask('visuals', t ? { pitch: t } : {});
    case 'race': return dispatchTask('races', t ? { pitch: t } : {});
    case 'picture': return dispatchTask('hero-image', { pitch: t, ...(brief?.trim() ? { edits: brief.trim() } : {}) });
    case 'clip': return dispatchTask('hero-media', { pitch: t, ...(brief?.trim() ? { edits: brief.trim() } : {}) });
    case 'highlights': return dispatchTask('story-highlights', { pitch: t });
    case 'brief': return dispatchTask('hero-brief', { pitch: t });
    case 'house-track': return dispatchTask('house-track-choose', { pitch: t });
  }
}

/** The graphics the generator can make, by dataset key and what it charts (loaded on request: it reads every series). */
export async function listGraphics(): Promise<{ key: string; label: string }[]> {
  await requireAdmin();
  const all = await buildDatasets();
  return all.map((d) => ({ key: d.key, label: `${d.spec.measure} (${d.spec.period}) · ${d.key.split(":")[0]}` }));
}

export async function runs() {
  await requireAdmin();
  return recentRuns(12);
}
