import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createVideo, isMediaConfigured, synthesizeSpeech, waitForTask, type ImageRef } from '@/lib/elevenlabs-client';
import { heroPrompt } from '@/lib/hero-image';
import { attachGeneratedArt } from '@/lib/story-art';

/**
 * The day's hero story gets an 8-second narrated clip: a Veo 3.1 Fast video
 * (16:9, started from the hero illustration when there is one) with an
 * ElevenLabs voiceover, muxed with ffmpeg and stored in the reel-renders bucket.
 *
 * The narration is never written fresh: it is the article's headline, or its
 * one number and label, both of which already passed the fact check and claim
 * audit. If neither fits in the clip, the video goes out without a voiceover.
 */

const run = promisify(execFile);
const CLIP_SECONDS = 8;
const BUCKET = 'reel-renders';

type HeroStory = {
  slug: string;
  title: string;
  hook: string;
  kicker: string;
  one_number?: { value: string; label: string } | null;
};

/** Candidate narration lines, shortest last; all are text the checks already passed. */
export function narrationCandidates(story: HeroStory): string[] {
  const clean = (t: string) => t.replace(/\s+/g, ' ').replace(/\s*—\s*/g, ', ').trim();
  const out = [clean(story.title)];
  if (story.one_number?.value && story.one_number.label) {
    out.push(clean(`${story.one_number.value}: ${story.one_number.label}.`));
  }
  return out.filter(Boolean);
}

async function durationOf(file: string): Promise<number> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(stdout.trim()) || 0;
}

export async function generateHeroVideo(
  db: SupabaseClient,
  story: HeroStory,
  opts: { heroGenerationId?: string | null; log?: (msg: string) => void } = {},
): Promise<{ url: string; narrated: boolean } | null> {
  const log = opts.log ?? (() => {});
  if (!isMediaConfigured()) { log('ElevenLabs not configured; no hero video.'); return null; }

  const dir = await mkdtemp(join(tmpdir(), 'hero-video-'));
  try {
    const startFrame: ImageRef | undefined = opts.heroGenerationId
      ? { type: 'generation', generation_id: opts.heroGenerationId }
      : undefined;
    const prompt = `${heroPrompt(story)} Motion: a slow, subtle camera push-in with gentle movement in the scene; calm and editorial.`.slice(0, 1000);
    const task = await waitForTask(await createVideo({
      promptText: prompt, duration: CLIP_SECONDS, ratio: '16:9', resolution: '1080p', startFrame, generateAudio: false,
    }), 10 * 60 * 1000);
    const src = task.output?.[0];
    if (task.status !== 'SUCCEEDED' || !src) { log(`Hero video ${task.status}: ${task.failure ?? 'no output'}`); return null; }
    const videoRes = await fetch(src);
    if (!videoRes.ok) { log(`Hero video download failed (${videoRes.status}).`); return null; }
    const videoFile = join(dir, 'video.mp4');
    await writeFile(videoFile, Buffer.from(await videoRes.arrayBuffer()));

    // Voiceover: the first checked line that fits inside the clip.
    let narration: string | null = null;
    let audioFile: string | null = null;
    for (const [i, line] of narrationCandidates(story).entries()) {
      try {
        const file = join(dir, `vo-${i}.mp3`);
        await writeFile(file, await synthesizeSpeech(line));
        const secs = await durationOf(file);
        if (secs > 0 && secs <= CLIP_SECONDS - 0.3) { narration = line; audioFile = file; break; }
        log(`  Voiceover "${line.slice(0, 60)}" runs ${secs.toFixed(1)}s; too long for the clip.`);
      } catch (e) {
        log(`  Voiceover failed: ${e instanceof Error ? e.message : e}`);
        break;
      }
    }

    let outFile = videoFile;
    if (audioFile) {
      outFile = join(dir, 'hero.mp4');
      await run('ffmpeg', ['-y', '-i', videoFile, '-i', audioFile, '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-af', 'apad', '-shortest', outFile]);
    } else {
      log('  No voiceover fits; publishing the clip without narration.');
    }

    const path = `hero/${story.slug}-${Date.now()}.mp4`;
    const { error: upErr } = await db.storage.from(BUCKET)
      .upload(path, await readFile(outFile), { contentType: 'video/mp4', upsert: false });
    if (upErr) { log(`Hero video upload failed: ${upErr.message}`); return null; }
    const url = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

    const { data: row } = await db.from('stories').select('art').eq('slug', story.slug).maybeSingle();
    const art = attachGeneratedArt(row?.art, {
      kind: 'clip', url, source: 'generated', generator: 'elevenlabs',
      alt: narration ? `Video summary: ${narration}` : `Video: ${story.title}`,
      prompt: narration ? `${prompt}\nVoiceover: ${narration}` : prompt,
    });
    const { error } = await db.from('stories').update({ art, updated_at: new Date().toISOString() }).eq('slug', story.slug);
    if (error) { log(`Hero video save failed: ${error.message}`); return null; }
    log(`Hero video attached${narration ? ' with voiceover' : ''}: ${url}`);
    return { url, narrated: Boolean(narration) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
