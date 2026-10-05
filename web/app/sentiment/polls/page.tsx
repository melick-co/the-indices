import Link from 'next/link';
import { loadPolls } from '@/lib/polls';
import { PollsDetail } from '@/components/dashboard/Polls';
import { Hero } from '@/components/dashboard/Views';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Polls — Sentiment & polls — Caveat', description: 'Every published federal poll since the 2025 election, with the trends.' };

export default async function PollsPage() {
  const polls = await loadPolls();
  return (
    <main className="dx">
      <Hero kicker={<><Link href="/sentiment">Sentiment &amp; polls</Link> · Polls · <span className="dx-private-badge">Private polls · context only</span></>} title="What the published polls say" />
      <div className="dx-body dx-article">
        <PollsDetail polls={polls} />
      </div>
    </main>
  );
}
