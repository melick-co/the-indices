import Link from 'next/link';
import { createClient } from '@/lib/supabase-server';
import AskPanel from './AskPanel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ask — Caveat Studio' };

export default async function AskPage() {
  const supabase = createClient();
  const [{ data: topics }, { data: sessions }] = await Promise.all([
    supabase.from('tracked_topics').select('*').order('created_at'),
    supabase.from('research_sessions').select('*').order('created_at', { ascending: false }).limit(15),
  ]);
  return <AskPanel topics={topics ?? []} sessions={sessions ?? []} />;
}
