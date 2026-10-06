import { createClient } from '@/lib/supabase-server';
import { loadRules, type QueueItem, type QueuePost } from '@/lib/content-queue';
import QueueBoard from './QueueBoard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Production queue — Caveat' };

export default async function QueuePage() {
  const db = createClient();
  const rules = await loadRules(db);
  let items: QueueItem[] = [], posts: QueuePost[] = [];
  if (rules.installed) {
    const since = new Date(Date.now() - 14 * 864e5).toISOString();
    const [{ data: open }, { data: done }] = await Promise.all([
      db.from('content_queue').select('*').in('status', ['ready', 'scheduled', 'held', 'failed']).order('scheduled_at', { nullsFirst: true }),
      db.from('content_queue').select('*').eq('status', 'published').gte('published_at', since).order('published_at', { ascending: false }),
    ]);
    items = [...(open ?? []), ...(done ?? [])] as QueueItem[];
    if (items.length) {
      const { data } = await db.from('content_posts').select('*').in('queue_id', items.map((i) => i.id));
      posts = (data ?? []) as QueuePost[];
    }
  }
  return (
    <main className="desk-page pq-page">
      <p className="desk-kicker">Foundry · Production queue</p>
      <h1 className="section-head" style={{ borderBottom: 'none' }}>Production queue</h1>
      <p className="measure pq-intro">
        Finished articles, graphics and race videos wait here for a slot. The scheduling assistant fills the calendar
        within the rules below and writes a caption for each channel; at each slot the piece goes live on the site.
        Anything you schedule by hand stays where you put it. Breaking stories skip the queue.
      </p>
      {!rules.installed
        ? <p className="pq-note">The queue tables aren&apos;t installed yet: run <code>agent/supabase/42_production_queue.sql</code> in the Supabase SQL editor. Until then, everything publishes as soon as it&apos;s made.</p>
        : <QueueBoard rules={rules} items={items} posts={posts} />}
    </main>
  );
}
