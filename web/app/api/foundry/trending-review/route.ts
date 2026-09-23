import { NextResponse } from 'next/server';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function loadReviewModule() {
  const candidates = [
    path.join(process.cwd(), '..', 'agent', 'scripts', 'lib', 'trending-review.mjs'),
    path.join(process.cwd(), 'agent', 'scripts', 'lib', 'trending-review.mjs'),
    path.join(process.cwd(), '.agent', 'scripts', 'lib', 'trending-review.mjs'),
  ];
  for (const p of candidates) {
    try {
      return await import(pathToFileURL(p).href);
    } catch {
      /* try next */
    }
  }
  throw new Error('trending-review.mjs not found — run from repo root or agent checkout');
}

export async function POST() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sse(event, data)));
      };

      try {
        send('status', { phase: 'start', message: 'Reviewing trending topics…' });
        const mod = await loadReviewModule();
        const result = await mod.runTrendingReview({
          quiet: true,
          onProgress: (msg: string) => send('log', { message: msg }),
        });
        send('done', {
          period_end: result.period_end,
          topics: result.topics,
          attached: result.attached,
          created: result.created,
          ignored: result.ignored,
          skipped: result.skipped,
          details: result.details ?? [],
        });
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

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'POST /api/foundry/trending-review' });
}
