'use server';

import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';

function siteOrigin() {
  return headers().get('origin')
    || process.env.NEXT_PUBLIC_SITE_URL
    || 'https://the-indices.vercel.app';
}

function cookieClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(list: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          try {
            list.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as any));
          } catch { /* Server Action cookie mutation can throw in edge cases */ }
        },
      },
    }
  );
}

/**
 * Send a sign-in email.
 * Prefer Resend + admin generateLink (code + token_hash, no PKCE).
 * Fall back to Supabase's built-in mailer.
 */
export async function sendSignInLink(email: string, next?: string | null) {
  const origin = siteOrigin();
  const confirm = new URL('/auth/confirm', origin);
  confirm.searchParams.set('type', 'magiclink');
  if (next && next.startsWith('/') && !next.startsWith('//')) {
    confirm.searchParams.set('next', next);
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Caveat <onboarding@resend.dev>';

  if (serviceKey && resendKey) {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
      serviceKey,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: confirm.toString() },
    });
    if (error) return { ok: false as const, error: error.message };

    const tokenHash = data.properties.hashed_token;
    const otp = data.properties.email_otp;
    confirm.searchParams.set('token_hash', tokenHash);

    const html = `
      <div style="font-family: Georgia, serif; max-width: 28rem; color: #1a1a1a;">
        <h2 style="font-weight: 700;">Sign in to Caveat</h2>
        <p>Use this one-time code:</p>
        <p style="font-family: ui-monospace, monospace; font-size: 1.6rem; letter-spacing: .2em;">
          <strong>${otp}</strong>
        </p>
        <p>Or open this link (works in any browser):</p>
        <p><a href="${confirm.toString()}">Sign in to Caveat</a></p>
        <p style="color:#666;font-size:.85rem;">Expires shortly. If you didn’t request this, ignore the email.</p>
      </div>
    `;

    const mail = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'Your Caveat sign-in code',
        html,
      }),
    });
    if (!mail.ok) {
      const body = await mail.text();
      return { ok: false as const, error: `Email send failed: ${body.slice(0, 200)}` };
    }
    return { ok: true as const, via: 'resend' as const };
  }

  // Fallback: Supabase mailer (PKCE-sensitive ConfirmationURL).
  const supabase = cookieClient();
  const callback = new URL('/auth/callback', origin);
  if (next && next.startsWith('/') && !next.startsWith('//')) {
    callback.searchParams.set('next', next);
  }
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callback.toString(), shouldCreateUser: true },
  });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, via: 'supabase' as const };
}

/** Complete sign-in with the 6-digit code (no PKCE, works in any browser). */
export async function verifySignInCode(email: string, token: string, next?: string | null) {
  const supabase = cookieClient();
  const cleaned = token.trim();

  let result = await supabase.auth.verifyOtp({ email, token: cleaned, type: 'email' });
  if (result.error) {
    result = await supabase.auth.verifyOtp({ email, token: cleaned, type: 'magiclink' });
  }

  if (result.error || !result.data.session) {
    return { ok: false as const, error: result.error?.message || 'Invalid or expired code.' };
  }

  let dest = (next && next.startsWith('/') && !next.startsWith('//')) ? next : '/account';
  if (!next) {
    const { data: profile } = await supabase.from('profiles')
      .select('role').eq('id', result.data.session.user.id).single();
    dest = profile?.role === 'admin' ? '/studio' : '/account';
  }
  return { ok: true as const, dest };
}
