import { createClient } from '@/lib/supabase-server';
import { CHARTER, MODEL } from '@/lib/research-agent';
import { loadStoryBySlug } from '@/lib/stories-loader';
import type { Story } from '@/lib/story-types';
import {
  buildShotList,
  ON_SCREEN_CHARS,
  LOWER_THIRD_CHARS,
  REEL_FORMAT,
  REEL_SECONDS,
  SCENE_SECONDS,
  validateReel,
  wordBudget,
  WORDS_PER_SECOND,
  type ReelScene,
  type ReelSpec,
  type ReelStyle,
  type StoryReel,
} from '@/lib/reel-types';

export type ReelResult = {
  slug: string;
  status: 'draft' | 'ready';
  totalSeconds: number;
  sceneCount: number;
  warnings: string[];
  generationNote: string;
  reelUrl: string;
};

/**
 * The house look, held constant so reels are recognisably ours rather than re-invented per story.
 * Mirrors the site: Swiss editorial grid on raw paper, IBM Plex Mono, one accent.
 */
const HOUSE_STYLE: ReelStyle = {
  presenter:
    'Single presenter, piece to camera, framed centre with headroom for burned-in text above and ' +
    'a lower third below. Plain warm-white studio wall, no desk clutter, no newsroom video wall. ' +
    'Presenter holds still; the charts move, not the camera.',
  look:
    'Swiss editorial grid on raw off-white paper stock. Charcoal ink, one accent for the ' +
    'highlighted series. IBM Plex Mono for all figures, labels and straps, set in caps with wide ' +
    'letter spacing. Hairline rules, generous margins, no gradients, no drop shadows, no 3D. ' +
    'Charts drawn flat as bars and rank rows, tabular figures, always captioned with the source.',
  voice:
    'Measured Australian news read, no hype, no rising inflection. The number does the work. ' +
    'Australian English throughout. No em dashes in any burned-in text.',
  audio:
    'Sparse percussive bed under the reveals, dropping out entirely under the caveat so it lands ' +
    'dry. Soft transient on each chart reveal. No stings, no whooshes.',
};

function reelSystem(): string {
  return `${CHARTER}

You are cutting a vertical news explainer reel from a FINISHED Caveat story. The story is already
researched, sourced and published, so you are not investigating anything and you must not introduce
figures the story does not already carry.

The reel has one job: explain the finding in a news presentation, and let charts built from the
story's own evidence do the validating.

Structure follows the layered reveal from EDITORIAL:
1. cold_open — the hook, in the reader's own framing, in one line.
2. frame — the familiar frame, what the audience thinks they know.
3. layer — each layer shifts the picture. The sequence IS the story. At least two of these, and
   each one should be carried by a chart.
4. turn — the corrected frame, stated plainly.
5. one_number — the single number that holds the story, alone on screen.
6. caveat — the objection a hostile viewer would raise first, in the story's own words. Never skip
   this and never soften it. It is the reason the audience trusts the rest.
7. sources — the receipt card naming the publishers and periods.

Rules that are checked mechanically after you answer, so breaking them wastes the run:
- Use ONLY figures that already appear in the story's chart series, evidence table, headline number
  or prose. Do not compute new ratios, growth rates, totals or per-capita figures. Restating a
  number in a different unit is fine; inventing one is not.
- Every chart frame needs a caption naming the publisher and the period.
- Narration is a spoken read at about ${WORDS_PER_SECOND} words per second. A scene of N seconds
  carries about N x ${WORDS_PER_SECOND} words. Do not exceed it.
- Scenes run ${SCENE_SECONDS.min}-${SCENE_SECONDS.max}s. The whole reel runs ${REEL_SECONDS.min}-${REEL_SECONDS.max}s.
- on_screen is burned in: at most ${ON_SCREEN_CHARS} characters. lower_third at most ${LOWER_THIRD_CHARS}.
- Australian English. No em dashes or en dashes anywhere. No hype adjectives.
- Headlines and on-screen text state the finding, not the topic.`;
}

