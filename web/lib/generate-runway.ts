import 'server-only';

import { createClient } from '@/lib/supabase-server';
import { loadReel } from '@/lib/generate-reel';
import { loadStoryBySlug } from '@/lib/stories-loader';
import type { ReelScene, ReelSpec } from '@/lib/reel-types';
import {
  createImageToVideo,
  createTextToImage,
  createTextToVideo,
  isRunwayConfigured,
  isTerminalStatus,
  retrieveTask,
  RunwayConfigError,
  RUNWAY_IMAGE_MODEL,
  RUNWAY_VIDEO_MODEL,
  type RunwayEndpoint,
  type RunwayTask,
  type RunwayTaskStatus,
} from '@/lib/runway-client';
import { compactRunwayPrompt } from '@/lib/runway-prompts';
import {
  REEL_SCENE_ID,
  type RenderChainTo,
  type RenderKind,
  type RenderStatus,
  type StoryReelRender,
} from '@/lib/reel-render-types';

export { isRunwayConfigured };

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

function mapTaskStatus(status: RunwayTaskStatus): RenderStatus {
  if (status === 'SUCCEEDED') return 'succeeded';
  if (status === 'FAILED' || status === 'CANCELLED' || status === 'CANCELED') return 'failed';
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
    throw new Error('Draw the storyboard before generating with Runway, so pictures and figures are locked');
  }
  return { spec: reel.spec, scenes: reel.spec.scenes ?? [], title: story.title };
}

function latestByKey(rows: RenderRow[]): Map<string, RenderRow> {
  const map = new Map<string, RenderRow>();
  for (const row of rows) {
    const key = `${row.scene_id}:${row.kind}`;
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
  endpoint?: RunwayEndpoint | null;
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
  if (error || !data) throw new Error(error?.message ?? 'Could not record the Runway job');
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
  if (error || !data) throw new Error(error?.message ?? 'Could not update the Runway job');
  return data as RenderRow;
}

async function submitToRunway(
  row: RenderRow,
  opts?: { promptImage?: string | null; duration?: number },
): Promise<RenderRow> {
  if (!isRunwayConfigured()) {
    return updateRow(row.render_id, {
      status: 'failed',
      error: new RunwayConfigError().message,
    });
  }

  const duration = opts?.duration ?? 5;
  const promptImage = opts?.promptImage;

  try {
    let task: RunwayTask;
    if (row.kind === 'still' || row.kind === 'chart') {
      task = await createTextToImage({ promptText: row.prompt_text });
      await updateRow(row.render_id, {
        runway_endpoint: 'text_to_image',
        model: RUNWAY_IMAGE_MODEL,
      });
    } else if (promptImage) {
      task = await createImageToVideo({
        promptText: row.prompt_text,
        promptImage,
        duration,
      });
      await updateRow(row.render_id, {
        runway_endpoint: 'image_to_video',
        model: RUNWAY_VIDEO_MODEL,
      });
    } else {
      task = await createTextToVideo({
        promptText: row.prompt_text,
        duration,
      });
      await updateRow(row.render_id, {
        runway_endpoint: 'text_to_video',
        model: RUNWAY_VIDEO_MODEL,
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
      error: `Runway output could not be downloaded (${res.status}). The URL may have expired.`,
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
      error: `Could not persist Runway output to storage: ${error.message}`,
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

function latestStillUrl(rows: RenderRow[], sceneId: string): string | null {
  const latest = latestByKey(rows);
  const chart = latest.get(`${sceneId}:chart`);
  const still = latest.get(`${sceneId}:still`);
  if (chart?.status === 'succeeded' && chart.output_url) return chart.output_url;
  if (still?.status === 'succeeded' && still.output_url) return still.output_url;
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
    model: RUNWAY_IMAGE_MODEL,
    endpoint: 'text_to_image',
  });
  return submitToRunway(row, { duration: scene.seconds });
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
    model: RUNWAY_VIDEO_MODEL,
    endpoint: promptImage ? 'image_to_video' : 'text_to_video',
  });
  return submitToRunway(row, { promptImage, duration: scene.seconds });
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
    promptText: `Assemble ${sceneCount} locked scene clips in storyboard order. Figures stay as traced; no new Runway generation.`,
  });
}

