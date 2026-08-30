import Link from 'next/link';
import SiteFooter from '@/components/SiteFooter';
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
          <h1>Account</h1>
          <p className="measure" style={{ marginTop: 'var(--spacing-21)' }}>
            Sign-in is paused while we rebuild IAM. The rest of the site —
            stories, indices, methodology and studio — is open in the meantime.
          </p>
          <p style={{ marginTop: 'var(--spacing-21)' }}>
            <Link href="/studio">Open the studio →</Link>
          </p>
        </main>
        <SiteFooter />
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
        <h1>Your account</h1>
        <div className="byline">
          {profile.email}
          {' · '}
          <span className={`badge-role role-${profile.role}`}>{profile.role}</span>
        </div>
        <AccountPanel profile={profile} topics={(topics ?? []).map((t) => t.label)} />
        {profile.role === 'admin' && (
          <p style={{ marginTop: 'var(--spacing-42)' }}>
            <Link href="/studio">Open the studio →</Link>
          </p>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
