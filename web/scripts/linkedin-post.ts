/**
 * LinkedIn for the production queue: plan the weekday post (the day's lead story, else a graphic or race, drafted and
 * checked), then send whatever is cleared and due. Review mode sends only what an editor approved on the Queue page.
 * The linkedin-post task runs this every 30 minutes through the weekday morning (Sydney); it posts nothing the queue
 * has not cleared.
 *
 *   npx tsx --import ./scripts/node-shims.mjs scripts/linkedin-post.ts           # plan, then post what is due
 *   npx tsx --import ./scripts/node-shims.mjs scripts/linkedin-post.ts --plan    # plan and draft only, post nothing
 */
import { createClient } from '@/lib/supabase-server';
import { planLinkedin } from '@/lib/social/linkedin-plan';
import { postLinkedinNow } from '@/lib/social-post';

async function main() {
  const db = createClient();
  const lines = await planLinkedin(db);
  if (!lines.length) console.log('LinkedIn: nothing new to plan.');
  if (process.argv.includes('--plan')) return;
  await postLinkedinNow(db);
}

main().catch((e) => { console.error(e); process.exit(1); });