function reelUserPrompt(story: Story): string {
  const chartBlocks = (story.body?.blocks ?? []).filter((b) => b.type === 'chart');

  return `<story>
${JSON.stringify({
    kicker: story.kicker,
    title: story.title,
    hook: story.hook,
    caveat: story.caveat,
    one_number: story.oneNumber,
    published: story.published,
    frame_check: story.frameCheck,
  }, null, 2)}
</story>

<story_prose>
${JSON.stringify(story.body?.blocks?.filter((b) => b.type !== 'chart') ?? [], null, 2)}
</story_prose>

<story_charts>
These are the charts the story already publishes, with their real series. Reuse these series.
You may split one chart across several scenes to stage the reveal, and you may drop points to
simplify a frame, but do not change a value.
${JSON.stringify(chartBlocks, null, 2)}
</story_charts>

<story_evidence>
${JSON.stringify(story.evidence, null, 2)}
</story_evidence>

Cut this story into a reel. Return JSON only, matching this schema exactly:

{
  "scenes": [
    {
      "kind": "cold_open|frame|layer|turn|one_number|caveat|sources",
      "seconds": 5,
      "narration": "what the presenter says, within the word budget for seconds",
      "on_screen": "burned-in text, <= ${ON_SCREEN_CHARS} chars",
      "lower_third": "optional strap, <= ${LOWER_THIRD_CHARS} chars",
      "visual_prompt": "what the generator should render: framing, what the presenter does, how the chart enters",
      "chart": {
        "kind": "bars|rank_swap|timeline",
        "title": "optional",
        "caption": "publisher and period, e.g. ABS, June quarter 2025",
        "reveal": "all_at_once|sequential|swap",
        "series": [{ "label": "Australia", "value": 8.8, "highlight": true }],
        "alt_series": [{ "label": "Australia", "value": 14, "highlight": true }],
        "primary_label": "Absolute",
        "alt_label": "Per person"
      }
    }
  ],
  "generation_note": "one line on what the reel does"
}

Notes:
- Omit "chart" on scenes that are pure presenter, such as cold_open, caveat, and usually turn.
- Use reveal "sequential" when the chart builds point by point under the narration, "swap" for a
  rank_swap flipping between bases, "all_at_once" when the frame is already on screen.
- The one_number scene should hold "${story.oneNumber?.value ?? ''}" alone, with its label.
- The caveat scene must carry the story's caveat, not a softer version of it.
- The sources scene must name the publishers from story_evidence.sources.`;
}

type ModelReel = {
  scenes: Array<Omit<ReelScene, 'id'>>;
  generation_note?: string;
};

async function structureReel(story: Story): Promise<ModelReel> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 6000,
      system: reelSystem(),
      messages: [{ role: 'user', content: reelUserPrompt(story) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const body = await res.json();
  const raw = (body.content ?? [])
    .filter((c: { type: string }) => c.type === 'text')
    .map((c: { text: string }) => c.text)
    .join('\n');

  const json = raw.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(json);
  } catch {
    throw new Error('Reel generator did not return valid JSON');
  }
}

/** Rounds seconds to whole frames' worth and keeps them inside the per-scene range. */
function normaliseScene(scene: Omit<ReelScene, 'id'>, i: number): ReelScene {
  const seconds = Math.round(Number(scene.seconds) || SCENE_SECONDS.min);
  return {
    ...scene,
    id: `s${i + 1}`,
    seconds,
    narration: String(scene.narration ?? '').trim(),
    on_screen: String(scene.on_screen ?? '').trim(),
    lower_third: scene.lower_third ? String(scene.lower_third).trim() : undefined,
    visual_prompt: String(scene.visual_prompt ?? '').trim(),
  };
}

export type ReelProgress = (message: string) => void;

/**
 * Generates a reel brief from a finished story and saves it as a draft.
 *
 * Deliberately does not run the research agent: the story has already been researched and sourced,
 * so this is one structuring call over material that is already on the record. That keeps a reel
 * cheap next to a story draft, and it keeps the reel's figures tied to the published evidence.
 */
