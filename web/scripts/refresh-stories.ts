/**
 * Refresh published articles into the house news style (agent/NEWS-STYLE.md).
 *
 *   npx tsx --import ./scripts/node-shims.mjs scripts/refresh-stories.ts <slug> [<slug> ...]          # write pending revisions
 *   npx tsx --import ./scripts/node-shims.mjs scripts/refresh-stories.ts --apply <slug> [...]        # put them live
 *   ... --apply --force   # apply even though the revision failed a check (editor's call)
 *
 * Slugs may also come from STORY_SLUGS (space or comma separated). A refresh never changes the live
 * article: it saves a pending revision to preview at /stories/<slug>?revision=1. Applying archives the
 * current version in story_revisions and adds the reader-facing update note.
 */
import { applyRevision, refreshStory } from '@/lib/refresh-story';
import type { FoundryEvent } from '@/lib/foundry-agent';

const apply = process.argv.includes('--apply');
const force = process.argv.includes('--force');
const slugs = [
  ...process.argv.slice(2).filter((a) => !a.startsWith('--')),
  ...(process.env.STORY_SLUGS ?? '').split(/[\s,]+/),
].filter(Boolean);
const log = (msg: string) => console.log(msg);
const onEvent = (e: FoundryEvent) => {
  const ev = e as { type: string; label?: string };
  if (ev.label && (ev.type === 'tool_start' || ev.type === 'tool_result')) log(`    · ${ev.label}`);
};

async function main() {
  if (!slugs.length) throw new Error('Name at least one story slug');
  let failed = 0;
  for (const slug of slugs) {
    log(`\n/stories/${slug}`);
    try {
      if (apply) {
        const r = await applyRevision(slug, { force });
        log(`  Applied: "${r.title}"`);
        continue;
      }
      const r = await refreshStory(slug, onEvent);
      log(`  Revision ${r.revisionId}: "${r.title}"`);
      log(`  Preview: /stories/${slug}?revision=1`);
      if (r.check.ok) log('  Passed every check.');
      else {
        log(`  Held (${r.check.issues.length} issue(s)):`);
        for (const i of r.check.issues.slice(0, 12)) log(`    - ${i}`);
      }
      for (const w of r.check.warnings ?? []) log(`    ~ ${w}`);
    } catch (e) {
      failed++;
      log(`  Failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
