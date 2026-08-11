import Link from 'next/link';
import Masthead from '@/components/Masthead';
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
        <Masthead />
        <main className="wrap article">
          <h1 style={{ fontSize: '2rem' }}>Account</h1>
          <p className="note" style={{ marginTop: '1rem' }}>
            Sign-in is paused while we rebuild IAM. The rest of the site —
            stories, indices, methodology and studio — is open in the meantime.
          </p>
          <p style={{ marginTop: '1.5rem', fontFamily: 'IBM Plex Mono, monospace', fontSize: '.8rem' }}>
            <Link href="/studio" style={{ borderBottom: '1px solid var(--pen)' }}>
              Open the studio →
            </Link>
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
      <Masthead />
      <main className="wrap article">
        <h1 style={{ fontSize: '2rem' }}>Your account</h1>
        <div className="byline">
          {profile.email}
          {' · '}
          <span className={`badge-role role-${profile.role}`}>{profile.role}</span>
        </div>
        <AccountPanel profile={profile} topics={(topics ?? []).map((t) => t.label)} />
        {profile.role === 'admin' && (
          <p style={{ marginTop: '2rem', fontFamily: 'IBM Plex Mono, monospace', fontSize: '.8rem' }}>
            <Link href="/studio" style={{ borderBottom: '1px solid var(--pen)' }}>
              Open the studio →
            </Link>
          </p>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
