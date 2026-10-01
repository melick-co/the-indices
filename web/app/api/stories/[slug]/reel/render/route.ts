import { isMediaConfigured, listRenders, startRenders } from '@/lib/generate-runway';
import { isRenderKind } from '@/lib/reel-render-types';
import { MediaConfigError } from '@/lib/elevenlabs-client';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function jsonError(e: unknown, fallback = 400) {
  const message = e instanceof Error ? e.message : String(e);
  const status = e instanceof MediaConfigError ? 503 : fallback;
  return Response.json({ message, configured: isMediaConfigured() }, { status });
}

/** Latest ElevenLabs jobs for this story, plus whether the server has a key. */
export async function GET(
  _req: Request,
  { params }: { params: { slug: string } },
) {
  try {
    const renders = await listRenders(params.slug);
    return Response.json({ configured: isMediaConfigured(), renders });
  } catch (e) {
    return jsonError(e);
  }
}

/**
 * Start ElevenLabs generation. Body: { scope: 'scene' | 'reel', sceneId?, kind? }.
 * kind auto (default) stills a scene then animates it; chart scenes prefer an
 * animated chart from the locked series.
 */
export async function POST(
  req: Request,
  { params }: { params: { slug: string } },
) {
  try {
    const body = await req.json().catch(() => ({}));
    const scope = body?.scope === 'reel' ? 'reel' : 'scene';
    const kind = (isRenderKind(body?.kind) || body?.kind === 'auto') ? body.kind : 'auto';
    const sceneId = typeof body?.sceneId === 'string' ? body.sceneId : undefined;
    if (scope === 'scene' && !sceneId) {
      return Response.json({ message: 'sceneId is required for a per-scene render' }, { status: 400 });
    }
    const renders = await startRenders(params.slug, { scope, sceneId, kind });
    revalidatePath(`/stories/${params.slug}/reel`);
    return Response.json({ configured: true, renders });
  } catch (e) {
    return jsonError(e);
  }
}
