'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';

export default function LoginForm() {
  const search = useSearchParams();
  const next = search.get('next');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(search.get('error'));

  // If Supabase Site URL points here, tokens may arrive in the hash instead
  // of /auth/callback — finish sign-in rather than showing the form again.
  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, '');
    if (!raw.includes('access_token')) return;
    const params = new URLSearchParams(raw);
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    if (!access_token || !refresh_token) return;

    const supabase = createClient();
    supabase.auth.setSession({ access_token, refresh_token }).then(async ({ data, error }) => {
      if (error || !data.session) {
        setErr(error?.message || 'Could not complete sign-in from email link.');
        return;
      }
      window.history.replaceState({}, '', window.location.pathname + window.location.search);
      const { data: profile } = await supabase.from('profiles')
        .select('role').eq('id', data.session.user.id).single();
      const dest = (next && next.startsWith('/') && !next.startsWith('//'))
        ? next
        : profile?.role === 'admin' ? '/studio' : '/account';
      window.location.replace(dest);
    });
  }, [next]);

  async function send() {
    setErr(null);
    const origin = window.location.origin;
    const callback = new URL('/auth/callback', origin);
    if (next && next.startsWith('/') && !next.startsWith('//')) {
      callback.searchParams.set('next', next);
    }
    const { error } = await createClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callback.toString() },
    });
    if (error) setErr(error.message); else setSent(true);
  }

  return (
    <main className="wrap" style={{ maxWidth: '26rem', paddingTop: '5rem' }}>
      <div className="wordmark" style={{ fontSize: '2rem' }}>Caveat</div>
      <div className="lector" style={{ marginBottom: '1.2rem' }}>Sign in or register</div>
      <p className="note" style={{ marginBottom: '1.5rem' }}>
        One link, no password. New here? The same link registers you and sets up alerts.
        Stories, indices and sources stay public either way.
      </p>
      {sent ? (
        <p>
          Check your email for a sign-in link.
          Open it in this same browser — links opened in another app often can’t finish sign-in.
        </p>
      ) : (
        <>
          <input type="email" value={email} placeholder="you@example.com"
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            style={{ width: '100%', padding: '.7rem .9rem', border: '1px solid var(--ink)',
              background: 'var(--paper)', fontFamily: 'IBM Plex Mono, monospace',
              fontSize: '.85rem', marginBottom: '.8rem' }} />
          <button onClick={send} style={{ width: '100%', padding: '.7rem',
            background: 'var(--ink)', color: 'var(--paper)', border: 'none',
            fontFamily: 'IBM Plex Mono, monospace', fontSize: '.78rem',
            letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer' }}>
            Send magic link
          </button>
        </>
      )}
      {err && <p style={{ color: 'var(--pen)', fontSize: '.85rem', marginTop: '.8rem' }}>{err}</p>}
    </main>
  );
}
