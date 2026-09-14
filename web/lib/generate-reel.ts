import { createClient } from '@/lib/supabase-server';
import { CHARTER, MODEL } from '@/lib/research-agent';
import { loadStoryBySlug } from '@/lib/stories-loader';
import type { Story } from '@/lib/story-types';
import {
  buildPromptPack,
  buildScriptList,
  buildShotList,
  isVideoStage,
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
  type VideoStage,
} from '@/lib/reel-types';

export type ReelResult = {
  slug: string;
  status: 'draft' | 'ready';
  stage: VideoStage;
  totalSeconds: number;
  sceneCount: number;
  warnings: string[];
  generationNote: string;
  reelUrl: string;
};

export type ReelBoardStatus = { status: string; stage: VideoStage };

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

function structureSystem(): string {
  return `${CHARTER}

You are cutting a vertical news explainer from a FINISHED Caveat story. The story is already
researched, sourced and published, so you are not investigating anything and you must not introduce
figures the story does not already carry.

The reel has one job: explain the finding in a news presentation, and let charts built from the
story's own evidence do the validating.

Structure follows the layered reveal from EDITORIAL:
1. cold_open — the hook, in the reader's own framing, in one line.
2. frame — the familiar frame, what the audience thinks they know.
3. layer — each layer shifts the picture. The sequence IS the story. At least two of these.
4. turn — the corrected frame, stated plainly.
5. one_number — the single number that holds the story, alone on screen.
6. caveat — the objection a hostile viewer would raise first, in the story's own words. Never skip
   this and never soften it. It is the reason the audience trusts the rest.
7. sources — the receipt card naming the publishers and periods.

Rules that are checked mechanically after you answer, so breaking them wastes the run:
- Use ONLY figures that already appear in the story's chart series, evidence table, headline number
  or prose. Do not compute new ratios, growth rates, totals or per-capita figures. Restating a
  number in a different unit is fine; inventing one is not.
- Do not add precision the story does not have. If it says 8.8, say 8.8 or 9, never 8.83.
- Narration is a spoken read at about ${WORDS_PER_SECOND} words per second, so a scene of N seconds
  carries roughly N x ${WORDS_PER_SECOND} words. Write to that, not past it.
- Scenes run ${SCENE_SECONDS.min}-${SCENE_SECONDS.max}s. The whole reel runs ${REEL_SECONDS.min}-${REEL_SECONDS.max}s.
- on_screen is burned in: at most ${ON_SCREEN_CHARS} characters. lower_third at most ${LOWER_THIRD_CHARS}.
- Australian English. No em dashes or en dashes anywhere. No hype adjectives.
- Headlines and on-screen text state the finding, not the topic.`;
}

