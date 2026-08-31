import { NextRequest, NextResponse } from 'next/server';
import { createFoundrySession } from '../actions';

/** Create a foundry session from query params and redirect into the chat workspace. */
export async function GET(req: NextRequest) {
  const title = req.nextUrl.searchParams.get('title') ?? undefined;
  const prompt = req.nextUrl.searchParams.get('prompt') ?? req.nextUrl.searchParams.get('q') ?? undefined;
  const intentParam = req.nextUrl.searchParams.get('intent');
  const intent = (['investigate', 'brainstorm', 'refine', 'precedents'] as const)
    .includes(intentParam as 'investigate')
    ? (intentParam as 'investigate' | 'brainstorm' | 'refine' | 'precedents')
    : prompt?.toLowerCase().includes('brainstorm') ? 'brainstorm' as const : 'investigate' as const;

  const r = await createFoundrySession(title, prompt, intent);
  const base = new URL(req.url);
  if (!r.ok) {
    return NextResponse.redirect(new URL('/foundry/work', base));
  }
  return NextResponse.redirect(new URL(`/foundry/work/${r.sessionId}`, base));
}
