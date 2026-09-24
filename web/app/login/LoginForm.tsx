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
        : profile?.role === 'admin' ? '/foundry' : '/account';
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
    <div className="ops-card" style={{ maxWidth: '26rem' }}>
      <h1 className="section-head" style={{ marginBottom: 8 }}>Caveat</h1>
      <p className="measure" style={{ marginBottom: 16 }}>Sign in or register</p>
      <p className="measure" style={{ marginBottom: 20 }}>
        One link, no password. New here? The same link registers you and sets up alerts.
        Stories, indices and sources stay public either way.
      </p>

      {!sent ? (
        <>
          <input type="email" value={email} placeholder="you@example.com"
            className="studio-field"
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            style={{ marginBottom: 8 }} />
          <button type="button" onClick={send} disabled={busy || !email.includes('@')}
            className="studio-btn-accent" style={{ width: '100%' }}>
            {busy ? 'Sending…' : 'Send magic link'}
          </button>
        </>
      ) : (
        <>
          <p className="measure" style={{ marginBottom: 16 }}>
            Check your email. Prefer the 6-digit code if the link opens in another app —
            that avoids a browser mismatch.
          </p>
          <input type="email" value={email} readOnly className="studio-field"
            style={{ marginBottom: 8, opacity: 0.7 }} />
          <input type="text" inputMode="numeric" autoComplete="one-time-code"
            value={code} placeholder="6-digit code" className="studio-field"
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
            onKeyDown={(e) => e.key === 'Enter' && verify()}
            style={{ marginBottom: 8 }} />
          <button type="button" onClick={verify} disabled={busy || code.length < 6}
            className="studio-btn-accent" style={{ width: '100%' }}>
            {busy ? 'Verifying…' : 'Verify code'}
          </button>
          <button type="button" onClick={send} disabled={busy}
            className="studio-btn-ghost" style={{ width: '100%', marginTop: 8 }}>
            Resend
          </button>
        </>
      )}

      {err && <p style={{ color: 'var(--color-ember, #e7000b)', fontSize: 14, marginTop: 12 }}>{err}</p>}
    </div>
  );
}

function friendlyError(raw: string | null): string | null {
  if (!raw) return null;
  if (raw.toLowerCase().includes('pkce')) {
    return 'That email link opened without your sign-in cookie (often a different browser or mail app). Enter the 6-digit code from the same email instead, or request a new link and open it in this browser.';
  }
  return raw;
}
