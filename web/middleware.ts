import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Caveat is public. The desk (Foundry, Studio, Markets, reel tools, draft previews)
 * is admin only; /account needs any signed-in user.
 * Server actions are also guarded in code with requireAdmin(), because an action
 * can be posted to any route, including public ones.
 */
const ADMIN_PREFIXES = ['/foundry', '/studio', '/markets', '/api/foundry', '/api/stories'];
const SIGNED_IN_PREFIXES = ['/account'];
// Reader-facing pages that live under an admin prefix.
const PUBLIC_EXCEPTIONS = ['/markets/rba-rate-rise'];

function matches(path: string, prefixes: string[]) {
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`));
}

function needsAdmin(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (matches(path, PUBLIC_EXCEPTIONS)) return false;
  if (matches(path, ADMIN_PREFIXES)) return true;
  if (/^\/stories\/[^/]+\/reel(\/|$)/.test(path)) return true;
  // Draft previews of unpublished stories.
  if (request.nextUrl.searchParams.get('preview') === '1'
    && (path.startsWith('/stories/') || path.startsWith('/evidence/'))) return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const admin = needsAdmin(request);
  if (!admin && !matches(path, SIGNED_IN_PREFIXES)) return NextResponse.next();

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
  const isApi = path.startsWith('/api/');

  if (!user) {
    if (isApi) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', path + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (admin) {
    const { data: profile } = await supabase.from('profiles')
      .select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') {
      if (isApi) return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });
      const url = request.nextUrl.clone();
      url.pathname = '/account';
      url.search = '';
      return NextResponse.redirect(url);
    }
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