function storyPayload(story: Story): string {
  const blocks = story.body?.blocks ?? [];
  const chartBlocks = blocks.filter((b) => b.type === 'chart');

  const chartSection = chartBlocks.length
    ? `<story_charts>
These are the charts the story already publishes, with their real series. Reuse these series.
You may split one chart across several scenes to stage the reveal, and you may drop points to
simplify a frame, but do not change a value.
${JSON.stringify(chartBlocks, null, 2)}
</story_charts>`
    : `<story_charts>
This story publishes no chart series of its own, so take values from the evidence table
below. Pick the columns that carry the finding, keep the rows that make the point, and highlight
Australia when it is present. Do not compute new figures from them.
</story_charts>`;

  const proseSection = blocks.length
    ? `<story_prose>
${JSON.stringify(blocks.filter((b) => b.type !== 'chart'), null, 2)}
</story_prose>`
    : `<story_prose>
This story's prose is not available in structured form. Work from the title, hook, caveat, headline
number and the evidence table, and do not invent detail beyond them.
</story_prose>`;

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

${proseSection}

${chartSection}

<story_evidence>
${JSON.stringify(story.evidence, null, 2)}
</story_evidence>`;
}

function scriptUserPrompt(story: Story): string {
  return `${storyPayload(story)}

Write the SCRIPT only. Do not describe pictures, camera moves, or charts. Those come in a later
pass that is not allowed to rewrite this read.

Return JSON only, matching this schema exactly:

{
  "scenes": [
    {
      "kind": "cold_open|frame|layer|turn|one_number|caveat|sources",
      "seconds": 5,
      "narration": "what the presenter says, within the word budget for seconds",
      "on_screen": "burned-in text, <= ${ON_SCREEN_CHARS} chars",
      "lower_third": "optional strap, <= ${LOWER_THIRD_CHARS} chars"
    }
  ],
  "generation_note": "one line on what the script does"
}

Notes:
- The one_number scene should hold "${story.oneNumber?.value ?? ''}" alone, with its label.
- The caveat scene must carry the story's caveat, not a softer version of it.
- The sources scene must name the publishers from story_evidence.sources.
- At least two layer scenes.`;
}

function storyboardUserPrompt(story: Story, script: ReelScene[]): string {
  const locked = script.map((s) => ({
    id: s.id,
    kind: s.kind,
    seconds: s.seconds,
    narration: s.narration,
    on_screen: s.on_screen,
    lower_third: s.lower_third ?? null,
  }));

  return `${storyPayload(story)}

<locked_script>
This script is locked. Do not change id, kind, seconds, narration, on_screen, or lower_third.
Return a visual_prompt (and a chart where a chart should carry the beat) for every scene, matched
by id.
${JSON.stringify(locked, null, 2)}
</locked_script>

Return JSON only, matching this schema exactly:

{
  "scenes": [
    {
      "id": "s1",
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
  ]
}

Notes:
- Omit "chart" on scenes that are pure presenter, such as cold_open, caveat, and usually turn.
- Use reveal "sequential" when the chart builds point by point under the narration, "swap" for a
  rank_swap flipping between bases, "all_at_once" when the frame is already on screen.
- Layer scenes should usually carry a chart built from the story's own series.
- Every chart frame needs a caption naming the publisher and the period.
- Include every locked scene id. Do not add scenes.`;
}

async function callAnthropic(system: string, user: string, maxTokens: number): Promise<string> {
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
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const body = await res.json();
  return (body.content ?? [])
    .filter((c: { type: string }) => c.type === 'text')
    .map((c: { text: string }) => c.text)
    .join('\n');
}

function parseModelJson<T>(raw: string, label: string): T {
  const json = raw.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(json) as T;
  } catch {
    throw new Error(`${label} did not return valid JSON`);
  }
}

/** Rounds seconds to whole frames' worth and keeps them inside the per-scene range. */
function normaliseScene(scene: Omit<ReelScene, 'id'> & { id?: string }, i: number): ReelScene {
  const seconds = Math.round(Number(scene.seconds) || SCENE_SECONDS.min);
  return {
    ...scene,
    id: scene.id || `s${i + 1}`,
    seconds,
    narration: String(scene.narration ?? '').trim(),
    on_screen: String(scene.on_screen ?? '').trim(),
    lower_third: scene.lower_third ? String(scene.lower_third).trim() : undefined,
    visual_prompt: String(scene.visual_prompt ?? '').trim(),
  };
}

function stripVisuals(scene: ReelScene): ReelScene {
  const { chart: _chart, ...rest } = scene;
  return { ...rest, visual_prompt: '' };
}

export type ReelProgress = (message: string) => void;

async function loadStoryForVideo(slug: string): Promise<Story> {
  const story = await loadStoryBySlug(slug, { allowDraft: true });
  if (!story) throw new Error(`No story found at /stories/${slug}`);

  const hasBlocks = Boolean(story.body?.blocks?.length);
  const hasTable = Boolean(story.evidence?.table?.rows?.length);
  if (!hasBlocks && !hasTable) {
    throw new Error(
      'This story has neither a structured body nor an evidence table, so there is nothing to chart.',
    );
  }
  return story;
}

async function saveReel(slug: string, fields: {
  spec: ReelSpec;
  warnings: string[];
  totalSeconds: number;
  generationNote: string;
  stage: VideoStage;
}): Promise<void> {
  const supabase = createClient();
  const now = new Date().toISOString();
  const { error } = await supabase.from('story_reels').upsert({
    story_slug: slug,
    status: 'draft',
    spec: fields.spec,
    warnings: fields.warnings,
    total_seconds: fields.totalSeconds,
    generation_note: fields.generationNote,
    video_stage: fields.stage,
    updated_at: now,
  }, { onConflict: 'story_slug' });
  if (error) throw new Error(error.message);
}

function toResult(
  slug: string,
  scenes: ReelScene[],
  warnings: string[],
  generationNote: string,
  stage: VideoStage,
): ReelResult {
  return {
    slug,
    status: 'draft',
    stage,
    totalSeconds: scenes.reduce((sum, s) => sum + s.seconds, 0),
    sceneCount: scenes.length,
    warnings,
    generationNote,
    reelUrl: `/stories/${slug}/reel`,
  };
}

async function generateScript(
  slug: string,
  onProgress: ReelProgress,
): Promise<ReelResult> {
  const story = await loadStoryForVideo(slug);

  onProgress('Writing the script from the findings');
  const raw = await callAnthropic(structureSystem(), scriptUserPrompt(story), 4000);
  const model = parseModelJson<{
    scenes: Array<Omit<ReelScene, 'id' | 'visual_prompt'>>;
    generation_note?: string;
  }>(raw, 'Script generator');

  if (!Array.isArray(model.scenes) || !model.scenes.length) {
    throw new Error('Script generator returned no scenes');
  }

  onProgress('Checking every spoken figure against the evidence');
  const normalised = model.scenes.map((scene, i) => normaliseScene({ ...scene, visual_prompt: '' }, i));
  const { scenes, warnings } = validateReel(normalised, story, { stage: 'script' });
  const totalSeconds = scenes.reduce((sum, s) => sum + s.seconds, 0);
  const generationNote = String(model.generation_note ?? '').trim();

  const spec: ReelSpec = {
    format: REEL_FORMAT,
    style: HOUSE_STYLE,
    scenes: scenes.map(stripVisuals),
    total_seconds: totalSeconds,
    shot_list: buildScriptList(scenes, story),
  };

  await saveReel(slug, { spec, warnings, totalSeconds, generationNote, stage: 'script' });
  onProgress(
    warnings.length
      ? `Script ready with ${warnings.length} thing${warnings.length === 1 ? '' : 's'} to check`
      : 'Script ready, every spoken figure traced',
  );
  return toResult(slug, scenes, warnings, generationNote, 'script');
}

type StoryboardModelScene = {
  id?: string;
  visual_prompt?: string;
  chart?: ReelScene['chart'] | null;
};

function mergeStoryboard(script: ReelScene[], visuals: StoryboardModelScene[]): ReelScene[] {
  const byId = new Map(
    visuals.filter((v) => v.id).map((v) => [v.id as string, v]),
  );

  return script.map((scene, i) => {
    const patch = byId.get(scene.id) ?? visuals[i];
    const chart = patch?.chart ?? undefined;
    return {
      ...scene,
      visual_prompt: String(patch?.visual_prompt ?? '').trim(),
      chart: chart || undefined,
    };
  });
}

async function generateStoryboard(
  slug: string,
  onProgress: ReelProgress,
): Promise<ReelResult> {
  const supabase = createClient();
  const story = await loadStoryForVideo(slug);

  const { data: row } = await supabase.from('story_reels')
    .select('spec, generation_note, video_stage')
    .eq('story_slug', slug)
    .maybeSingle();
  if (!row) throw new Error('Write the script first');

  const spec = row.spec as ReelSpec;
  const script = (spec.scenes ?? []).map(stripVisuals);
  if (!script.length) throw new Error('The saved script has no scenes. Rewrite the script first.');

  onProgress('Drawing the storyboard against the locked script');
  const raw = await callAnthropic(
    structureSystem(),
    storyboardUserPrompt(story, script),
    6000,
  );
  const model = parseModelJson<{ scenes: StoryboardModelScene[] }>(raw, 'Storyboard generator');
  if (!Array.isArray(model.scenes) || !model.scenes.length) {
    throw new Error('Storyboard generator returned no scenes');
  }

  onProgress('Tracing every chart figure back to the evidence');
  const merged = mergeStoryboard(script, model.scenes);
  const { scenes, warnings } = validateReel(merged, story, { stage: 'storyboard' });
  const totalSeconds = scenes.reduce((sum, s) => sum + s.seconds, 0);
  const generationNote = String(row.generation_note ?? '').trim();

  const next: ReelSpec = {
    format: REEL_FORMAT,
    style: HOUSE_STYLE,
    scenes,
    total_seconds: totalSeconds,
    shot_list: buildShotList(scenes, HOUSE_STYLE, story),
  };

  await saveReel(slug, {
    spec: next,
    warnings,
    totalSeconds,
    generationNote,
    stage: 'storyboard',
  });
  onProgress(
    warnings.length
      ? `Storyboard ready with ${warnings.length} thing${warnings.length === 1 ? '' : 's'} to check`
      : 'Storyboard ready, every figure traced',
  );
  return toResult(slug, scenes, warnings, generationNote, 'storyboard');
}

async function generatePromptPack(
  slug: string,
  onProgress: ReelProgress,
): Promise<ReelResult> {
  const supabase = createClient();
  const story = await loadStoryForVideo(slug);

  const { data: row } = await supabase.from('story_reels')
    .select('spec, generation_note, video_stage')
    .eq('story_slug', slug)
    .maybeSingle();
  if (!row) throw new Error('Write the script and storyboard first');

  const stage = isVideoStage(row.video_stage) ? row.video_stage : 'storyboard';
  if (stage === 'script') {
    throw new Error('Draw the storyboard before building the prompt pack');
  }

  onProgress('Building the prompt pack from the locked storyboard');
  const spec = row.spec as ReelSpec;
  const { scenes, warnings } = validateReel(spec.scenes ?? [], story, { stage: 'prompts' });
  const totalSeconds = scenes.reduce((sum, s) => sum + s.seconds, 0);
  const generationNote = String(row.generation_note ?? '').trim();
  const promptPack = buildPromptPack(scenes, spec.style ?? HOUSE_STYLE, story);

  const next: ReelSpec = {
    format: REEL_FORMAT,
    style: spec.style ?? HOUSE_STYLE,
    scenes,
    total_seconds: totalSeconds,
    shot_list: promptPack.master,
    prompt_pack: promptPack,
  };

  await saveReel(slug, {
    spec: next,
    warnings,
    totalSeconds,
    generationNote,
    stage: 'prompts',
  });
  onProgress(
    warnings.length
      ? `Prompt pack ready with ${warnings.length} thing${warnings.length === 1 ? '' : 's'} to check`
      : 'Prompt pack ready to hand to the generator',
  );
  return toResult(slug, scenes, warnings, generationNote, 'prompts');
}

/**
 * Runs one stage of the video pipeline. Script first, then storyboard, then the prompt pack.
 * Regenerating the script wipes later stages. The prompt pack is deterministic from the
 * storyboard, so it never asks the model for figures.
 */
export async function generateVideoStage(
  slug: string,
  stage: VideoStage,
  onProgress: ReelProgress = () => {},
): Promise<ReelResult> {
  onProgress('Loading story and evidence');
  if (stage === 'script') return generateScript(slug, onProgress);
  if (stage === 'storyboard') return generateStoryboard(slug, onProgress);
  if (stage === 'prompts') return generatePromptPack(slug, onProgress);
  throw new Error(`Unknown video stage: ${stage}`);
}

/** @deprecated Prefer generateVideoStage('script'). Kept so a body-less POST still starts the pipeline. */
export async function generateReelForStory(
  slug: string,
  onProgress: ReelProgress = () => {},
): Promise<ReelResult> {
  return generateVideoStage(slug, 'script', onProgress);
}

/** Loads a saved reel. Drafts are editor-only, matching how draft stories are gated. */
export async function loadReel(
  slug: string,
  opts?: { allowDraft?: boolean },
): Promise<StoryReel | null> {
  const supabase = createClient();
  const { data } = await supabase.from('story_reels')
    .select('story_slug, status, spec, warnings, total_seconds, generation_note, video_stage')
    .eq('story_slug', slug)
    .maybeSingle();
  if (!data) return null;
  if (data.status !== 'ready' && !opts?.allowDraft) return null;

  return {
    storySlug: data.story_slug,
    status: data.status,
    stage: isVideoStage(data.video_stage) ? data.video_stage : 'storyboard',
    spec: data.spec as ReelSpec,
    warnings: (data.warnings ?? []) as string[],
    totalSeconds: Number(data.total_seconds ?? 0),
    generationNote: data.generation_note ?? '',
  };
}

/**
 * Marks a reel ready to hand to the video generator. Refuses while figures remain untraced, and
 * while the prompt pack has not been built, which is the same gate the story pipeline puts
 * between draft and live.
 */
export async function markReelReady(slug: string): Promise<{ slug: string; status: 'ready' }> {
  const supabase = createClient();
  const { data: reel } = await supabase.from('story_reels')
    .select('warnings, status, video_stage')
    .eq('story_slug', slug)
    .maybeSingle();
  if (!reel) throw new Error('No video brief found for this story, generate one first');

  if (reel.video_stage !== 'prompts') {
    throw new Error('Build the prompt pack before marking ready');
  }

  const warnings = (reel.warnings ?? []) as string[];
  if (warnings.length) {
    throw new Error(
      `Resolve ${warnings.length} outstanding check${warnings.length === 1 ? '' : 's'} first, or regenerate`,
    );
  }

  const { error } = await supabase.from('story_reels')
    .update({ status: 'ready', updated_at: new Date().toISOString() })
    .eq('story_slug', slug);
  if (error) throw new Error(error.message);
  return { slug, status: 'ready' };
}

/** Map slug → reel status for the Foundry and Studio boards. */
export async function loadReelStatusBySlug(): Promise<Record<string, ReelBoardStatus>> {
  const supabase = createClient();
  const { data } = await supabase.from('story_reels')
    .select('story_slug, status, video_stage')
    .in('status', ['draft', 'ready']);
  return Object.fromEntries(
    (data ?? []).map((r: { story_slug: string; status: string; video_stage: string | null }) => [
      r.story_slug,
      {
        status: r.status,
        stage: isVideoStage(r.video_stage) ? r.video_stage : 'storyboard',
      },
    ]),
  );
}

/** Exposed so the preview page can show the same word budget the validator applied. */
export { wordBudget };
