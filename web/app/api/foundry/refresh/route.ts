import { NextResponse } from 'next/server';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function loadRefreshModule() {
  const candidates = [
    path.join(process.cwd(), '..', 'agent', 'scripts', 'refresh-and-revise.mjs'),
    path.join(process.cwd(), 'agent', 'scripts', 'refresh-and-revise.mjs'),
    path.join(process.cwd(), '.agent', 'scripts', 'refresh-and-revise.mjs'),
  ];
  for (const p of candidates) {
    try {
      return await import(pathToFileURL(p).href);
    } catch {
      /* try next */
    }
  }
  throw new Error('refresh-and-revise.mjs not found — run from repo root or agent checkout');
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const forceAll = url.searchParams.get('force') === '1';

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sse(event, data)));
      };

      try {
        send('status', { phase: 'start', message: 'Starting hot refresh…' });
        const mod = await loadRefreshModule();
        const result = await mod.runRefreshPipeline({
          forceAll,
          quiet: true,
          onProgress: (msg: string) => send('log', { message: msg }),
        });
        send('done', {
          sources_changed: result.sources_changed,
          metrics_touched: result.metrics_touched,
          pitches_revised: result.pitches_revised,
          candidates_new: result.candidates_new,
          changedMetrics: result.changedMetrics,
          details: result.revise?.details ?? [],
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
  return NextResponse.json({ ok: true, endpoint: 'POST /api/foundry/refresh' });
}
