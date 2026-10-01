import type { SupabaseClient } from '@supabase/supabase-js';
import { createTextToImage, isRunwayConfigured, isTerminalStatus, retrieveTask } from '@/lib/runway-client';
import { STORY_ART_BUCKET, attachGeneratedArt } from '@/lib/story-art';

/**
 * Generate a landscape hero still for a story with Runway and attach it.
 * The image is illustration, not evidence: no text, numbers, charts, real
 * people or logos, so it can never be read as a data claim or a news photo.
 * Runway output URLs expire, so the file is copied into the story-art bucket.
 */

const HERO_RATIO = '1920:1080';
const POLL_MS = 5000;
const TIMEOUT_MS = 4 * 60 * 1000;

export function heroPrompt(story: { title: string; hook: string; kicker: string }) {
  return [
    'Editorial illustration for a data-journalism article in a broadsheet newspaper.',
    `Subject: ${story.kicker}. ${story.title}. ${story.hook}`.slice(0, 600),
    'Style: restrained, textured print illustration, muted newsprint palette with one ink-red accent, strong single focal point, generous negative space.',
    'Do not include any text, letters, numbers, charts, graphs, logos, flags, real people or recognisable public figures.',
  ].join(' ').slice(0, 1000);
}

export async function generateHeroImage(
  db: SupabaseClient,
  story: { slug: string; title: string; hook: string; kicker: string },
  log: (msg: string) => void = () => {},
): Promise<{ url: string } | null> {
  if (!isRunwayConfigured()) { log('Runway not configured; no hero image.'); return null; }

  const prompt = heroPrompt(story);
  let task = await createTextToImage({ promptText: prompt, ratio: HERO_RATIO });
  const started = Date.now();
  while (!isTerminalStatus(task.status)) {
    if (Date.now() - started > TIMEOUT_MS) { log('Hero image timed out.'); return null; }
    await new Promise((r) => setTimeout(r, POLL_MS));
    task = await retrieveTask(task.id);
  }
  const src = task.output?.[0];
  if (task.status !== 'SUCCEEDED' || !src) { log(`Hero image ${task.status}: ${task.failure ?? 'no output'}`); return null; }

  const img = await fetch(src);
  if (!img.ok) { log(`Hero image download failed (${img.status}).`); return null; }
  const contentType = img.headers.get('content-type') ?? 'image/png';
  const ext = contentType.includes('jpeg') ? 'jpg' : contentType.includes('webp') ? 'webp' : 'png';
  const path = `auto/${story.slug}-${Date.now()}.${ext}`;
  const { error: upErr } = await db.storage.from(STORY_ART_BUCKET)
    .upload(path, Buffer.from(await img.arrayBuffer()), { contentType, upsert: false });
  if (upErr) { log(`Hero image upload failed: ${upErr.message}`); return null; }
  const url = db.storage.from(STORY_ART_BUCKET).getPublicUrl(path).data.publicUrl;

  const { data: row } = await db.from('stories').select('art').eq('slug', story.slug).maybeSingle();
  const alt = `Illustration: ${story.title}`;
  const art = attachGeneratedArt(row?.art, { kind: 'hero', url, alt, source: 'generated', generator: 'runway', prompt });
  const { error } = await db.from('stories').update({
    art, hero_image_url: url, hero_image_alt: alt, updated_at: new Date().toISOString(),
  }).eq('slug', story.slug);
  if (error) { log(`Hero image save failed: ${error.message}`); return null; }
  log(`Hero image attached: ${url}`);
  return { url };
}
