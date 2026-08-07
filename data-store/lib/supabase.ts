import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser client for the Vercel app. Uses the ANON key, which under our RLS
 * policies grants no access until a user is authenticated. All reads require
 * an authenticated session (private data).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
