import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Caveat is public. Only the studio (pitch review, inbox, agent logs) is gated.
 * Public routes never touch Supabase, so the database stays private behind RLS
 * and public pages stay fast.
 */
const GATED = ['/studio', '/account'];

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const gated = GATED.some((p) => path.startsWith(p));

  // Always refresh the session when hitting gated routes so cookies stay valid
  // after the client-side magic-link exchange.
  if (!gated) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(list: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options as any));
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  // The studio is admin only. Subscribers land on their account instead.
  if (path.startsWith('/studio')) {
    const { data: profile } = await supabase.from('profiles')
      .select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') {
      const url = request.nextUrl.clone();
      url.pathname = '/account';
      return NextResponse.redirect(url);
    }
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
