import { isMediaConfigured, pollRenders } from '@/lib/generate-runway';
import { MediaConfigError } from '@/lib/elevenlabs-client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Poll open ElevenLabs generations for this story (GET /v1/flows/{image|video}/{id}).
 * Call this at least five seconds apart.
 */
export async function POST(
  _req: Request,
  { params }: { params: { slug: string } },
) {
  try {
    const renders = await pollRenders(params.slug);
    return Response.json({ configured: isMediaConfigured(), renders });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = e instanceof MediaConfigError ? 503 : 400;
    return Response.json({ configured: isMediaConfigured(), message }, { status });
  }
}
