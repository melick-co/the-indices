import type { SupabaseClient } from '@supabase/supabase-js';
import { createTextToImage, isMediaConfigured, waitForTask } from '@/lib/elevenlabs-client';
import { STORY_ART_BUCKET, attachGeneratedArt } from '@/lib/story-art';
import { webImage } from '@/lib/media-encode';
import { recordCost, SKU } from '@/lib/story-costs';
import { ELEVEN_IMAGE_MODEL } from '@/lib/elevenlabs-client';

/**
 * Generate a landscape hero still for a story with ElevenLabs (Gemini 3 Pro
 * Image) and attach it. A picture-editor brief (heroBrief) turns the story into one literal scene first. The image is illustration, not evidence: no text,
 * numbers, charts, real people or logos, so it can never be read as a data
 * claim or a news photo. Output URLs expire within an hour, so the file is
 * copied into the story-art bucket, re-encoded for the web (~7 MB PNG to a
 * few hundred KB JPEG).
 */

type HeroStory = { title: string; hook: string; kicker: string; one_number?: { label?: string } | null };

/**
 * The art brief: one concrete, literal scene that tells part of the story at a glance, the way a WSJ or AFR picture
 * editor would brief an illustrator. A reader should get what the story is about from the picture alone, before the
 * headline: who is affected, where, doing what. Abstract metaphors (giant floating objects, surreal scale) are out.
 */
export async function heroBrief(story: HeroStory): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 400,
        system: [
          'You are the picture editor at an Australian broadsheet like the AFR or the Wall Street Journal. Brief an illustrator for the lead image of a data-journalism article.',
          'The picture must tell part of the story at a glance and hook a general reader as much as the headline does. Be literal: show the people affected, the place, and the moment that captures the story, so someone who reads nothing else still gets what it is about.',
          'Use recognisably Australian settings where they fit (suburban streets, brick and weatherboard houses, apartment towers, open homes, supermarket aisles, petrol stations, offices, building sites, airports, Parliament House or a city skyline).',
          'Ordinary, fictional people are welcome and usually best: natural poses, everyday clothes, a mix of ages and backgrounds. Never a real or recognisable person.',
          'One clear scene with one clear tension or action, readable as a small thumbnail. No abstract metaphors, surreal scale, floating objects or symbolic props standing in for the idea.',
          'Stay true to the story: show only what it reports. Do not imply events or conditions it does not describe (shortages, protests, job losses, crime, disaster).',
          'The picture must not carry any information: no text, no signs, boards, stickers, letters or documents with visible writing, no price tags or price boards, numbers, charts, screens with figures, currency symbols, logos or flags. Papers and screens, if shown, are seen edge-on or blank.',
          'Reply with the scene only: one or two plain sentences, under 60 words, describing what is in the picture.',
        ].join(' '),
        messages: [{ role: 'user', content: `Kicker: ${story.kicker}\nHeadline: ${story.title}\nStandfirst: ${story.hook}${story.one_number?.label ? `\nThe key figure is about: ${story.one_number.label}` : ''}` }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const body = await res.json() as { content?: { type: string; text?: string }[] };
    const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim();
    return text || null;
  } catch {
    return null;
  }
}

/** The image prompt: the brief's scene (or, without one, the story itself) in the house style, within the rules. */
export function heroPrompt(story: HeroStory, brief?: string | null) {
  // The rules come first and the subject is trimmed to fit, so the cap can never cut a rule off.
  const rules = [
    'Editorial illustration for an Australian broadsheet, in the tradition of the AFR and the Wall Street Journal.',
    'Style: textured print illustration with realistic proportions and recognisable people and places; muted newsprint palette with one deep navy accent (#1d2a48).',
    'Composition: wide 16:9; the scene fills the frame edge to edge, the main subject large; readable at thumbnail size.',
    'No text anywhere: no signs, boards or stickers, no writing, letters, numbers, prices, symbols or glyphs (no currency signs), charts, screens with figures, logos, flags, or real or recognisable people.',
  ];
  const subject = brief ? `Scene: ${brief}` : `Scene: a literal, everyday moment that shows ${story.kicker.toLowerCase()}: ${story.title}. ${story.hook}`;
  const room = 1000 - rules.join(' ').length - 4;
  return [rules[0], subject.slice(0, room), ...rules.slice(1)].join(' ');
}

export async function generateHeroImage(
  db: SupabaseClient,
  story: { slug: string } & HeroStory,
  log: (msg: string) => void = () => {},
  brief?: string | null,
): Promise<{ url: string; generationId: string; brief: string | null } | null> {
  if (!isMediaConfigured()) { log('ElevenLabs not configured; no hero image.'); return null; }

  const scene = brief === undefined ? await heroBrief(story) : brief;
  if (scene) log(`Art brief: ${scene}`);
  const prompt = heroPrompt(story, scene);
  const task = await waitForTask(await createTextToImage({ promptText: prompt, ratio: '16:9', resolution: '2K' }));
  const src = task.output?.[0];
  if (task.status !== 'SUCCEEDED' || !src) { log(`Hero image ${task.status}: ${task.failure ?? 'no output'}`); return null; }
  await recordCost({
    slug: story.slug, stage: 'hero_image', provider: 'elevenlabs', model: ELEVEN_IMAGE_MODEL,
    sku: SKU.elevenImage(ELEVEN_IMAGE_MODEL), quantity: 1, unit: 'image', detail: { generation: task.id, resolution: '2K' },
  }, log);

  const img = await fetch(src);
  if (!img.ok) { log(`Hero image download failed (${img.status}).`); return null; }
  const original = img.headers.get('content-type')?.split(';')[0] ?? task.contentType ?? 'image/png';
  const web = await webImage(Buffer.from(await img.arrayBuffer()), original);
  const path = `auto/${story.slug}-${Date.now()}.${web.ext}`;
  const { error: upErr } = await db.storage.from(STORY_ART_BUCKET)
    .upload(path, web.data, { contentType: web.contentType, upsert: false });
  if (upErr) { log(`Hero image upload failed: ${upErr.message}`); return null; }
  const url = db.storage.from(STORY_ART_BUCKET).getPublicUrl(path).data.publicUrl;

  const { data: row } = await db.from('stories').select('art').eq('slug', story.slug).maybeSingle();
  const alt = `Illustration: ${story.title}`;
  const art = attachGeneratedArt(row?.art, { kind: 'hero', url, alt, source: 'generated', generator: 'elevenlabs', prompt });
  const { error } = await db.from('stories').update({
    art, hero_image_url: url, hero_image_alt: alt, updated_at: new Date().toISOString(),
  }).eq('slug', story.slug);
  if (error) { log(`Hero image save failed: ${error.message}`); return null; }
  log(`Hero image attached (${Math.round(web.data.length / 1024)} KB ${web.contentType}): ${url}`);
  return { url, generationId: task.id.replace(/^image:/, ''), brief: scene };
}