async function refreshReelAssembly(slug: string, scenes: ReelScene[]): Promise<void> {
  const rows = await allRows(slug);
  const latest = latestByKey(rows);
  const reel = latest.get(`${REEL_SCENE_ID}:reel`);
  if (!reel || reel.status === 'succeeded' || reel.status === 'failed') return;

  const clips: Array<{ sceneId: string; kind: RenderKind; url: string }> = [];
  let waiting = false;
  let failed: string | null = null;

  for (const scene of scenes) {
    const preferred = videoKindFor(scene);
    const fallback: RenderKind = preferred === 'chart_video' ? 'clip' : 'chart_video';
    const video = latest.get(`${scene.id}:${preferred}`) ?? latest.get(`${scene.id}:${fallback}`);
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
  if (waiting || clips.length !== scenes.length) return;

  await updateRow(reel.render_id, {
    status: 'succeeded',
    output_manifest: { clips },
    output_url: clips[0]?.url ?? null,
    content_type: 'application/json',
    error: null,
  });
}

/**
 * Start one scene (still, chart, clip, animated chart) or every scene for a reel.
 * Video jobs prefer image-to-video from a locked still so chart figures stay put.
 */
export async function startRenders(slug: string, req: StartRenderRequest): Promise<StoryReelRender[]> {
  if (!isRunwayConfigured()) throw new RunwayConfigError();

  const { spec, scenes, title } = await loadBoard(slug);
  if (!scenes.length) throw new Error('The storyboard has no scenes to render');

  const latest = latestByKey(await allRows(slug));

  const targets: ReelScene[] = req.scope === 'reel'
    ? scenes
    : scenes.filter((s) => s.id === req.sceneId);
  if (!targets.length) throw new Error('No matching scene to render');

  if (req.scope === 'reel') await ensureReelRow(slug, scenes.length);

  for (const scene of targets) {
    const requested = req.kind && req.kind !== 'auto' ? req.kind : 'auto';
    const image = latestStillUrl([...latest.values()], scene.id);

    const record = async (started: RenderRow | null) => {
      if (started) latest.set(`${started.scene_id}:${started.kind}`, started);
    };

    if (requested === 'still' || requested === 'chart') {
      await record(await startStillJob(slug, scene, spec, title, null, latest));
      continue;
    }

    if (requested === 'clip' || requested === 'chart_video') {
      const kind: RenderChainTo = requested === 'chart_video' || scene.chart ? 'chart_video' : 'clip';
      if (image) {
        await record(await startVideoJob(slug, scene, spec, title, kind, image, latest));
      } else {
        await record(await startStillJob(slug, scene, spec, title, kind, latest));
      }
      continue;
    }

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
  if (!row.runway_task_id) {
    if (row.kind === 'clip' || row.kind === 'chart_video') {
      const rows = await allRows(row.story_slug);
      const image = latestStillUrl(rows, row.scene_id);
      const scene = board.scenes.find((s) => s.id === row.scene_id);
      if (image) {
        await submitToRunway(row, { promptImage: image, duration: scene?.seconds ?? 5 });
      } else if (!isRunwayConfigured()) {
        await updateRow(row.render_id, { status: 'failed', error: new RunwayConfigError().message });
      }
    } else if (row.status === 'queued') {
      const scene = board.scenes.find((s) => s.id === row.scene_id);
      await submitToRunway(row, { duration: scene?.seconds ?? 5 });
    }
    return;
  }

  const last = row.last_polled_at ? Date.parse(row.last_polled_at) : 0;
  if (Date.now() - last < POLL_FLOOR_MS) return;

  await updateRow(row.render_id, { last_polled_at: new Date().toISOString() });

  let task: RunwayTask;
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
      error: task.failure || task.failureCode || 'Runway marked this task failed',
    });
    return;
  }

  const remote = task.output?.[0];
  if (!remote) {
    await updateRow(row.render_id, {
      status: 'failed',
      error: 'Runway succeeded but returned no output URL',
    });
    return;
  }

  const saved = await persistOutput(row, remote);
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
 * Poll open Runway tasks for this story (at most once per five seconds per job),
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
