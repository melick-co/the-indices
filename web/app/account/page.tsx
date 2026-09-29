import Link from 'next/link';
import { getProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase-server';
import AccountPanel from './AccountPanel';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Account — Caveat' };

export default async function Account() {
  const profile = await getProfile();
  if (!profile) redirect('/login?next=/account');

  const supabase = createClient();
  const { data: topics } = await supabase.from('tracked_topics')
    .select('label').eq('active', true);

  return (
    <>
        <main className="article acct">
        <h1 className="section-head" style={{ borderBottom: 'none' }}>Your account</h1>
        <div className="byline">
          {profile.email}
          {' · '}
          <span className={`badge-role role-${profile.role}`}>{profile.role}</span>
        </div>
        <AccountPanel profile={profile} topics={(topics ?? []).map((t) => t.label)} />
        {profile.role === 'admin' && (
          <p style={{ marginTop: 24 }}>
            <Link href="/foundry" className="studio-btn-accent">Open Foundry</Link>
          </p>
        )}
      </main>
    </>
  );
}
