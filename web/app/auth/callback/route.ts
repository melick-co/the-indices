import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const cookieStore = cookies();
  const response = NextResponse.redirect(`${origin}/studio`);

  if (code) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(list: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
            list.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options as any));
          },
        },
      }
    );
    await supabase.auth.exchangeCodeForSession(code);
  }
  return response;
}
