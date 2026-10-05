/**
 * Cut one story's reel: Remotion renders the locked storyboard, ElevenLabs reads it, and the MP4
 * lands in the reel-renders bucket with a row on story_reel_renders.
 *
 *   npx tsx --import ./scripts/node-shims.mjs scripts/reel-cut.ts --slug=<slug>      (or REEL_SLUG=<slug>)
 *   npx tsx --import ./scripts/node-shims.mjs scripts/reel-cut.ts --demo --out=demo.mp4
 *
 * --demo renders the sample scenes in lib/reel-cut-types.ts with no database and no voice, to
 * check the look. REMOTION_BROWSER points at a Chrome binary when the headless shell should not
 * be downloaded.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cutReel, renderCut } from '@/lib/reel-cut';
import { DEMO_PROPS } from '@/lib/reel-cut-types';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const slug = arg('slug') ?? process.env.REEL_SLUG?.trim();
const demo = process.argv.includes('--demo');
const log = (m: string) => console.log(m);

async function main() {
  if (demo) {
    const outFile = resolve(arg('out') ?? 'reel-demo.mp4');
    const publicDir = await mkdtemp(join(tmpdir(), 'reel-demo-public-'));
    try {
      await renderCut(DEMO_PROPS, { publicDir, outFile, log });
      log(`Demo cut written to ${outFile}`);
    } finally {
      await rm(publicDir, { recursive: true, force: true });
    }
    return;
  }
  if (!slug) throw new Error('Pass --slug=<story slug> or REEL_SLUG (or --demo)');
  const { url, seconds } = await cutReel(slug, { log });
  log(`${seconds.toFixed(1)}s: ${url}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
