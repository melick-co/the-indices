/**
 * Rewrite one story's reel from its current copy and cut it: script, storyboard and prompt pack (the three
 * buttons on the reel page), then a fresh picture for every scene that is not a chart, then the cut. For a story
 * whose copy has changed since its reel was made (a correction, a figure update).
 *
 *   npx tsx --import ./scripts/node-shims.mjs scripts/reel-rewrite.ts --slug=<slug>   (or REEL_SLUG=<slug>)
 *   ... --no-pictures   keep whatever pictures still match their scenes; scenes without one go on paper
 *   ... --no-cut        stop after the prompt pack and pictures
 */
import { generateVideoStage } from '@/lib/generate-reel';
import { listRenders, pollRenders, startRenders } from '@/lib/generate-runway';
import { cutReel } from '@/lib/reel-cut';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const slug = arg('slug') ?? process.env.REEL_SLUG?.trim();
const pictures = !process.argv.includes('--no-pictures');
const cut = !process.argv.includes('--no-cut');
const log = (m: string) => console.log(m);
const PICTURE_MINUTES = 25;

async function main() {
  if (!slug) throw new Error('Name the story: --slug=<slug> or REEL_SLUG');

  for (const stage of ['script', 'storyboard', 'prompts'] as const) {
    log(`\n${stage}`);
    const r = await generateVideoStage(slug, stage, (m) => log(`  · ${m}`));
    log(`  ${r.sceneCount} scenes, ${r.totalSeconds}s`);
    for (const w of r.warnings) log(`  ~ ${w}`);
  }

  if (pictures) {
    log('\npictures');
    await startRenders(slug, { scope: 'reel', kind: 'auto' });
    // Stills land first and chain into clips; poll until nothing is queued or running.
    const deadline = Date.now() + PICTURE_MINUTES * 60_000;
    for (;;) {
      const renders = await pollRenders(slug);
      const open = renders.filter((r) => r.status === 'queued' || r.status === 'running');
      if (!open.length) break;
      if (Date.now() > deadline) {
        log(`  ${open.length} picture job(s) still open after ${PICTURE_MINUTES} minutes; cutting without them.`);
        break;
      }
      await new Promise((r) => setTimeout(r, 15_000));
    }
    for (const r of await listRenders(slug)) {
      if (r.kind === 'still' || r.kind === 'clip') log(`  ${r.sceneId} ${r.kind} ${r.status}${r.error ? `: ${r.error}` : ''}`);
    }
  }

  if (cut) {
    log('\ncut');
    const { url, seconds } = await cutReel(slug, { log: (m) => log(`  ${m}`) });
    log(`  ${seconds}s: ${url}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
