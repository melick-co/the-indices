import { createServerClient } from '@supabase/ssr';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { AUTH_ENABLED } from './auth-flags';

/**
 * Server Supabase client.
 * While AUTH_ENABLED is false, prefer the service role so studio/account
 * keep working without a logged-in session (RLS would otherwise return empty).
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!AUTH_ENABLED && url && service) {
    return createServiceClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

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
