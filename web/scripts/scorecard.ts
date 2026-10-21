/**
 * The government scorecard's maintenance run (lib/scorecard-pipeline.ts).
 *
 *   npx tsx --import ./scripts/node-shims.mjs scripts/scorecard.ts                draft or update the list, check, rate, log
 *   npx tsx --import ./scripts/node-shims.mjs scripts/scorecard.ts --dry-run      the same, printing instead of saving
 *   npx tsx --import ./scripts/node-shims.mjs scripts/scorecard.ts --quotes-only  no database or model: are the seed
 *                                                                                  quotes in their documents?
 *   npx tsx --import ./scripts/node-shims.mjs scripts/scorecard.ts --cache-sources store the commitments' official
 *                                                                                  pages in source_documents
 *
 * --cache-sources is for when the GitHub runner cannot read an official page (a site blocking cloud addresses, or down
 * for maintenance, as treasury.gov.au was on 21 Oct 2026): run it on a machine that can (the editor's, with web/.env.local
 * holding SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY; no Anthropic key needed). The next scorecard run checks quotes
 * against those stored copies and records that it did, with the date each was fetched. Only official publishers'
 * pages are fetched or stored; nothing else is written.
 *
 * Fail closed: a commitment is shown only when its quote is in the official document and the source check confirmed
 * it; otherwise it is stored as 'held' (the newsdesk shows it). A dry run writes nothing of its own; the source check
 * may cache official pages it reads in source_documents, as it does for every story check.
 * Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.
 */
import { cacheSources, checkSeedQuotes, runScorecard } from '@/lib/scorecard-pipeline';

const dry = process.argv.includes('--dry-run');
const log = (line: string) => console.log(line);

async function main() {
  if (process.argv.includes('--quotes-only')) {
    const ok = await checkSeedQuotes(log);
    process.exit(ok ? 0 : 1);
  }
  const { createClient } = await import('@/lib/supabase-server');
  if (process.argv.includes('--cache-sources')) {
    const res = await cacheSources(createClient(), log);
    log(`\ncached: ${JSON.stringify(res)}`);
    process.exit(res.failed ? 1 : 0);
  }
  const res = await runScorecard(createClient(), { dry, log });
  log(`\nscorecard: ${JSON.stringify(res)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
