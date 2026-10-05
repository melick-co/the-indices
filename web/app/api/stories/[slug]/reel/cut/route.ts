import { loadReel } from '@/lib/generate-reel';
import { queueCut, updateCut } from '@/lib/reel-cut-ledger';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const WORKFLOW = 'agent.yml';

/**
 * Queue a cut. The render itself runs on the GitHub runner (agent.yml task reel-cut), so this
 * records a queued row and, when GITHUB_DISPATCH_TOKEN is set (a fine-grained token with Actions:
 * write on the repo), dispatches the workflow for this story. Without the token the row waits for
 * the task to be run by hand; the runner picks the row up either way.
 */
export async function POST(
  _req: Request,
  { params }: { params: { slug: string } },
) {
  try {
    const reel = await loadReel(params.slug, { allowDraft: true });
    if (!reel) return Response.json({ message: 'Write the script and storyboard first' }, { status: 400 });
    if (reel.stage === 'script') {
      return Response.json({ message: 'Draw the storyboard before cutting, so pictures and figures are locked' }, { status: 400 });
    }

    const row = await queueCut(params.slug, 'Queued from the reel page');
    revalidatePath(`/stories/${params.slug}/reel`);

    const token = process.env.GITHUB_DISPATCH_TOKEN?.trim();
    const repo = process.env.GITHUB_DISPATCH_REPO?.trim() || 'melick-co/the-indices';
    if (!token) {
      return Response.json({
        dispatched: false,
        render: row,
        message: `Queued. GITHUB_DISPATCH_TOKEN is not set, so run the reel-cut task in GitHub Actions with slug ${params.slug}.`,
      });
    }

    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'caveat-reel-cut',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main', inputs: { task: 'reel-cut', pitch: params.slug } }),
    });
    if (res.status !== 204) {
      const detail = (await res.text()).slice(0, 200);
      await updateCut(row.render_id, { status: 'failed', error: `GitHub refused the dispatch (${res.status}): ${detail}` });
      return Response.json({ dispatched: false, message: `GitHub refused the dispatch (${res.status})` }, { status: 502 });
    }
    return Response.json({ dispatched: true, render: row, message: 'Cut dispatched to the runner. It takes a few minutes.' });
  } catch (e) {
    return Response.json({ message: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
