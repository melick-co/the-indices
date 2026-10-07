/**
 * The content scheduling assistant: slot every ready piece in the production queue within the rules, and plan its
 * channel posts (web/lib/content-queue.ts). Generators run it after queuing; this runs it on its own too.
 *
 *   npx tsx --import ./scripts/node-shims.mjs scripts/schedule-content.ts          # schedule what's ready
 *   npx tsx --import ./scripts/node-shims.mjs scripts/schedule-content.ts --list   # show the queue, change nothing
 */
import { createClient } from '@/lib/supabase-server';
import { loadRules, scheduleContent } from '@/lib/content-queue';

async function main() {
  const db = createClient();
  if (process.argv.includes('--list')) {
    const rules = await loadRules(db);
    console.log(`Queue ${rules.installed ? (rules.enabled ? 'on' : 'off') : 'not installed'}.`);
    const { data } = await db.from('content_queue').select('kind, title, status, scheduled_at, published_at, reason').in('status', ['ready', 'scheduled', 'held', 'failed']).order('scheduled_at', { nullsFirst: true });
    for (const q of data ?? []) {
      const when = q.scheduled_at ? new Date(q.scheduled_at).toLocaleString('en-AU', { timeZone: rules.timezone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
      console.log(`${q.status.padEnd(9)} ${when.padEnd(22)} ${q.kind.padEnd(7)} ${q.title}${q.reason ? `\n          ${q.reason}` : ''}`);
    }
    return;
  }
  await scheduleContent(db);
}

main().catch((e) => { console.error(e); process.exit(1); });
