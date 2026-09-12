import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { runFoundryTurn, scoreFoundryTurn } from '@/lib/foundry-agent';
import {
  buildInputPrompt,
  newMessage,
  normalizeMessages,
  parseVerdict,
  type FoundryIntent,
  type FoundryMessage,
} from '@/lib/research-shared';
import type { SessionInput } from '@/lib/research-shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { sessionId: string } },
) {
  const body = await req.json().catch(() => ({}));
  const followUp = String(body.prompt ?? body.followUp ?? '').trim();
  const intent = (['investigate', 'brainstorm', 'refine', 'precedents'] as const)
    .includes(body.intent)
    ? body.intent as FoundryIntent
    : 'investigate';

  const supabase = createClient();
  const { data: session, error: loadErr } = await supabase.from('research_sessions')
    .select('*').eq('session_id', params.sessionId).single();
  if (loadErr || !session) {
    return new Response(JSON.stringify({ error: 'Session not found' }), { status: 404 });
  }

  const inputs = (session.inputs ?? []) as SessionInput[];
  const priorMessages = normalizeMessages(session.messages);
  const basePrompt = buildInputPrompt(session.question ?? '', inputs);
  const userPrompt = followUp || basePrompt;
  if (!userPrompt.trim()) {
    return new Response(JSON.stringify({ error: 'Add a prompt before running.' }), { status: 400 });
  }

  await supabase.from('research_sessions').update({
    status: 'running',
    intent: intent,
    updated_at: new Date().toISOString(),
  }).eq('session_id', params.sessionId);

  // The editor can interrupt a run. Closing the stream aborts the agent loop so
  // we neither keep spending on the API nor save a half-finished turn.
  const interrupt = new AbortController();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (interrupt.signal.aborted) return;
        controller.enqueue(encoder.encode(sse(event, data)));
      };

      const phase = (id: string, status: 'running' | 'done') => {
        send('phase', { id, status });
      };

      try {
        const userMsg = newMessage('user', followUp || basePrompt, { intent });
        const toolSteps: FoundryMessage['tool_steps'] = [];
        let assistantText = '';
        const usage = { input_tokens: 0, output_tokens: 0 };

        phase('context', 'running');
        phase('context', 'done');
        phase('research', 'running');

        const { text, toolsUsed } = await runFoundryTurn({
          intent,
          userPrompt,
          priorMessages: priorMessages.filter((m) => m.role !== 'system'),
          onEvent: (ev) => {
            if (ev.type === 'tool_start') {
              toolSteps.push({
                id: ev.id,
                name: ev.name,
                label: ev.label,
                detail: ev.detail,
                at: ev.at,
                status: 'running',
              });
              send('tool_start', ev);
            } else if (ev.type === 'tool_result') {
              const step = toolSteps.find((s) => (ev.id ? s.id === ev.id : s.name === ev.name));
              if (step) {
                step.status = 'done';
                step.result = ev.detail;
                step.ms = ev.ms;
              }
              send('tool_result', ev);
            } else if (ev.type === 'usage') {
              usage.input_tokens += ev.input_tokens;
              usage.output_tokens += ev.output_tokens;
              send('usage', usage);
            } else if (ev.type === 'text_delta') {
              assistantText += ev.delta;
              send('text_delta', ev);
            }
          },
          signal: interrupt.signal,
        });

        phase('research', 'done');
        phase('score', 'running');

        const meta = await scoreFoundryTurn(intent, userPrompt, text);
        phase('score', 'done');
        send('score', {
          score: meta.score,
          rank_value: meta.rank_value,
          verdict: meta.verdict,
        });
        send('follow_ups', { items: meta.follow_ups });
        if (meta.branches.length) send('branches', { items: meta.branches });

        const suggestionIds: string[] = [];
        for (const sug of meta.source_suggestions) {
          const { data: row } = await supabase.from('source_suggestions').insert({
            session_id: params.sessionId,
            action: sug.action,
            payload: sug.payload ?? {},
            summary: sug.summary,
            status: 'pending',
          }).select('suggestion_id').single();
          if (row?.suggestion_id) suggestionIds.push(row.suggestion_id);
        }
        if (suggestionIds.length) {
          send('source_suggestions', {
            items: meta.source_suggestions.map((s, i) => ({
              id: suggestionIds[i],
              action: s.action,
              summary: s.summary,
            })),
          });
        }

        const assistantMsg = newMessage('assistant', text, {
          tool_steps: toolSteps,
          follow_ups: meta.follow_ups,
          score: { ...meta.score, rank_value: meta.rank_value },
          verdict: meta.verdict as FoundryMessage['verdict'],
          branches: meta.branches,
          usage,
        });

        const messages: FoundryMessage[] = [
          ...priorMessages,
          userMsg,
          assistantMsg,
        ];

        phase('save', 'running');
        await supabase.from('research_sessions').update({
          messages,
          answer: text,
          verdict: parseVerdict(text) ?? meta.verdict ?? null,
          tools_used: [...new Set([...(session.tools_used ?? []), ...toolsUsed])],
          status: 'complete',
          updated_at: new Date().toISOString(),
        }).eq('session_id', params.sessionId);

        phase('save', 'done');
        send('done', { messageId: assistantMsg.id });
      } catch (e: unknown) {
        const interrupted = interrupt.signal.aborted
          || (e instanceof Error && e.name === 'AbortError');
        if (!interrupted) {
          send('error', { message: e instanceof Error ? e.message : 'Run failed' });
        }
        await supabase.from('research_sessions').update({
          status: 'complete',
          updated_at: new Date().toISOString(),
        }).eq('session_id', params.sessionId);
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed by the interrupt */
        }
      }
    },
    cancel() {
      interrupt.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
