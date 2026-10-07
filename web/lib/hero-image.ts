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
/** Props that carry writing: a brief with one is asked again (the image model would try to letter it). */
const SIGNAGE = /\b(signs?|signage|board|billboard|sticker|banner|placard|label|headline|newspaper|poster|price tag|menu|screen showing|caption|speech bubble|thought bubble)\b/i;

export async function heroBrief(story: HeroStory): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  try {
    const ask = async (extra: string) => {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6', max_tokens: 400,
          system: [
            'You are the picture editor at an Australian broadsheet like the AFR or the Wall Street Journal, briefing an illustrator for the lead image of a data-journalism article.',
          'The picture must tell part of the story at a glance and hook a general reader as much as the headline does: start from a literal scene (the people affected, the place, the moment), so someone who reads nothing else still gets what it is about.',
          'Then add wit: one visual twist that lands the irony or absurdity at the heart of the story, the way a good editorial cartoon does, so the reader smiles, gets the point and wants to share it. The twist exaggerates the real situation; it never invents a fact or overstates the numbers.',
          'Satire aims at situations, policies and institutions, never at ordinary people or at any group: the people in the picture are the ones it happens to, shown with sympathy and dignity, never as lazy, greedy, foolish or to blame.',
          'Use recognisably Australian settings specific to the story (single-storey brick-veneer and weatherboard houses on wide suburban streets, apartment towers, open inspections, supermarket checkouts, petrol stations, building sites, offices, Parliament House or a city skyline), never English terraces or American streets.',
          'Ordinary, fictional people in natural poses and everyday clothes. Any group must be visibly mixed, the way a Sydney or Melbourne suburb looks today: Anglo, East and South-East Asian, South Asian, Middle Eastern, African, Pacific Islander and Aboriginal and Torres Strait Islander Australians, of different ages. Say so in the scene; never a uniformly white cast. Never a real or recognisable person, and no caricatures of politicians or public figures.',
          'One clear scene, readable as a small thumbnail. The twist should be visual and physical (a slice of pizza so thin you can see through it, a queue for an open inspection running round the block), not a symbol to decode.',
          'Avoid the stock scene of people at a kitchen table with papers unless nothing else fits.',
          'Stay true to the story: do not imply events or conditions it does not describe (shortages, protests, job losses, crime, disaster).',
          'The picture must not carry any information or words: no captions, speech bubbles, signs, boards, stickers, labels, documents with visible writing, price tags, numbers, charts, screens with figures, currency symbols, logos or flags. Papers and screens, if shown, are seen edge-on or blank.',
          'Reply with the scene only: two or three plain sentences, under 70 words, describing what is in the picture, twist included.',
          ].join(' '),
          messages: [{ role: 'user', content: `Kicker: ${story.kicker}\nHeadline: ${story.title}\nStandfirst: ${story.hook}${story.one_number?.label ? `\nThe key figure is about: ${story.one_number.label}` : ''}${extra}` }],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) return null;
      const body = await res.json() as { content?: { type: string; text?: string }[] };
      const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim();
      return text || null;
    };
    const first = await ask('');
    const writing = first?.match(SIGNAGE);
    if (!writing) return first;
    // Signs and boards carry writing, which the picture must not have: ask once more without them.
    const second = await ask(`\n\nYour last scene included "${writing[0]}", which would carry writing. Describe a scene with no signs, boards, stickers, labels or anything with writing on it.`);
    return second && !SIGNAGE.test(second) ? second : null;
  } catch {
    return null;
  }
}

/** The image prompt: the brief's scene (or, without one, the story itself) in the house style, within the rules. */
export function heroPrompt(story: HeroStory, brief?: string | null) {
  // The rules come first and the subject is trimmed to fit, so the cap can never cut a rule off.
  const rules = [
    'Witty editorial illustration for an Australian broadsheet (AFR, WSJ): a literal scene with one satirical visual twist.',
    'Textured print style, realistic proportions, muted newsprint palette, one navy accent (#1d2a48); wide 16:9, filling the frame.',
    'Any crowd visibly mixed, as in an Australian suburb today (Anglo, Asian, South Asian, Middle Eastern, African, Pacific, Aboriginal); never all white.',
    'No text, signs, captions, numbers, prices, symbols, charts, logos, flags, or real or recognisable people.',
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
