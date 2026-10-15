import 'server-only';

import { createClient } from '@/lib/supabase-server';
import { loadReel } from '@/lib/generate-reel';
import { loadStoryBySlug } from '@/lib/stories-loader';
import type { ReelScene, ReelSpec } from '@/lib/reel-types';
import {
  createImageToVideo,
  createTextToImage,
  createTextToVideo,
  isMediaConfigured,
  isTerminalStatus,
  retrieveTask,
  MediaConfigError,
  ELEVEN_IMAGE_MODEL,
  ELEVEN_VIDEO_MODEL,
  type MediaTask,
  type MediaTaskStatus,
} from '@/lib/elevenlabs-client';
import { compactRunwayPrompt, drawnForScene, madeWithoutText } from '@/lib/runway-prompts';
import { recordCost, SKU } from '@/lib/story-costs';
import { clipDuration } from '@/lib/elevenlabs-client';
import {
  CUT_MODEL,
  REEL_SCENE_ID,
  type RenderChainTo,
  type RenderKind,
  type RenderStatus,
  type StoryReelRender,
} from '@/lib/reel-render-types';

export { isMediaConfigured };

/** Generation endpoint recorded on a render row (column names predate the switch from Runway). */
type MediaEndpoint = 'text_to_image' | 'image_to_video' | 'text_to_video';

const BUCKET = 'reel-renders';
const POLL_FLOOR_MS = 5000;

