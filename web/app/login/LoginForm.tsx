'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';

export default function LoginForm() {
  const search = useSearchParams();
  const next = search.get('next');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(search.get('error'));

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
