'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { sendSignInLink, verifySignInCode } from './actions';

export default function LoginForm() {
  const search = useSearchParams();
  const next = search.get('next');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(friendlyError(search.get('error')));

  // Recover if Supabase dumped tokens onto /login via Site URL + hash.
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
    setBusy(true);
    const res = await sendSignInLink(email, next);
    setBusy(false);
    if (!res.ok) setErr(res.error); else setSent(true);
  }

  async function verify() {
    setErr(null);
    setBusy(true);
    const res = await verifySignInCode(email, code, next);
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    window.location.replace(res.dest);
  }

  return (
    <main className="wrap" style={{ maxWidth: '26rem', paddingTop: '5rem' }}>
      <div className="wordmark" style={{ fontSize: '2rem' }}>Caveat</div>
      <div className="lector" style={{ marginBottom: '1.2rem' }}>Sign in or register</div>
      <p className="note" style={{ marginBottom: '1.5rem' }}>
        One link, no password. New here? The same link registers you and sets up alerts.
        Stories, indices and sources stay public either way.
      </p>

      {!sent ? (
        <>
          <input type="email" value={email} placeholder="you@example.com"
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            style={fieldStyle} />
          <button onClick={send} disabled={busy || !email.includes('@')} style={btnStyle}>
            {busy ? 'Sending…' : 'Send magic link'}
          </button>
        </>
      ) : (
        <>
          <p className="note" style={{ marginBottom: '1rem' }}>
            Check your email. Prefer the 6-digit code if the link opens in another app —
            that avoids a browser mismatch.
          </p>
          <input type="email" value={email} readOnly style={{ ...fieldStyle, opacity: .7 }} />
          <input type="text" inputMode="numeric" autoComplete="one-time-code"
            value={code} placeholder="6-digit code"
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
            onKeyDown={(e) => e.key === 'Enter' && verify()}
            style={fieldStyle} />
          <button onClick={verify} disabled={busy || code.length < 6} style={btnStyle}>
            {busy ? 'Verifying…' : 'Verify code'}
          </button>
          <button onClick={send} disabled={busy}
            style={{ ...btnStyle, background: 'transparent', color: 'var(--ink)',
              border: '1px solid var(--ink)', marginTop: '.6rem' }}>
            Resend
          </button>
        </>
      )}

      {err && <p style={{ color: 'var(--pen)', fontSize: '.85rem', marginTop: '.8rem' }}>{err}</p>}
    </main>
  );
}

function friendlyError(raw: string | null): string | null {
  if (!raw) return null;
  if (raw.toLowerCase().includes('pkce')) {
    return 'That email link opened without your sign-in cookie (often a different browser or mail app). Enter the 6-digit code from the same email instead, or request a new link and open it in this browser.';
  }
  return raw;
}

const fieldStyle: Record<string, string | number> = {
  width: '100%', padding: '.7rem .9rem', border: '1px solid var(--ink)',
  background: 'var(--paper)', fontFamily: 'IBM Plex Mono, monospace',
  fontSize: '.85rem', marginBottom: '.8rem',
};

const btnStyle: Record<string, string | number> = {
  width: '100%', padding: '.7rem', background: 'var(--ink)', color: 'var(--paper)',
  border: 'none', fontFamily: 'IBM Plex Mono, monospace', fontSize: '.78rem',
  letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer',
};
