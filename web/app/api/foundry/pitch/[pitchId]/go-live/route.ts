import { goLiveFromPitch } from '@/lib/generate-story';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';
// The publish gate runs the strict check (claim audit included) when the draft has not passed it yet.
export const maxDuration = 300;

/** Promote a draft story to published, if it passes the publish gate (lib/publish-gate.ts). */
export async function POST(
  _req: Request,
  { params }: { params: { pitchId: string } },
) {
  try {
    const result = await goLiveFromPitch(params.pitchId);
    revalidatePath('/');
    revalidatePath(`/stories/${result.slug}`);
    revalidatePath(`/evidence/${result.slug}`);
    revalidatePath(`/foundry/desk/${result.slug}`);
    revalidatePath('/foundry/desk');
    revalidatePath('/foundry');
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { message: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
