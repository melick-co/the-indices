'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase-browser';

export default function Login() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    setErr(null);
    const { error } = await createClient().auth.signInWithOtp({
      email, options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setErr(error.message); else setSent(true);
  }

  return (
    <main className="wrap" style={{ maxWidth: '26rem', paddingTop: '5rem' }}>
      <div className="wordmark" style={{ fontSize: '2rem' }}>Caveat</div>
      <div className="lector" style={{ marginBottom: '2rem' }}>Studio · sign in</div>
      {sent ? (
        <p>Check your email for a sign-in link.</p>
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
          {err && <p style={{ color: 'var(--pen)', fontSize: '.85rem', marginTop: '.8rem' }}>{err}</p>}
        </>
      )}
    </main>
  );
}
