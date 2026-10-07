/**
 * The story in three numbers: make (or remake) the top-of-story highlights for published stories.
 *
 *   npx tsx --import ./scripts/node-shims.mjs scripts/story-highlights.ts                 # every published story
 *   npx tsx --import ./scripts/node-shims.mjs scripts/story-highlights.ts --slug=<slug>   # these stories (or HIGHLIGHT_SLUGS)
 *   ... --dry-run   # print them, save nothing
 */
import { createClient } from '@/lib/supabase-server';
import { generateHighlights } from '@/lib/story-highlights';
import type { StoryBody, StoryOneNumber } from '@/lib/story-types';

const slugs = [...process.argv.filter((a) => a.startsWith('--slug=')).map((a) => a.slice(7)), ...(process.env.HIGHLIGHT_SLUGS ?? '').split(/\s+/)].filter(Boolean);
const dry = process.argv.includes('--dry-run');

async function main() {
  const db = createClient();
  let q = db.from('stories').select('slug, title, hook, caveat, kicker, one_number, body').eq('status', 'published');
  if (slugs.length) q = q.in('slug', slugs);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  for (const r of data ?? []) {
    const story = { title: r.title, hook: r.hook, caveat: r.caveat, kicker: r.kicker, oneNumber: r.one_number as StoryOneNumber, body: r.body as StoryBody };
    console.log(`\n${r.title}`);
    const h = await generateHighlights(story, (m) => console.log(`  ${m}`));
    if (!h) { console.log('  No highlights (kept as is).'); continue; }
    for (const i of h.items) console.log(`  ${i.figure.padEnd(12)} ${i.direction === 'down' ? '▼' : i.direction === 'up' ? '▲' : '▶'} ${i.label}${i.note ? ` · ${i.note}` : ''}${i.chart != null ? `  [chart ${i.chart}]` : ''}`);
    if (dry) continue;
    const { error: e } = await db.from('stories').update({ body: { ...story.body, highlights: h }, updated_at: new Date().toISOString() }).eq('slug', r.slug);
    console.log(e ? `  Save failed: ${e.message}` : '  Saved.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
