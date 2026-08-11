'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import type { EmailOtpType } from '@supabase/supabase-js';

/**
 * Client-side callback so the PKCE code verifier (stored in browser cookies
 * when the magic link was requested) is available for the exchange.
 * A Route Handler often failed here and bounced users back to /login.
 */
function CallbackInner() {
  const router = useRouter();
  const search = useSearchParams();
  const [message, setMessage] = useState('Signing you in…');

  useEffect(() => {
    let cancelled = false;

    async function finish() {
      const supabase = createClient();
      const code = search.get('code');
      const tokenHash = search.get('token_hash');
      const type = search.get('type') as EmailOtpType | null;
      const next = safeNext(search.get('next'));
      const authError = search.get('error_description') || search.get('error');

      if (authError) {
        if (!cancelled) setMessage(authError);
        router.replace(`/login?error=${encodeURIComponent(authError)}`);
        return;
      }

      let error: { message: string } | null = null;

      if (code) {
        ({ error } = await supabase.auth.exchangeCodeForSession(code));
      } else if (tokenHash && type) {
        ({ error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash }));
      } else if (typeof window !== 'undefined' && window.location.hash.includes('access_token')) {
        // Implicit/hash fallback — createBrowserClient has detectSessionInUrl.
        await new Promise((r) => setTimeout(r, 50));
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) error = { message: 'Could not read session from URL.' };
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          error = { message: 'Missing auth code. Try requesting a new link.' };
        }
      }

      if (error) {
        if (!cancelled) setMessage(error.message);
        router.replace(`/login?error=${encodeURIComponent(error.message)}`);
        return;
      }

      let dest = next;
      if (!search.get('next')) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: profile } = await supabase.from('profiles')
            .select('role').eq('id', user.id).single();
          dest = profile?.role === 'admin' ? '/studio' : '/account';
        }
      }

      if (!cancelled) router.replace(dest);
    }

    finish().catch((e: Error) => {
      if (!cancelled) {
        setMessage(e.message);
        router.replace(`/login?error=${encodeURIComponent(e.message)}`);
      }
    });

    return () => { cancelled = true; };
  }, [router, search]);

  return (
    <main className="wrap" style={{ maxWidth: '26rem', paddingTop: '5rem' }}>
      <div className="wordmark" style={{ fontSize: '2rem' }}>Caveat</div>
      <p className="note" style={{ marginTop: '1.2rem' }}>{message}</p>
    </main>
  );
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
