import { markReelReady } from '@/lib/generate-reel';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';

/** Mark a draft reel ready to hand to the video generator. */
export async function POST(
  _req: Request,
  { params }: { params: { slug: string } },
) {
  try {
    const result = await markReelReady(params.slug);
    revalidatePath(`/stories/${params.slug}/reel`);
    revalidatePath('/foundry');
    revalidatePath('/studio');
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { message: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
