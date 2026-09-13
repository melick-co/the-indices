import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { normalizeMessages } from '@/lib/research-shared';

export const dynamic = 'force-dynamic';

/**
 * Fork a session into a new one.
 *
 * Two rules, both learned the hard way. The new session gets the whole
 * transcript, never a slice up to the branch point, so no answer is ever left
 * behind. And the source session is not written to at all: the fork records
 * where it came from on itself, and the parent resolves its branch chips by
 * reading its children.
 */
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
    answer: session.answer ?? null,
    inputs: session.inputs ?? [],
    messages,
    monitoring: {},
    parent_session_id: params.sessionId,
    fork_from_message_id: messageId,
    fork_branch_label: label,
  }).select('session_id').single();

  if (insertErr || !forked) {
    return NextResponse.json({ error: insertErr?.message ?? 'Fork failed' }, { status: 500 });
  }

  return NextResponse.json({
    newSessionId: forked.session_id,
    copiedMessages: messages.length,
  });
}
