import Link from 'next/link';
import { AUTH_ENABLED } from '@/lib/auth-flags';
import { getProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase-server';
import AccountPanel from './AccountPanel';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Account — Caveat' };

export default async function Account() {
  if (!AUTH_ENABLED) {
    return (
      <>
        <main className="article acct">
          <h1 className="section-head" style={{ borderBottom: 'none' }}>Account</h1>
          <div className="ops-card">
            <p className="measure" style={{ margin: 0 }}>
              Sign-in is paused while we rebuild IAM. The rest of the site —
              stories, indices, methodology and studio — is open in the meantime.
            </p>
            <p style={{ marginTop: 16, marginBottom: 0 }}>
              <Link href="/foundry" className="studio-btn-accent">Open Foundry</Link>
            </p>
          </div>
        </main>
      </>
    );
  }

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
