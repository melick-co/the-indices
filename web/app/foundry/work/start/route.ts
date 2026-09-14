import { NextRequest, NextResponse } from 'next/server';
import { createFoundrySession } from '../actions';

/**
 * GET used to create a session from query params. Next.js Link prefetch
 * (and crawlers) hit every in-viewport start URL, which dumped dozens of
 * empty drafts onto Work and buried sessions that actually had writing.
 */
export async function GET(req: NextRequest) {
  return NextResponse.redirect(new URL('/foundry/work', new URL(req.url)));
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const title = str(form.get('title'));
  const prompt = str(form.get('prompt')) ?? str(form.get('q'));
  const intentParam = str(form.get('intent'));
  const intent = (['investigate', 'brainstorm', 'refine', 'precedents'] as const)
    .includes(intentParam as 'investigate')
    ? (intentParam as 'investigate' | 'brainstorm' | 'refine' | 'precedents')
    : prompt?.toLowerCase().includes('brainstorm') ? 'brainstorm' as const : 'investigate' as const;

  const r = await createFoundrySession(title, prompt, intent);
  const base = new URL(req.url);
  if (!r.ok) {
    return NextResponse.redirect(new URL('/foundry/work', base));
  }
  return NextResponse.redirect(new URL(`/foundry/work/${r.sessionId}`, base), 303);
}

function str(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
