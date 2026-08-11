import { createServerClient } from '@supabase/ssr';
import type { EmailOtpType } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * Cross-browser magic-link completion.
 * Email templates should link here with token_hash (not ConfirmationURL),
 * which does not require a PKCE code verifier cookie.
 *
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const type = (searchParams.get('type') ?? 'magiclink') as EmailOtpType;
  const next = safeNext(searchParams.get('next'));

  if (!token_hash) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent('Missing sign-in token. Request a new link.')}`
    );
  }

  const pending: Array<{ name: string; value: string; options?: Record<string, unknown> }> = [];
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(list: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          list.forEach((c) => pending.push(c));
        },
      },
    }
  );

  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash });
  if (error || !data.session) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error?.message || 'Sign-in link expired. Request a new one.')}`
    );
  }

  let dest = next;
  if (!searchParams.get('next')) {
    const { data: profile } = await supabase.from('profiles')
      .select('role').eq('id', data.session.user.id).single();
    dest = profile?.role === 'admin' ? '/studio' : '/account';
  }

  const response = NextResponse.redirect(`${origin}${dest}`);
  for (const { name, value, options } of pending) {
    response.cookies.set(name, value, options as any);
  }
  return response;
}

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/account';
  return raw;
}
