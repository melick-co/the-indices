import { NextRequest, NextResponse } from 'next/server';
import { createBrainstormSession } from '../actions';

export async function GET(req: NextRequest) {
  return NextResponse.redirect(new URL('/foundry/work', new URL(req.url)));
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const title = typeof form.get('title') === 'string' ? String(form.get('title')).trim() || undefined : undefined;
  const prompt = typeof form.get('prompt') === 'string' ? String(form.get('prompt')).trim() || undefined : undefined;
  const r = await createBrainstormSession(title, prompt);
  const base = new URL(req.url);
  if (!r.ok) {
    return NextResponse.redirect(new URL('/foundry/work', base));
  }
  return NextResponse.redirect(new URL(`/foundry/work/${r.sessionId}`, base), 303);
}
