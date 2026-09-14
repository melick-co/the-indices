import { isRunwayConfigured, pollRenders } from '@/lib/generate-runway';
import { RunwayConfigError } from '@/lib/runway-client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Poll open Runway tasks for this story. Runway has no webhook; GET /v1/tasks/{id}
 * is the completion model. Call this at least five seconds apart.
 */
export async function POST(
  _req: Request,
  { params }: { params: { slug: string } },
) {
  try {
    const renders = await pollRenders(params.slug);
    return Response.json({ configured: isRunwayConfigured(), renders });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = e instanceof RunwayConfigError ? 503 : 400;
    return Response.json({ configured: isRunwayConfigured(), message }, { status });
  }
}
