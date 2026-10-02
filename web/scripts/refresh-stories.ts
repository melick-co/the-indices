/**
 * Refresh published articles into the house news style (agent/NEWS-STYLE.md).
 *
 *   npx tsx --import ./scripts/node-shims.mjs scripts/refresh-stories.ts <slug> [<slug> ...]          # write pending revisions
 *   npx tsx --import ./scripts/node-shims.mjs scripts/refresh-stories.ts --apply <slug> [...]        # put them live
 *   ... --apply --force   # apply even though the revision failed a check (editor's call)
 *   ... --show <slug>     # print the pending revision's copy, with deck and lede word counts
 *   ... --edit <slug>     # apply REVISION_EDITS (JSON [{find, replace}]) to the revision (or to a new revision of the
 *                         # live copy, for corrections), then re-check it. --apply takes REVISION_NOTE as the update note.
 *                         # REVISION_METRICS adds metric ids the copy quotes (space separated).
 *   ... --recheck <slug>  # re-run every check on the revision as it stands
 *   ... --sources <slug>  # read-only: check the live article's sourced statements against its source documents
 *   ... --discard <slug>  # drop the pending revision; the live article is untouched
 *   ... --publish <slug>  # publish an approved draft: re-checked first, published only if it still passes
 *   ... --drafts          # list draft stories; with --recheck/--show/--edit, slugs that are drafts are handled as
 *                         # drafts (edited and re-checked in place; they are not live)
 *
 * A refresh takes an editor's brief from REFRESH_BRIEF (e.g. a correction that reverses the finding).
 * Slugs may also come from STORY_SLUGS (space or comma separated). A refresh never changes the live
 * article: it saves a pending revision to preview at /stories/<slug>?revision=1. Applying archives the
 * current version in story_revisions and adds the reader-facing update note.
 */
import {
  applyRevision, discardRevision, editContent, editDraft, listDrafts, loadDraftContent, publishDraft, recheckDraft, loadRevisionContent, recheckRevision, refreshStory, saveRevisionContent, startRevisionFromLive,
  type CopyEdit,
} from '@/lib/refresh-story';
import type { StoryBlock } from '@/lib/story-types';
import { createClient } from '@/lib/supabase-server';
import { verifySourcedStatements } from '@/lib/source-check';
import type { FoundryEvent } from '@/lib/foundry-agent';

