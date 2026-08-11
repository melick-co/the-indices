import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_ENABLED } from '@/lib/auth-flags';

/**
 * Auth temporarily disabled — see lib/auth-flags.ts.
 * Re-enable gating here when IAM comes back.
 */
const GATED = ['/studio', '/account'];

export async function middleware(request: NextRequest) {
  if (!AUTH_ENABLED) return NextResponse.next();

  const path = request.nextUrl.pathname;
  if (!GATED.some((p) => path.startsWith(p))) return NextResponse.next();

  // Kept for when AUTH_ENABLED flips back on — import createServerClient then.
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('next', path);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