export async function generateReelForStory(
  slug: string,
  onProgress: ReelProgress = () => {},
): Promise<ReelResult> {
  const supabase = createClient();

  onProgress('Loading story and evidence');
  const story = await loadStoryBySlug(slug, { allowDraft: true });
  if (!story) throw new Error(`No story found at /stories/${slug}`);
  if (!story.body?.blocks?.length) {
    throw new Error(
      'This story has no structured body to cut from. Reels need an agent-drafted story.',
    );
  }

  onProgress('Writing the reel from the findings');
  const model = await structureReel(story);
  if (!Array.isArray(model.scenes) || !model.scenes.length) {
    throw new Error('Reel generator returned no scenes');
  }

  onProgress('Tracing every figure back to the evidence');
  const normalised = model.scenes.map(normaliseScene);
  const { scenes, warnings } = validateReel(normalised, story);

  const totalSeconds = scenes.reduce((sum, s) => sum + s.seconds, 0);
  const spec: ReelSpec = {
    format: REEL_FORMAT,
    style: HOUSE_STYLE,
    scenes,
    total_seconds: totalSeconds,
    shot_list: buildShotList(scenes, HOUSE_STYLE, story),
  };

  const now = new Date().toISOString();
  const generationNote = String(model.generation_note ?? '').trim();

  const { error } = await supabase.from('story_reels').upsert({
    story_slug: slug,
    // A regenerated reel always returns to draft; ready is an editor decision.
    status: 'draft',
    spec,
    warnings,
    total_seconds: totalSeconds,
    generation_note: generationNote,
    updated_at: now,
  }, { onConflict: 'story_slug' });
  if (error) throw new Error(error.message);

  onProgress(
    warnings.length
      ? `Draft reel ready with ${warnings.length} thing${warnings.length === 1 ? '' : 's'} to check`
      : 'Draft reel ready, every figure traced',
  );

  return {
    slug,
    status: 'draft',
    totalSeconds,
    sceneCount: scenes.length,
    warnings,
    generationNote,
    reelUrl: `/stories/${slug}/reel`,
  };
}

/** Loads a saved reel. Drafts are editor-only, matching how draft stories are gated. */
export async function loadReel(
  slug: string,
  opts?: { allowDraft?: boolean },
): Promise<StoryReel | null> {
  const supabase = createClient();
  const { data } = await supabase.from('story_reels')
    .select('story_slug, status, spec, warnings, total_seconds, generation_note')
    .eq('story_slug', slug)
    .maybeSingle();
  if (!data) return null;
  if (data.status !== 'ready' && !opts?.allowDraft) return null;

  return {
    storySlug: data.story_slug,
    status: data.status,
    spec: data.spec as ReelSpec,
    warnings: (data.warnings ?? []) as string[],
    totalSeconds: Number(data.total_seconds ?? 0),
    generationNote: data.generation_note ?? '',
  };
}

/**
 * Marks a reel ready to hand to the video generator. Refuses while figures remain untraced, which
 * is the same gate the story pipeline puts between draft and live.
 */
export async function markReelReady(slug: string): Promise<{ slug: string; status: 'ready' }> {
  const supabase = createClient();
  const { data: reel } = await supabase.from('story_reels')
    .select('warnings, status')
    .eq('story_slug', slug)
    .maybeSingle();
  if (!reel) throw new Error('No reel brief found for this story, generate one first');

  const warnings = (reel.warnings ?? []) as string[];
  if (warnings.length) {
    throw new Error(
      `Resolve ${warnings.length} outstanding check${warnings.length === 1 ? '' : 's'} first, or regenerate the reel`,
    );
  }

  const { error } = await supabase.from('story_reels')
    .update({ status: 'ready', updated_at: new Date().toISOString() })
    .eq('story_slug', slug);
  if (error) throw new Error(error.message);
  return { slug, status: 'ready' };
}

/** Map slug → reel status for the Foundry and Studio boards. */
export async function loadReelStatusBySlug(): Promise<Record<string, string>> {
  const supabase = createClient();
  const { data } = await supabase.from('story_reels')
    .select('story_slug, status')
    .in('status', ['draft', 'ready']);
  return Object.fromEntries(
    (data ?? []).map((r: { story_slug: string; status: string }) => [r.story_slug, r.status]),
  );
}

/** Exposed so the preview page can show the same word budget the validator applied. */
export { wordBudget };
