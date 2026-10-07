/**
 * Generate (or regenerate) hero art for one story: the illustration, and with
 * --video the narrated 8-second clip.
 *
 *   npx tsx --import ./scripts/node-shims.mjs scripts/hero-media.ts --slug=<slug> [--video]
 *   npx tsx --import ./scripts/node-shims.mjs scripts/hero-media.ts --brief [--slug=<slug> ...]   # art briefs only, no images
 *   (or HERO_SLUG=<slug>, space separated for --brief; --brief with no slug briefs the published stories on the front page)
 *   HERO_BRIEF="<scene>" ... --slug=<slug>    # draw this scene instead of the model's brief (the editor chooses the picture)
 */
import { createClient } from '@/lib/supabase-server';
import { generateHeroImage, heroBrief, heroPrompt } from '@/lib/hero-image';
import { generateHeroVideo } from '@/lib/hero-video';

const slugs = [...process.argv.filter((a) => a.startsWith('--slug=')).map((a) => a.slice(7)), ...(process.env.HERO_SLUG ?? '').split(/\s+/)].filter(Boolean);
const slug = slugs[0];
const briefOnly = process.argv.includes('--brief');
/** An editor's scene, used as the brief as given. The no-text rules still apply in the prompt. */
const setBrief = process.env.HERO_BRIEF?.trim() || null;
const withVideo = process.argv.includes('--video') || process.env.HERO_VIDEO === 'true';
const log = (m: string) => console.log(m);

/** Print the picture editor's brief (and the prompt it makes) for each story: free to run, no images made. */
async function briefs() {
  const db = createClient();
  let q = db.from('stories').select('slug, title, hook, kicker, one_number').eq('status', 'published');
  q = slugs.length ? q.in('slug', slugs) : q.order('published', { ascending: false }).limit(6);
  const { data } = await q;
  for (const s of data ?? []) {
    const b = await heroBrief(s);
    log(`\n${s.title}\n  Brief: ${b ?? '(no brief: model unavailable)'}\n  Prompt: ${heroPrompt(s, b)}`);
  }
}

async function main() {
  if (briefOnly) return briefs();
  if (!slug) throw new Error('Pass --slug=<story slug> or HERO_SLUG');
  const db = createClient();
  const { data: story, error } = await db.from('stories')
    .select('slug, title, hook, kicker, one_number, status').eq('slug', slug).maybeSingle();
  if (error || !story) throw new Error(`No story ${slug}${error ? `: ${error.message}` : ''}`);
  log(`${story.status}: ${story.title}`);
  if (setBrief) log(`Set brief (editor's): ${setBrief}`);
  const image = await generateHeroImage(db, story, log, setBrief ?? undefined);
  if (withVideo) await generateHeroVideo(db, story, { heroGenerationId: image?.generationId ?? null, brief: image?.brief ?? null, log });
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
