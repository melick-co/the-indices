import { publishStoryFromPitch } from '@/lib/generate-story';
import type { FoundryEvent } from '@/lib/foundry-agent';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(
  _req: Request,
  { params }: { params: { pitchId: string } },
) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sse(event, data)));
      };

      const onEvent = (ev: FoundryEvent) => {
        if (ev.type === 'tool_start') {
          send('log', { message: ev.label, phase: ev.name });
        } else if (ev.type === 'tool_result') {
          send('log', { message: ev.label, detail: ev.detail });
        } else if (ev.type === 'text_delta') {
          send('research', { delta: ev.delta });
        }
      };

      try {
        send('status', { phase: 'start', message: 'Generating story…' });
        const result = await publishStoryFromPitch(params.pitchId, onEvent);
        revalidatePath('/');
        revalidatePath(`/stories/${result.slug}`);
        revalidatePath(`/evidence/${result.slug}`);
        revalidatePath('/foundry');
        send('done', result);
      } catch (e) {
        send('error', { message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
