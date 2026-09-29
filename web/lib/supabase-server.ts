import { createServerClient } from '@supabase/ssr';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

/**
 * Server data client.
 * Uses the service role, so it bypasses RLS: every admin entry point must call
 * requireAdmin() (lib/auth.ts) first, and middleware gates the admin pages.
 * Falls back to the signed-in session when no service key is configured (local dev).
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && service) {
    return createServiceClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return createSessionClient();
}

/** The visitor's own session, subject to RLS. Use for anything about who is signed in. */
export function createSessionClient() {
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
          } catch { /* Server Component: middleware refreshes instead */ }
        },
      },
    }
  );
}
