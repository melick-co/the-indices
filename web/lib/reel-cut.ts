import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderMedia, selectComposition } from '@remotion/renderer';
import { createClient } from '@/lib/supabase-server';
import { loadReel } from '@/lib/generate-reel';
import { loadStoryBySlug } from '@/lib/stories-loader';
import { validateReel, type ReelScene } from '@/lib/reel-types';
import { isMediaConfigured, narrationVoiceId, synthesizeSpeech } from '@/lib/elevenlabs-client';
import { hasFfmpeg, mediaDuration } from '@/lib/media-encode';
import { queueCut, updateCut } from '@/lib/reel-cut-ledger';
import {
  CUT_COMPOSITION_ID,
  cutSources,
  describeCut,
  planScene,
  totalSeconds,
  type CutMedia,
  type CutProps,
  type CutVoice,
} from '@/lib/reel-cut-types';
import { FONT_FILES } from '@/remotion/fonts';

/**
 * Cut a story's reel. Remotion renders the locked storyboard (lib/reel-cut-types.ts, remotion/),
 * ElevenLabs reads each scene, and the MP4 goes into the reel-renders bucket with a row on
 * story_reel_renders. Runs on the GitHub runner (agent.yml, task reel-cut), not on Vercel: a render
 * needs Chrome and minutes, not a serverless function.
 *
 * Pictures: a scene with no chart takes the newest ElevenLabs clip or still for that scene as its
 * backdrop, if one has been generated. Chart scenes ignore model-drawn charts entirely.
 */

export type CutLog = (message: string) => void;

const BUCKET = 'reel-renders';
const WEB_ROOT = resolve(__dirname, '..');

async function copyFonts(publicDir: string): Promise<void> {
  const dir = join(publicDir, 'fonts');
  await mkdir(dir, { recursive: true });
  for (const file of FONT_FILES) {
    await copyFile(join(WEB_ROOT, 'app', 'fonts', file), join(dir, file));
  }
}

/** Bundle, pick the composition, render to `outFile`. `publicDir` holds the fonts and the voice files. */
export async function renderCut(
  props: CutProps,
  opts: { publicDir: string; outFile: string; log?: CutLog },
): Promise<void> {
  const log = opts.log ?? (() => {});
  await copyFonts(opts.publicDir);
  const browserExecutable = process.env.REMOTION_BROWSER?.trim() || undefined;
  if (!browserExecutable) {
    log('Checking for Chrome Headless Shell (downloaded once if missing)…');
    await ensureBrowser();
  }

  log('Bundling the composition…');
  const serveUrl = await bundle({
    entryPoint: join(WEB_ROOT, 'remotion', 'index.ts'),
    publicDir: opts.publicDir,
    // The composition imports lib/ through the app's `@/` alias.
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...config.resolve,
        alias: { ...((config.resolve?.alias as Record<string, string> | undefined) ?? {}), '@': WEB_ROOT },
      },
    }),
  });

  const composition = await selectComposition({ serveUrl, id: CUT_COMPOSITION_ID, inputProps: props, browserExecutable });
  log(`Rendering ${composition.durationInFrames} frames at ${composition.fps}fps…`);
  let lastTenth = -1;
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    crf: 20,
    outputLocation: opts.outFile,
    inputProps: props,
    browserExecutable,
    timeoutInMilliseconds: 120_000,
    onProgress: ({ progress }) => {
      const tenth = Math.floor(progress * 10);
      if (tenth !== lastTenth) {
        lastTenth = tenth;
        log(`  ${tenth * 10}%`);
      }
    },
  });
}

type MediaRow = { scene_id: string; kind: string; output_url: string | null; content_type: string | null; created_at: string };

/** Newest succeeded ElevenLabs clip, else still, per scene. Chart renders are not pictures and are skipped. */
async function latestMedia(slug: string, canProbe: boolean, log: CutLog): Promise<Map<string, CutMedia>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('story_reel_renders')
    .select('scene_id, kind, output_url, content_type, created_at')
    .eq('story_slug', slug)
    .eq('status', 'succeeded')
    .in('kind', ['clip', 'still'])
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const out = new Map<string, CutMedia>();
  const seenStill = new Set<string>();
  for (const row of (data ?? []) as MediaRow[]) {
    if (!row.output_url) continue;
    if (row.kind === 'clip') {
      if (out.get(row.scene_id)?.kind === 'video') continue;
      const media: CutMedia = { kind: 'video', url: row.output_url };
      if (canProbe) {
        const secs = await mediaDuration(row.output_url);
        if (secs > 0) media.seconds = Math.round(secs * 100) / 100;
        else log(`  Could not read the length of the clip for ${row.scene_id}; it will not loop.`);
      }
      out.set(row.scene_id, media);
    } else if (!out.has(row.scene_id) && !seenStill.has(row.scene_id)) {
      seenStill.add(row.scene_id);
      out.set(row.scene_id, { kind: 'image', url: row.output_url });
    }
  }
  return out;
}