type RenderRow = {
  render_id: string;
  story_slug: string;
  scene_id: string;
  kind: RenderKind;
  status: RenderStatus;
  runway_task_id: string | null;
  runway_endpoint: string | null;
  model: string | null;
  prompt_text: string;
  chain_to: RenderChainTo | null;
  output_url: string | null;
  output_path: string | null;
  content_type: string | null;
  output_manifest: StoryReelRender['outputManifest'];
  error: string | null;
  last_polled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type StartRenderRequest = {
  scope: 'scene' | 'reel';
  sceneId?: string;
  kind?: RenderKind | 'auto';
};

function asRender(row: RenderRow): StoryReelRender {
  return {
    renderId: row.render_id,
    storySlug: row.story_slug,
    sceneId: row.scene_id,
    kind: row.kind,
    status: row.status,
    model: row.model,
    promptText: row.prompt_text,
    outputUrl: row.output_url,
    contentType: row.content_type,
    outputManifest: row.output_manifest,
    error: row.error,
    chainTo: row.chain_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTaskStatus(status: MediaTaskStatus): RenderStatus {
  if (status === 'SUCCEEDED') return 'succeeded';
  if (status === 'FAILED') return 'failed';
  if (status === 'RUNNING') return 'running';
  return 'queued';
}

function inFlight(status: RenderStatus): boolean {
  return status === 'queued' || status === 'running';
}

async function loadBoard(slug: string): Promise<{ spec: ReelSpec; scenes: ReelScene[]; title: string }> {
  const [reel, story] = await Promise.all([
    loadReel(slug, { allowDraft: true }),
    loadStoryBySlug(slug, { allowDraft: true }),
  ]);
  if (!story) throw new Error(`No story found at /stories/${slug}`);
  if (!reel) throw new Error('Write the script and storyboard first');
  if (reel.stage === 'script') {
    throw new Error('Draw the storyboard before generating video, so pictures and figures are locked');
  }
  return { spec: reel.spec, scenes: reel.spec.scenes ?? [], title: story.title };
}

/**
 * Newest row per scene and kind. The Remotion cut keeps its own key, so the whole-reel assembly
 * here never reads or overwrites it and the page can show both.
 */
function latestByKey(rows: RenderRow[]): Map<string, RenderRow> {
  const map = new Map<string, RenderRow>();
  for (const row of rows) {
    const key = `${row.scene_id}:${row.kind}${row.kind === 'reel' && row.model === CUT_MODEL ? ':cut' : ''}`;
    const prev = map.get(key);
    if (!prev || prev.created_at < row.created_at) map.set(key, row);
  }
  return map;
}

export async function listRenders(slug: string): Promise<StoryReelRender[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('story_reel_renders')
    .select('*')
    .eq('story_slug', slug)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return [...latestByKey((data ?? []) as RenderRow[]).values()].map(asRender);
}

const CHART_REFUSAL = 'Charts are drawn by the cut from the data, never by the picture generator.';

function videoKindFor(scene: ReelScene): RenderChainTo {
  return scene.chart ? 'chart_video' : 'clip';
}

function stillKindFor(scene: ReelScene): 'still' | 'chart' {
  return scene.chart ? 'chart' : 'still';
}

async function insertQueued(fields: {
  slug: string;
  sceneId: string;
  kind: RenderKind;
  promptText: string;
  chainTo?: RenderChainTo | null;
  model?: string | null;
  endpoint?: MediaEndpoint | null;
}): Promise<RenderRow> {
  const supabase = createClient();
  const { data, error } = await supabase.from('story_reel_renders').insert({
    story_slug: fields.slug,
    scene_id: fields.sceneId,
    kind: fields.kind,
    status: 'queued',
    prompt_text: fields.promptText,
    chain_to: fields.chainTo ?? null,
    model: fields.model ?? null,
    runway_endpoint: fields.endpoint ?? null,
    updated_at: new Date().toISOString(),
  }).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Could not record the generation job');
  return data as RenderRow;
}

async function updateRow(id: string, patch: Record<string, unknown>): Promise<RenderRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('story_reel_renders')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('render_id', id)
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Could not update the generation job');
  return data as RenderRow;
}

async function submitToGenerator(
  row: RenderRow,
  opts?: { promptImage?: string | null; duration?: number },
): Promise<RenderRow> {
  if (!isMediaConfigured()) {
    return updateRow(row.render_id, {
      status: 'failed',
      error: new MediaConfigError().message,
    });
  }

  const duration = opts?.duration ?? 5;
  const promptImage = opts?.promptImage;

  try {
    let task: MediaTask;
    if (row.kind === 'still' || row.kind === 'chart') {
      task = await createTextToImage({ promptText: row.prompt_text });
      await updateRow(row.render_id, {
        runway_endpoint: 'text_to_image',
        model: ELEVEN_IMAGE_MODEL,
      });
    } else if (promptImage) {
      task = await createImageToVideo({
        promptText: row.prompt_text,
        promptImage,
        duration,
      });
      await updateRow(row.render_id, {
        runway_endpoint: 'image_to_video',
        model: ELEVEN_VIDEO_MODEL,
      });
    } else {
      task = await createTextToVideo({
        promptText: row.prompt_text,
        duration,
      });
      await updateRow(row.render_id, {
        runway_endpoint: 'text_to_video',
        model: ELEVEN_VIDEO_MODEL,
      });
    }

    return updateRow(row.render_id, {
      runway_task_id: task.id,
      status: mapTaskStatus(task.status ?? 'PENDING'),
      error: null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return updateRow(row.render_id, { status: 'failed', error: message });
  }
}

function extensionFor(contentType: string, url: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('quicktime')) return 'mov';
  if (contentType.includes('mp4') || contentType.includes('video')) return 'mp4';
  const fromUrl = url.split('?')[0].split('.').pop()?.toLowerCase();
  if (fromUrl && /^[a-z0-9]{2,4}$/.test(fromUrl)) return fromUrl;
  return 'bin';
}

async function persistOutput(row: RenderRow, remoteUrl: string): Promise<RenderRow> {
  const res = await fetch(remoteUrl);
  if (!res.ok) {
    return updateRow(row.render_id, {
      status: 'failed',
      error: `ElevenLabs output could not be downloaded (${res.status}). The URL may have expired.`,
    });
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
  const ext = extensionFor(contentType, remoteUrl);
  const path = `${row.story_slug}/${row.scene_id}/${row.kind}/${row.render_id}.${ext}`;

  const supabase = createClient();
  const { error } = await supabase.storage.from(BUCKET).upload(path, buf, {
    contentType,
    upsert: true,
  });
  if (error) {
    return updateRow(row.render_id, {
      status: 'failed',
      error: `Could not persist ElevenLabs output to storage: ${error.message}`,
    });
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return updateRow(row.render_id, {
    status: 'succeeded',
    output_url: data.publicUrl,
    output_path: path,
    content_type: contentType,
    error: null,
  });
}

async function openRows(slug: string): Promise<RenderRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('story_reel_renders')
    .select('*')
    .eq('story_slug', slug)
    .in('status', ['queued', 'running']);
  if (error) throw new Error(error.message);
  return (data ?? []) as RenderRow[];
}

async function allRows(slug: string): Promise<RenderRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('story_reel_renders')
    .select('*')
    .eq('story_slug', slug)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as RenderRow[];
}

/**
 * The still a video job may animate from. A still made under the old prompt, with the model's
 * lettering drawn in, does not count: animating it carries the lettering into the clip, so the
 * scene is drawn again instead (the fourth real cut, 5 October 2026, found every regeneration had
 * animated the old stills and no scene had a clean picture). Model-drawn charts never count: the cut
 * draws every chart from the data.
 */
function latestStillUrl(rows: RenderRow[], scene: ReelScene | undefined): string | null {
  if (!scene) return null;
  const latest = latestByKey(rows);
  const still = latest.get(`${scene.id}:still`);
  // A still drawn for an earlier version of the scene (a rewrite reuses scene ids) is not this scene's picture.
  if (still?.status === 'succeeded' && still.output_url && madeWithoutText(still)
    && drawnForScene(still.prompt_text, scene)) return still.output_url;
  return null;
}

function hasOpen(latest: Map<string, RenderRow>, sceneId: string, kind: RenderKind): boolean {
  const row = latest.get(`${sceneId}:${kind}`);
  return Boolean(row && inFlight(row.status));
}

async function startStillJob(
  slug: string,
  scene: ReelScene,
  spec: ReelSpec,
  title: string,
  chainTo: RenderChainTo | null,
  latest: Map<string, RenderRow>,
): Promise<RenderRow | null> {
  const kind = stillKindFor(scene);
  if (hasOpen(latest, scene.id, kind)) return latest.get(`${scene.id}:${kind}`) ?? null;

  const promptText = compactRunwayPrompt({
    scene,
    storyTitle: title,
    style: spec.style,
    kind,
  });
  const row = await insertQueued({
    slug,
    sceneId: scene.id,
    kind,
    promptText,
    chainTo,
    model: ELEVEN_IMAGE_MODEL,
    endpoint: 'text_to_image',
  });
  return submitToGenerator(row, { duration: scene.seconds });
}

async function startVideoJob(
  slug: string,
  scene: ReelScene,
  spec: ReelSpec,
  title: string,
  kind: RenderChainTo,
  promptImage: string | null,
  latest: Map<string, RenderRow>,
): Promise<RenderRow | null> {
  if (hasOpen(latest, scene.id, kind)) return latest.get(`${scene.id}:${kind}`) ?? null;

  const promptText = compactRunwayPrompt({
    scene,
    storyTitle: title,
    style: spec.style,
    kind,
  });
  const row = await insertQueued({
    slug,
    sceneId: scene.id,
    kind,
    promptText,
    model: ELEVEN_VIDEO_MODEL,
    endpoint: promptImage ? 'image_to_video' : 'text_to_video',
  });
  return submitToGenerator(row, { promptImage, duration: scene.seconds });
}

async function ensureReelRow(slug: string, sceneCount: number): Promise<void> {
  const rows = await allRows(slug);
  const latest = latestByKey(rows);
  const existing = latest.get(`${REEL_SCENE_ID}:reel`);
  if (existing && inFlight(existing.status)) return;
  await insertQueued({
    slug,
    sceneId: REEL_SCENE_ID,
    kind: 'reel',
    promptText: `Picture clips for ${sceneCount} scenes in storyboard order. Charts are drawn by the cut; no figures generated.`,
  });
}

async function refreshReelAssembly(slug: string, scenes: ReelScene[]): Promise<void> {
  const rows = await allRows(slug);
  const latest = latestByKey(rows);
  const reel = latest.get(`${REEL_SCENE_ID}:reel`);
  if (!reel || reel.status === 'succeeded' || reel.status === 'failed') return;
  const pictures = scenes.filter((s) => !s.chart);

  const clips: Array<{ sceneId: string; kind: RenderKind; url: string }> = [];
  let waiting = false;
  let failed: string | null = null;

  for (const scene of pictures) {
    const video = latest.get(`${scene.id}:clip`);
    if (!video) {
      waiting = true;
      continue;
    }
    if (inFlight(video.status)) {
      waiting = true;
      continue;
    }
    if (video.status === 'failed') {
      failed = video.error || `Scene ${scene.id} failed to render`;
      break;
    }
    if (video.output_url) {
      clips.push({ sceneId: scene.id, kind: video.kind, url: video.output_url });
    } else {
      waiting = true;
    }
  }

  if (failed) {
    await updateRow(reel.render_id, { status: 'failed', error: failed });
    return;
  }
  if (waiting || clips.length !== pictures.length) return;

  await updateRow(reel.render_id, {
    status: 'succeeded',
    output_manifest: { clips },
    output_url: clips[0]?.url ?? null,
    content_type: 'application/json',
    error: null,
  });
}

/**
 * Start the picture for one scene (still or clip), or for every picture scene of a reel. Chart scenes
 * are never sent to the generator: the cut draws them from the locked series, and a model asked to
 * draw a chart invents its own numbers and styling (the spending-sentiment reel, 15 October 2026:
 * 175.1 for 175.7, a fake news logo, the voiceover printed on the chart).
 */
export async function startRenders(slug: string, req: StartRenderRequest): Promise<StoryReelRender[]> {
  if (!isMediaConfigured()) throw new MediaConfigError();

  const { spec, scenes, title } = await loadBoard(slug);
  if (!scenes.length) throw new Error('The storyboard has no scenes to render');

  const latest = latestByKey(await allRows(slug));

  const pictures = scenes.filter((s) => !s.chart);
  if (req.kind === 'chart' || req.kind === 'chart_video') throw new Error(CHART_REFUSAL);
  if (req.scope === 'scene' && scenes.find((s) => s.id === req.sceneId)?.chart) throw new Error(CHART_REFUSAL);

  const targets: ReelScene[] = req.scope === 'reel'
    ? pictures
    : pictures.filter((s) => s.id === req.sceneId);
  if (!targets.length) throw new Error('No matching picture scene to render');

  if (req.scope === 'reel') await ensureReelRow(slug, pictures.length);

  for (const scene of targets) {
    const requested = req.kind && req.kind !== 'auto' ? req.kind : 'auto';
    const image = latestStillUrl([...latest.values()], scene);

    const record = async (started: RenderRow | null) => {
      if (started) latest.set(`${started.scene_id}:${started.kind}`, started);
    };

    if (requested === 'still') {
      await record(await startStillJob(slug, scene, spec, title, null, latest));
      continue;
    }

    if (requested === 'clip') {
      const kind: RenderChainTo = 'clip';
      if (image) {
        await record(await startVideoJob(slug, scene, spec, title, kind, image, latest));
      } else {
        await record(await startStillJob(slug, scene, spec, title, kind, latest));
      }
      continue;
    }

    // A whole-reel run leaves a scene alone when it already has a finished clip drawn for it as it stands.
    const clip = latest.get(`${scene.id}:clip`);
    if (req.scope === 'reel' && clip?.status === 'succeeded' && clip.output_url && drawnForScene(clip.prompt_text, scene)) continue;

    if (image) {
      await record(await startVideoJob(slug, scene, spec, title, videoKindFor(scene), image, latest));
    } else {
      await record(await startStillJob(slug, scene, spec, title, videoKindFor(scene), latest));
    }
  }

  await refreshReelAssembly(slug, scenes);
  return listRenders(slug);
}

async function pollOne(row: RenderRow, board: { spec: ReelSpec; scenes: ReelScene[]; title: string }): Promise<void> {
  if (row.kind === 'reel') return;
  if (row.kind === 'chart' || row.kind === 'chart_video') {
    // Left over from before charts were taken off the generator: close it rather than finish it.
    await updateRow(row.render_id, { status: 'failed', error: CHART_REFUSAL });
    return;
  }
  if (!row.runway_task_id) {
    if (row.kind === 'clip') {
      const rows = await allRows(row.story_slug);
      const scene = board.scenes.find((s) => s.id === row.scene_id);
      const image = latestStillUrl(rows, scene);
      if (image) {
        await submitToGenerator(row, { promptImage: image, duration: scene?.seconds ?? 5 });
      } else if (!isMediaConfigured()) {
        await updateRow(row.render_id, { status: 'failed', error: new MediaConfigError().message });
      }
    } else if (row.status === 'queued') {
      const scene = board.scenes.find((s) => s.id === row.scene_id);
      await submitToGenerator(row, { duration: scene?.seconds ?? 5 });
    }
    return;
  }

  const last = row.last_polled_at ? Date.parse(row.last_polled_at) : 0;
  if (Date.now() - last < POLL_FLOOR_MS) return;

  await updateRow(row.render_id, { last_polled_at: new Date().toISOString() });

  let task: MediaTask;
  try {
    task = await retrieveTask(row.runway_task_id);
  } catch (e) {
    await updateRow(row.render_id, {
      status: 'failed',
      error: e instanceof Error ? e.message : String(e),
    });
    return;
  }

  const status = mapTaskStatus(task.status);
  if (!isTerminalStatus(task.status)) {
    await updateRow(row.render_id, { status });
    return;
  }

  if (status === 'failed') {
    await updateRow(row.render_id, {
      status: 'failed',
      error: task.failure || 'ElevenLabs marked this generation failed',
    });
    return;
  }

  const remote = task.output?.[0];
  if (!remote) {
    await updateRow(row.render_id, {
      status: 'failed',
      error: 'ElevenLabs succeeded but returned no output URL',
    });
    return;
  }

  const saved = await persistOutput(row, remote);
  if (saved.status === 'succeeded') {
    // Billed per picture or per second of clip; the price table carries the plan's credit rates.
    const scene = board.scenes.find((s) => s.id === row.scene_id);
    const video = row.kind === 'clip';
    await recordCost({
      slug: row.story_slug,
      stage: row.kind as 'still' | 'chart' | 'clip' | 'chart_video',
      provider: 'elevenlabs',
      model: row.model,
      sku: video ? SKU.elevenVideo(row.model ?? ELEVEN_VIDEO_MODEL) : SKU.elevenImage(row.model ?? ELEVEN_IMAGE_MODEL),
      quantity: video ? clipDuration(scene?.seconds ?? 5) : 1,
      unit: video ? 'second' : 'image',
      renderId: row.render_id,
      detail: { scene: row.scene_id, generation: row.runway_task_id, endpoint: row.runway_endpoint },
    });
  }
  if (saved.status === 'succeeded' && saved.chain_to) {
    const scene = board.scenes.find((s) => s.id === saved.scene_id);
    if (scene && saved.output_url) {
      const latest = latestByKey(await allRows(row.story_slug));
      await startVideoJob(
        row.story_slug,
        scene,
        board.spec,
        board.title,
        saved.chain_to,
        saved.output_url,
        latest,
      );
    }
  }
}

/**
 * Poll open ElevenLabs generations for this story (at most once per five seconds per job),
 * persist finished files, and chain still → clip / animated chart.
 */
export async function pollRenders(slug: string): Promise<StoryReelRender[]> {
  const board = await loadBoard(slug);
  const open = await openRows(slug);

  for (const row of open) {
    await pollOne(row, board);
  }

  await refreshReelAssembly(slug, board.scenes);
  return listRenders(slug);
}
