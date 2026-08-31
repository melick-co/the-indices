import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { normalizeMessages } from '@/lib/research-shared';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { sessionId: string } },
) {
  const body = await req.json().catch(() => ({}));
  const messageId = body.messageId ? String(body.messageId) : null;
  const title = body.title ? String(body.title).trim() : null;
  const label = body.label ? String(body.label).trim() : null;

  const supabase = createClient();
  const { data: session, error } = await supabase.from('research_sessions')
    .select('*').eq('session_id', params.sessionId).single();
  if (error || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const messages = normalizeMessages(session.messages);
  let copyMessages = messages;
  if (messageId) {
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx >= 0) copyMessages = messages.slice(0, idx + 1);
  }

  const forkTitle = title || label || `${session.title ?? 'Session'} (fork)`;
  const seedPrompt = label
    ? `Explore this branch separately: ${label}`
    : session.question ?? '';

  const { data: forked, error: insertErr } = await supabase.from('research_sessions').insert({
    mode: 'foundry',
    intent: session.intent ?? 'refine',
    status: 'draft',
    title: forkTitle,
    question: seedPrompt,
    answer: null,
    inputs: session.inputs ?? [],
    messages: copyMessages,
    monitoring: {},
    parent_session_id: params.sessionId,
    fork_from_message_id: messageId,
  }).select('session_id').single();

  if (insertErr || !forked) {
    return NextResponse.json({ error: insertErr?.message ?? 'Fork failed' }, { status: 500 });
  }

  if (messageId && label) {
    const updated = messages.map((m) => {
      if (m.id !== messageId) return m;
      const branches = [...(m.branches ?? [])];
      const existing = branches.find((b) => b.label === label);
      if (existing) {
        existing.fork_session_id = forked.session_id;
      } else {
        branches.push({ id: crypto.randomUUID(), label, fork_session_id: forked.session_id });
      }
      return { ...m, branches };
    });
    await supabase.from('research_sessions').update({
      messages: updated,
      updated_at: new Date().toISOString(),
    }).eq('session_id', params.sessionId);
  }

  return NextResponse.json({ newSessionId: forked.session_id });
}
