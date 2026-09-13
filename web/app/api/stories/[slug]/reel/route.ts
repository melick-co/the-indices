import { generateReelForStory } from '@/lib/generate-reel';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Generate or regenerate a draft reel brief from a story. Streams progress. */
export async function POST(
  _req: Request,
  { params }: { params: { slug: string } },
) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sse(event, data)));
      };

      try {
        send('status', { message: 'Cutting reel…' });
        const result = await generateReelForStory(params.slug, (message) => {
          send('log', { message });
        });
        revalidatePath(`/stories/${params.slug}/reel`);
        revalidatePath('/foundry');
        revalidatePath('/studio');
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