/** One ElevenLabs read per scene, written into the bundle's public folder and measured. */
async function voiceScenes(
  scenes: ReelScene[],
  publicDir: string,
  canMeasure: boolean,
  log: CutLog,
): Promise<Map<string, CutVoice>> {
  const out = new Map<string, CutVoice>();
  if (!isMediaConfigured()) {
    log('ElevenLabs is not configured; the cut will be silent.');
    return out;
  }
  const voice = await narrationVoiceId();
  await mkdir(join(publicDir, 'voice'), { recursive: true });
  for (const scene of scenes) {
    const text = scene.narration.trim();
    if (!text) continue;
    try {
      const file = `voice/${scene.id}.mp3`;
      const full = join(publicDir, file);
      await writeFile(full, await synthesizeSpeech(text, voice));
      const seconds = canMeasure ? await mediaDuration(full) : 0;
      if (canMeasure && seconds <= 0) throw new Error('could not read the length of the read');
      out.set(scene.id, { file, seconds: Math.round(seconds * 100) / 100 });
      log(`  ${scene.id}: ${seconds ? `${seconds.toFixed(1)}s read` : 'read synthesised'} for a ${scene.seconds}s scene`);
    } catch (e) {
      log(`  ${scene.id}: voice failed (${e instanceof Error ? e.message : e}); scene stays silent.`);
    }
  }
  return out;
}

/**
 * Cut one story's reel and record it. Refuses a reel still at the script stage (no pictures are
 * locked) and a storyboard whose charts carry figures the story never stated.
 */
export async function cutReel(slug: string, opts: { log?: CutLog } = {}): Promise<{ url: string; seconds: number }> {
  const log = opts.log ?? (() => {});
  const [story, reel] = await Promise.all([
    loadStoryBySlug(slug, { allowDraft: true }),
    loadReel(slug, { allowDraft: true }),
  ]);
  if (!story) throw new Error(`No story ${slug}`);
  if (!reel) throw new Error('Write the script and storyboard first');
  if (reel.stage === 'script') throw new Error('Draw the storyboard before cutting, so pictures and figures are locked');

  const { scenes, warnings } = validateReel(reel.spec.scenes ?? [], story, { stage: reel.stage });
  if (!scenes.length) throw new Error('The storyboard has no scenes');
  const untraced = scenes.filter((s) => s.chart?.unverified);
  if (untraced.length) {
    throw new Error(`Refusing to cut: ${untraced.map((s) => s.id).join(', ')} carry chart figures not traceable to the story`);
  }
  for (const w of warnings) log(`  Storyboard warning: ${w}`);

  const row = await queueCut(slug, 'Cut starting');
  await updateCut(row.render_id, { status: 'running', error: null });
  log(`Cut ${row.render_id} for ${story.title}`);

  const publicDir = await mkdtemp(join(tmpdir(), 'reel-cut-public-'));
  const workDir = await mkdtemp(join(tmpdir(), 'reel-cut-'));
  try {
    const ffmpeg = await hasFfmpeg();
    if (!ffmpeg) log('ffmpeg unavailable: scene lengths stay as the storyboard set them, clips will not loop.');

    log('Pictures from the ledger…');
    const media = await latestMedia(slug, ffmpeg, log);
    log(`  ${media.size} scene${media.size === 1 ? '' : 's'} with a generated picture`);

    log('Voice…');
    const voices = await voiceScenes(scenes, publicDir, ffmpeg, log);

    const props: CutProps = {
      story: { slug: story.slug, title: story.title, kicker: story.kicker, caveat: story.caveat, published: story.published },
      oneNumber: story.oneNumber?.value ? { value: story.oneNumber.value, label: story.oneNumber.label } : null,
      sources: cutSources(story.evidence?.sources ?? []),
      scenes: scenes.map((scene) => planScene(scene, {
        media: scene.chart ? null : media.get(scene.id) ?? null,
        voice: voices.get(scene.id) ?? null,
      })),
    };
    for (const s of props.scenes) {
      if (s.seconds !== s.storyboardSeconds) log(`  ${s.id}: ${s.storyboardSeconds}s on the board, ${s.seconds}s to fit the read`);
    }
    const account = describeCut(props);
    await updateCut(row.render_id, { prompt_text: account });

    const outFile = join(workDir, 'cut.mp4');
    await renderCut(props, { publicDir, outFile, log });

    const seconds = ffmpeg ? await mediaDuration(outFile) : totalSeconds(props);
    const bytes = await readFile(outFile);
    const path = `${slug}/_reel/reel/${row.render_id}.mp4`;
    const supabase = createClient();
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: 'video/mp4', upsert: true });
    if (upErr) throw new Error(`Could not store the cut: ${upErr.message}`);
    const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

    await updateCut(row.render_id, {
      status: 'succeeded',
      output_url: url,
      output_path: path,
      content_type: 'video/mp4',
      output_manifest: null,
      error: null,
    });
    log(`Cut stored (${(bytes.length / 1048576).toFixed(1)} MB, ${seconds.toFixed(1)}s): ${url}`);
    return { url, seconds };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await updateCut(row.render_id, { status: 'failed', error: message }).catch(() => undefined);
    throw e;
  } finally {
    await rm(publicDir, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  }
}
