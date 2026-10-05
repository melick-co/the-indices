import Link from 'next/link';
import { loadPolls } from '@/lib/polls';
import { PollsDetail } from '@/components/dashboard/Polls';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Polls — Sentiment & polls — Caveat', description: 'Every published federal poll since the 2025 election, with the trends.' };

export default async function PollsPage() {
  const polls = await loadPolls();
  return (
    <main className="article econ-dash">
      <p className="desk-kicker"><Link href="/sentiment">Sentiment &amp; polls</Link> · Polls</p>
      <h1 className="section-head econ-dash-title">What the published polls say</h1>
      <PollsDetail polls={polls} />
    </main>
  );
}
