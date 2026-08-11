'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import type { EmailOtpType, Session } from '@supabase/supabase-js';

/**
 * Fallback landing for Supabase ConfirmationURL redirects.
 * Prefer /auth/confirm?token_hash=… (no PKCE) or the 6-digit code on /login.
 */
function CallbackInner() {
  const search = useSearchParams();
  const [message, setMessage] = useState('Signing you in…');

  useEffect(() => {
    let cancelled = false;

    async function finish() {
      const supabase = createClient();
      const authError = search.get('error_description') || search.get('error');
      if (authError) return fail(authError);

      let session: Session | null = null;
      let error: string | null = null;

      const code = search.get('code');
      const tokenHash = search.get('token_hash');
      const type = search.get('type') as EmailOtpType | null;
      const fromHash = sessionFromHash();

      if (fromHash) {
        const res = await supabase.auth.setSession(fromHash);
        error = res.error?.message ?? null;
        session = res.data.session;
        window.history.replaceState({}, '', window.location.pathname + window.location.search);
      } else if (tokenHash && type) {
        const res = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
        error = res.error?.message ?? null;
        session = res.data.session;
      } else if (code) {
        const res = await supabase.auth.exchangeCodeForSession(code);
        error = res.error?.message ?? null;
        session = res.data.session;
      } else {
        const res = await supabase.auth.getSession();
        session = res.data.session;
        if (!session) error = 'Missing auth tokens. Try the 6-digit code from your email.';
      }

      if (cancelled) return;
      if (error || !session) return fail(error || 'Sign-in failed. Try a new link.');

      let dest = safeNext(search.get('next'));
      if (!search.get('next')) {
        const { data: profile } = await supabase.from('profiles')
          .select('role').eq('id', session.user.id).single();
        dest = profile?.role === 'admin' ? '/studio' : '/account';
      }
      window.location.replace(dest);
    }

    function fail(msg: string) {
      if (cancelled) return;
      setMessage(msg);
      window.location.replace(`/login?error=${encodeURIComponent(msg)}`);
    }

    finish().catch((e: Error) => fail(e.message));
    return () => { cancelled = true; };
  }, [search]);

  return (
    <main className="wrap" style={{ maxWidth: '26rem', paddingTop: '5rem' }}>
      <div className="wordmark" style={{ fontSize: '2rem' }}>Caveat</div>
      <p className="note" style={{ marginTop: '1.2rem' }}>{message}</p>
    </main>
  );
}

function sessionFromHash(): { access_token: string; refresh_token: string } | null {
  if (typeof window === 'undefined') return null;
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (!access_token || !refresh_token) return null;
  return { access_token, refresh_token };
}

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/account';
  return raw;
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <main className="wrap" style={{ maxWidth: '26rem', paddingTop: '5rem' }}>
        <div className="wordmark" style={{ fontSize: '2rem' }}>Caveat</div>
        <p className="note" style={{ marginTop: '1.2rem' }}>Signing you in…</p>
      </main>
    }>
      <CallbackInner />
    </Suspense>
  );
}
