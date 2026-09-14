export type SessionListRow = {
  session_id: string;
  title: string | null;
  question: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  linked_pitch: string | null;
  monitoring: Record<string, unknown> | null;
  intent?: string | null;
  parent_session_id?: string | null;
  fork_from_message_id?: string | null;
  turnCount: number;
  hasWork: boolean;
};

export type RawSessionRow = {
  session_id: string;
  title: string | null;
  question: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  linked_pitch: string | null;
  monitoring: Record<string, unknown> | null;
  intent?: string | null;
  parent_session_id?: string | null;
  fork_from_message_id?: string | null;
  answer?: string | null;
  messages?: unknown;
};

function assistantTurns(messages: unknown): number {
  if (!Array.isArray(messages)) return 0;
  return messages.filter((m) => (
    m && typeof m === 'object' && (m as { role?: string }).role === 'assistant'
  )).length;
}

export function summarizeSession(raw: RawSessionRow): SessionListRow {
  const turnCount = assistantTurns(raw.messages);
  return {
    session_id: raw.session_id,
    title: raw.title,
    question: raw.question,
    status: raw.status,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    linked_pitch: raw.linked_pitch,
    monitoring: raw.monitoring,
    intent: raw.intent,
    parent_session_id: raw.parent_session_id,
    fork_from_message_id: raw.fork_from_message_id,
    turnCount,
    hasWork: turnCount > 0 || Boolean(raw.answer) || Boolean(raw.linked_pitch),
  };
}

export function mergeSessions(groups: Array<RawSessionRow[] | null | undefined>): SessionListRow[] {
  const map = new Map<string, SessionListRow>();
  for (const group of groups) {
    for (const raw of group ?? []) {
      const next = summarizeSession(raw);
      const prev = map.get(next.session_id);
      if (!prev || next.turnCount > prev.turnCount) map.set(next.session_id, next);
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.hasWork !== b.hasWork) return a.hasWork ? -1 : 1;
    return +new Date(b.updated_at) - +new Date(a.updated_at);
  });
}
