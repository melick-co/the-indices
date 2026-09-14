import { generateVideoStage } from '@/lib/generate-reel';
import { isVideoStage, type VideoStage } from '@/lib/reel-types';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function requestedStage(req: Request): Promise<VideoStage> {
  try {
    const body = await req.json();
    if (body && isVideoStage(body.stage)) return body.stage;
  } catch {
    // Body-less POST still starts the pipeline at the script.
  }
  return 'script';
}

const STATUS: Record<VideoStage, string> = {
  script: 'Writing the script…',
  storyboard: 'Drawing the storyboard…',
  prompts: 'Building the prompt pack…',
};

/** Generate one stage of the video pipeline: script, then storyboard, then prompt pack. */
export async function POST(
  req: Request,
  { params }: { params: { slug: string } },
) {
  const stage = await requestedStage(req);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sse(event, data)));
      };

      try {
        send('status', { message: STATUS[stage], stage });
        const result = await generateVideoStage(params.slug, stage, (message) => {
          send('log', { message, stage });
        });
        revalidatePath(`/stories/${params.slug}/reel`);
        revalidatePath(`/stories/${params.slug}`);
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
