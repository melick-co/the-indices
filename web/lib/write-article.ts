/** Shared SSE client for writing / publishing an approved pitch. */

export type WrittenArticle = {
  slug: string;
  title: string;
  storyUrl: string;
  previewUrl?: string;
  status?: string;
};

export async function writeArticleFromPitch(
  pitchId: string,
  onLog?: (message: string) => void,
): Promise<WrittenArticle> {
  const res = await fetch(`/api/foundry/pitch/${pitchId}/publish`, { method: 'POST' });
  if (!res.ok || !res.body) throw new Error(`Write failed (${res.status})`);
  return readSseResult(res, onLog);
}

export async function publishArticleFromPitch(pitchId: string): Promise<WrittenArticle> {
  const res = await fetch(`/api/foundry/pitch/${pitchId}/go-live`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Publish failed (${res.status})`);
  return data as WrittenArticle;
}

async function readSseResult(
  res: Response,
  onLog?: (message: string) => void,
): Promise<WrittenArticle> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let result: WrittenArticle | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const chunk of parts) {
      const ev = chunk.match(/^event: (\w+)\ndata: ([\s\S]+)/);
      if (!ev) continue;
      const [, event, raw] = ev;
      const data = JSON.parse(raw);
      if (event === 'log' || event === 'status') onLog?.(data.message);
      if (event === 'done') result = data as WrittenArticle;
      if (event === 'error') throw new Error(data.message);
    }
  }
  if (!result?.slug) throw new Error('Write finished without a story slug');
  return result;
}
