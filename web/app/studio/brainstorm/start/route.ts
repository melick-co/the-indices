import { NextRequest, NextResponse } from 'next/server';
import { createBrainstormSession } from '../actions';

/** Create a brainstorm session from query params and redirect into the workspace. */
export async function GET(req: NextRequest) {
  const title = req.nextUrl.searchParams.get('title') ?? undefined;
  const prompt = req.nextUrl.searchParams.get('prompt') ?? undefined;
  const r = await createBrainstormSession(title, prompt);
  const base = new URL(req.url);
  if (!r.ok) {
    return NextResponse.redirect(new URL('/studio/brainstorm', base));
  }
  return NextResponse.redirect(new URL(`/studio/brainstorm/${r.sessionId}`, base));
}
