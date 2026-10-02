/**
 * Refresh published articles into the house news style (agent/NEWS-STYLE.md).
 *
 *   npx tsx --import ./scripts/node-shims.mjs scripts/refresh-stories.ts <slug> [<slug> ...]          # write pending revisions
 *   npx tsx --import ./scripts/node-shims.mjs scripts/refresh-stories.ts --apply <slug> [...]        # put them live
 *   ... --apply --force   # apply even though the revision failed a check (editor's call)
 *   ... --show <slug>     # print the pending revision's copy, with deck and lede word counts
 *   ... --edit <slug>     # apply REVISION_EDITS (JSON [{find, replace}]) to the revision, then re-check it
 *   ... --recheck <slug>  # re-run every check on the revision as it stands
 *
 * Slugs may also come from STORY_SLUGS (space or comma separated). A refresh never changes the live
 * article: it saves a pending revision to preview at /stories/<slug>?revision=1. Applying archives the
 * current version in story_revisions and adds the reader-facing update note.
 */
import {
  applyRevision, editContent, loadRevisionContent, recheckRevision, refreshStory, saveRevisionContent, type CopyEdit,
} from '@/lib/refresh-story';
import type { StoryBlock } from '@/lib/story-types';
import type { FoundryEvent } from '@/lib/foundry-agent';

const apply = process.argv.includes('--apply');
const force = process.argv.includes('--force');
const show = process.argv.includes('--show');
const editMode = process.argv.includes('--edit');
const recheckOnly = process.argv.includes('--recheck');
const words = (t: string) => t.replace(/\[\^\d+\]/g, '').trim().split(/\s+/).filter(Boolean).length;
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
      if (show) {
        const { content, check } = await loadRevisionContent(slug);
        log(`  ${content.title} (${words(String(content.title))} words)`);
        log(`  Deck (${words(String(content.hook))} words): ${content.hook}`);
        for (const b of ((content.body as { blocks?: StoryBlock[] })?.blocks ?? [])) {
          if (b.type === 'paragraph') log(`  [${b.role ?? 'p'}] (${words(b.text)}w) ${b.text}`);
          else if (b.type === 'chart') log(`  [chart] ${b.title ?? ''}`);
          else if (b.type === 'timeline') for (const ev of b.events) log(`  [timeline] ${ev.date}: ${ev.label}`);
          else if (b.type === 'heading' || b.type === 'pull') log(`  [${b.type}] ${b.text}`);
        }
        for (const f of ((content.evidence as { footnotes?: { n: number; text: string; url?: string }[] })?.footnotes ?? [])) log(`  [^${f.n}] ${f.text} ${f.url ?? '(no link)'}`);
        log(`  Last check: ${check?.ok ? 'passed' : `held: ${(check?.issues ?? []).join(' | ')}`}`);
        continue;
      }
      if (editMode || recheckOnly) {
        if (editMode) {
          const edits = JSON.parse(process.env.REVISION_EDITS || '[]') as CopyEdit[];
          if (!edits.length) throw new Error('REVISION_EDITS is empty');
          const { content } = await loadRevisionContent(slug);
          await saveRevisionContent(slug, editContent(content, edits));
          log(`  Applied ${edits.length} edit(s) to the revision.`);
        }
        const check = await recheckRevision(slug);
        log(check.ok ? '  Passed every check.' : `  Held (${check.issues.length} issue(s)):`);
        for (const i of check.issues) log(`    - ${i}`);
        for (const w of check.warnings) log(`    ~ ${w}`);
        continue;
      }
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
