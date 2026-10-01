/**
 * Generate (or regenerate) hero art for one story: the illustration, and with
 * --video the narrated 8-second clip.
 *
 *   npx tsx --import ./scripts/node-shims.mjs scripts/hero-media.ts --slug=<slug> [--video]
 *   (or HERO_SLUG=<slug>)
 */
import { createClient } from '@/lib/supabase-server';
import { generateHeroImage } from '@/lib/hero-image';
import { generateHeroVideo } from '@/lib/hero-video';

const slug = process.argv.find((a) => a.startsWith('--slug='))?.slice(7) ?? process.env.HERO_SLUG?.trim();
const withVideo = process.argv.includes('--video') || process.env.HERO_VIDEO === 'true';
const log = (m: string) => console.log(m);

async function main() {
  if (!slug) throw new Error('Pass --slug=<story slug> or HERO_SLUG');
  const db = createClient();
  const { data: story, error } = await db.from('stories')
    .select('slug, title, hook, kicker, one_number, status').eq('slug', slug).maybeSingle();
  if (error || !story) throw new Error(`No story ${slug}${error ? `: ${error.message}` : ''}`);
  log(`${story.status}: ${story.title}`);
  const image = await generateHeroImage(db, story, log);
  if (withVideo) await generateHeroVideo(db, story, { heroGenerationId: image?.generationId ?? null, log });
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