const apply = process.argv.includes('--apply');
const force = process.argv.includes('--force');
const show = process.argv.includes('--show');
const editMode = process.argv.includes('--edit');
const recheckOnly = process.argv.includes('--recheck');
const sourcesOnly = process.argv.includes('--sources');
const discard = process.argv.includes('--discard');
const draftsList = process.argv.includes('--drafts');
const publish = process.argv.includes('--publish');
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
  if (draftsList && !slugs.length) {
    const drafts = await listDrafts();
    log(`${drafts.length} draft(s):`);
    for (const d of drafts) log(`  ${d.slug}  pitch=${d.pitch_id ?? "none"}  (${String(d.updated_at).slice(0, 10)})  ${d.title}`);
    return;
  }
  if (!slugs.length) throw new Error('Name at least one story slug');
  let failed = 0;
  for (const slug of slugs) {
    log(`\n/stories/${slug}`);
    try {
      if (discard) {
        await discardRevision(slug);
        log('  Discarded the pending revision.');
        continue;
      }
      if (sourcesOnly) {
        const { data } = await createClient().from('stories').select('evidence, body').eq('slug', slug).single();
        const r = await verifySourcedStatements(createClient(), data as never);
        log(`  ${r.checked} sourced statement(s) checked; ${r.issues.length} problem(s).`);
        for (const i of r.issues) log(`    - ${i}`);
        continue;
      }
      if (publish) {
        const extra = (process.env.REVISION_METRICS ?? '').split(/[\s,]+/).filter(Boolean);
        const r = await publishDraft(slug, extra);
        log(r.published ? '  Published (passed every check).' : `  Not published: held (${r.check.issues.length} issue(s)):`);
        for (const i of r.published ? [] : r.check.issues) log(`    - ${i}`);
        if (!r.published) failed++;
        continue;
      }
      // Drafts (held new articles) are shown, edited and re-checked in place.
      const draft = (show || editMode || recheckOnly) ? await loadDraftContent(slug).catch(() => null) : null;
      if (draft) {
        const extra = (process.env.REVISION_METRICS ?? '').split(/[\s,]+/).filter(Boolean);
        if (show) {
          log(`  [draft] ${draft.title} (${words(String(draft.title))} words)`);
          log(`  Deck (${words(String(draft.hook))} words): ${draft.hook}`);
          for (const [i, b] of ((draft.body as { blocks?: StoryBlock[] })?.blocks ?? []).entries()) {
            if (b.type === 'paragraph') log(`  ${i}. [${b.role ?? 'p'}] (${words(b.text)}w) ${b.text}`);
            else if (b.type === 'chart') log(`  ${i}. [chart ^${b.footnote ?? '-'}] ${b.title ?? ''}`);
            else if (b.type === 'timeline') for (const ev of b.events) log(`  ${i}. [timeline ^${ev.footnote ?? '-'}] ${ev.date}: ${ev.label}`);
            else if (b.type === 'layers') for (const t of b.items) log(`  ${i}. [layer] ${t}`);
            else if (b.type === 'quote') log(`  ${i}. [quote] "${b.text}" (${b.speaker})`);
            else if (b.type === 'heading' || b.type === 'pull') log(`  ${i}. [${b.type}] ${b.text}`);
            else log(`  ${i}. [${(b as { type?: string }).type ?? 'unknown'}] ${JSON.stringify(b).slice(0, 160)}`);
          }
          const table = (draft.evidence as { table?: { head: string[]; rows: string[][] } })?.table;
          if (table) { log(`  [table] ${table.head.join(' | ')}`); table.rows.forEach((r, i) => log(`  [row ${i + 1}] ${r.join(' | ')}`)); }
          const one = draft.one_number as { value?: string; label?: string; footnote?: number } | null;
          if (one) log(`  [one_number ^${one.footnote ?? '-'}] ${one.value} ${one.label}`);
          for (const f of ((draft.evidence as { footnotes?: { n: number; text: string; url?: string }[] })?.footnotes ?? [])) log(`  [^${f.n}] ${f.text} ${f.url ?? '(no link)'}`);
          continue;
        }
        const edits = editMode ? JSON.parse(process.env.REVISION_EDITS || '[]') as CopyEdit[] : [];
        // REVISION_DROP removes blocks by position (as --show numbers them), e.g. leftovers from an older format.
        const drop = (process.env.REVISION_DROP ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
        const check = edits.length || drop.length ? await editDraft(slug, edits, extra, drop) : await recheckDraft(slug, extra);
        log(`  [draft] "${draft.title}"${edits.length ? ` (${edits.length} edit(s))` : ''}`);
        log(check.ok ? '  Passed every check.' : `  Held (${check.issues.length} issue(s)):`);
        for (const i of check.issues) log(`    - ${i}`);
        for (const w of check.warnings) log(`    ~ ${w}`);
        continue;
      }
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
          // No pending revision: start one from the live copy (a correction).
          const existing = await loadRevisionContent(slug).catch(() => null);
          if (!existing) { await startRevisionFromLive(slug); log('  Started a revision from the live copy.'); }
          const { content } = existing ?? await loadRevisionContent(slug);
          const edited = editContent(content, edits);
          // REVISION_METRICS adds stored series the copy quotes, so the re-check audits against them.
          const extra = (process.env.REVISION_METRICS ?? '').split(/[\s,]+/).filter(Boolean);
          if (extra.length) edited.metric_ids_used = [...new Set([...(edited.metric_ids_used ?? []), ...extra])];
          await saveRevisionContent(slug, edited);
          log(`  Applied ${edits.length} edit(s) to the revision.`);
        }
        const check = await recheckRevision(slug);
        log(check.ok ? '  Passed every check.' : `  Held (${check.issues.length} issue(s)):`);
        for (const i of check.issues) log(`    - ${i}`);
        for (const w of check.warnings) log(`    ~ ${w}`);
        continue;
      }
      if (apply) {
        const r = await applyRevision(slug, { force, note: process.env.REVISION_NOTE?.trim() || undefined });
        log(`  Applied: "${r.title}"`);
        continue;
      }
      const r = await refreshStory(slug, onEvent, process.env.REFRESH_BRIEF);
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
