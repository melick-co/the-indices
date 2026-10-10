/**
 * Start a task on the GitHub runner (agent.yml) from the site, and read back recent runs. Needs GITHUB_DISPATCH_TOKEN
 * on the server: a fine-grained token with Actions read and write on the repository.
 */
const WORKFLOW = 'agent.yml';
const repo = () => process.env.GITHUB_DISPATCH_REPO?.trim() || 'melick-co/the-indices';
const token = () => process.env.GITHUB_DISPATCH_TOKEN?.trim() || null;

export const dispatchReady = () => !!token();

export async function dispatchTask(task: string, inputs: { pitch?: string; edits?: string } = {}): Promise<{ ok: boolean; message: string }> {
  const t = token();
  if (!t) return { ok: false, message: `Not sent: GITHUB_DISPATCH_TOKEN is not set on the server. Run the "${task}" task in GitHub Actions instead${inputs.pitch ? ` (pitch: ${inputs.pitch})` : ''}.` };
  const res = await fetch(`https://api.github.com/repos/${repo()}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, Accept: 'application/vnd.github+json', 'User-Agent': 'caveat-foundry', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main', inputs: { task, ...(inputs.pitch ? { pitch: inputs.pitch } : {}), ...(inputs.edits ? { edits: inputs.edits } : {}) } }),
  });
  if (res.status !== 204) return { ok: false, message: `GitHub refused it (${res.status}): ${(await res.text()).slice(0, 160)}` };
  return { ok: true, message: 'Started on the runner. It shows under Recent jobs in a few seconds.' };
}

export type RunSummary = { id: number; title: string; status: string; conclusion: string | null; created: string; url: string };

/** The latest runs of the workflow, newest first (titles come from the workflow's run-name: task and input). */
export async function recentRuns(limit = 12): Promise<RunSummary[]> {
  const t = token();
  if (!t) return [];
  const res = await fetch(`https://api.github.com/repos/${repo()}/actions/workflows/${WORKFLOW}/runs?per_page=${limit}`, {
    headers: { Authorization: `Bearer ${t}`, Accept: 'application/vnd.github+json', 'User-Agent': 'caveat-foundry' },
    cache: 'no-store',
  }).catch(() => null);
  if (!res?.ok) return [];
  const body = await res.json() as { workflow_runs?: { id: number; display_title: string; status: string; conclusion: string | null; created_at: string; html_url: string }[] };
  return (body.workflow_runs ?? []).map((r) => ({ id: r.id, title: r.display_title, status: r.status, conclusion: r.conclusion, created: r.created_at, url: r.html_url }));
}
