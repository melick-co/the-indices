/**
 * Australia Inc.: the running commentary and today's Bottom Line (lib/australia-inc-pipeline.ts).
 *
 *   npx tsx --import ./scripts/node-shims.mjs scripts/australia-inc.ts            fetch, review, write, check, save
 *   npx tsx --import ./scripts/node-shims.mjs scripts/australia-inc.ts --dry-run  the same, printing instead of saving
 *
 * The Bottom Line is published only when every check passed (fail closed); otherwise it is saved as 'held' for the
 * newsdesk. A dry run writes nothing of its own; the source check may cache official pages it reads in
 * source_documents, as it does for every story check.
 * Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.
 */
import { createClient } from '@/lib/supabase-server';
import { fetchBeatFeeds, loadCandidates, reviewItems, saveItems, writeBottomLine } from '@/lib/australia-inc-pipeline';

const dry = process.argv.includes('--dry-run');
const log = (line: string) => console.log(line);

async function main() {
  const db = createClient();
  const fresh = await fetchBeatFeeds(db, dry, log);
  const candidates = await loadCandidates(db, fresh);
  log(`${candidates.length} candidate item(s) from the last 36 hours`);
  const reviewed = await reviewItems(db, candidates, log);
  const items = dry ? reviewed : await saveItems(db, reviewed);
  if (dry) {
    for (const i of items) {
      log(`\n[${i.status}] ${i.publisher} · ${i.kind}: ${i.title}\n  ${i.summary}`);
      for (const c of i.claims) log(`  - ${c.text} [${c.verdict}${c.metric_id ? ` ${c.metric_id}` : ''}]${c.note ? ` ${c.note}` : ''}`);
    }
  }
  const bl = await writeBottomLine(db, items, { dry, log });
  if (bl && dry) {
    log(`\nTHE BOTTOM LINE (${bl.day}) [${bl.status}]\n${bl.draft.headline}\n`);
    for (const p of bl.paragraphs) log(`${p.text}\n  links: ${p.links.map((l) => `${l.label} -> ${l.url}`).join(' | ')}\n`);
    if (bl.check.warnings.length) log(`warnings:\n  ${bl.check.warnings.join('\n  ')}`);
  }
  if (!dry) {
    await db.from('agent_runs').insert({ notes: `australia-inc: ${JSON.stringify({ candidates: candidates.length, items: items.length, published: items.filter((i) => i.status === 'published').length, bottom_line: bl?.status ?? 'none' })}` });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
