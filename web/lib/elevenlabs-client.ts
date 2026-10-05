import 'server-only';

/**
 * ElevenLabs media generation: images and video (Flows API, async) and speech.
 * Replaces Runway (Oct 2026). Needs ELEVENLABS_API_KEY with the Image & Video
 * (or Flows) permission on a Pro plan or above.
 *   https://elevenlabs.io/docs/eleven-api/guides/cookbooks/image-and-video
 *
 * The task helpers keep the shape the reel pipeline used with Runway
 * (createTextToImage / createImageToVideo / retrieveTask / isTerminalStatus),
 * so generate-runway.ts only swaps imports. Task ids carry their kind
 * ("image:<id>" / "video:<id>") because images and videos are fetched from
 * different endpoints.
 */

export const ELEVEN_API_BASE = 'https://api.elevenlabs.io';
export const ELEVEN_IMAGE_MODEL = 'gemini-3-pro-image';
export const ELEVEN_VIDEO_MODEL = 'veo-3.1-fast-generate-001';
export const ELEVEN_TTS_MODEL = 'eleven_multilingual_v2';
/** Veo clip lengths ElevenLabs accepts. */
const VIDEO_DURATIONS = [4, 6, 8];

export type MediaKind = 'image' | 'video';
export type MediaTaskStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

export type MediaTask = {
  /** "image:<generation id>" or "video:<generation id>" */
  id: string;
  status: MediaTaskStatus;
  output?: string[];
  contentType?: string;
  failure?: string;
};

export class MediaConfigError extends Error {
  constructor() {
    super('ELEVENLABS_API_KEY is not set. Add it to the Vercel project (and GitHub Actions secrets) to generate images, video and voiceover.');
    this.name = 'MediaConfigError';
  }
}

export class MediaApiError extends Error {
  status: number;
  constructor(status: number, body: string) {
    super(`ElevenLabs ${status}: ${body.slice(0, 300)}`);
    this.name = 'MediaApiError';
    this.status = status;
  }
}

export function getElevenApiKey(): string | null {
  return process.env.ELEVENLABS_API_KEY?.trim() || null;
}

export function isMediaConfigured(): boolean {
  return getElevenApiKey() !== null;
}

async function eleven(path: string, init: RequestInit = {}): Promise<Response> {
  const key = getElevenApiKey();
  if (!key) throw new MediaConfigError();
  return fetch(`${ELEVEN_API_BASE}${path}`, {
    ...init,
    headers: { 'xi-api-key': key, 'content-type': 'application/json', ...(init.headers ?? {}) },
    signal: init.signal ?? AbortSignal.timeout(120000),
  });
}

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) throw new MediaApiError(res.status, text || res.statusText);
  return JSON.parse(text) as T;
}

type Generation = {
  id: string;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  content_url?: string;
  content_mime_type?: string;
  failure_reason?: string;
  error_message?: string;
};

function toTask(kind: MediaKind, g: Generation): MediaTask {
  const status: MediaTaskStatus = g.status === 'completed' ? 'SUCCEEDED'
    : g.status === 'failed' ? 'FAILED'
      : g.status === 'generating' ? 'RUNNING' : 'PENDING';
  return {
    id: `${kind}:${g.id}`,
    status,
    output: g.content_url ? [g.content_url] : undefined,
    contentType: g.content_mime_type,
    failure: g.status === 'failed' ? `${g.failure_reason ?? 'failed'}: ${g.error_message ?? ''}`.trim() : undefined,
  };
}

/** Reel ratios were Runway pixel ratios ("1080:1920"); ElevenLabs takes aspect ratios. */
function aspectOf(ratio?: string): string {
  if (!ratio) return '9:16';
  const [w, h] = ratio.split(':').map(Number);
  if (!w || !h) return ratio;
  return w > h ? '16:9' : w < h ? '9:16' : '1:1';
}

export function clipDuration(seconds: number): number {
  const n = Number(seconds) || 8;
  return VIDEO_DURATIONS.reduce((best, d) => (Math.abs(d - n) < Math.abs(best - n) ? d : best), 8);
}

export type ImageRef =
  | { type: 'generation'; generation_id: string }
  | { type: 'inline_base64'; content_base64: string; mime_type: string };

/** A public image URL as an inline reference (ElevenLabs does not fetch URLs). */
export async function imageRefFromUrl(url: string): Promise<ImageRef> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new MediaApiError(res.status, `could not fetch reference image ${url}`);
  const mime = res.headers.get('content-type')?.split(';')[0] ?? 'image/png';
  return { type: 'inline_base64', content_base64: Buffer.from(await res.arrayBuffer()).toString('base64'), mime_type: mime };
}

export async function createTextToImage(opts: {
  promptText: string;
  ratio?: string;
  resolution?: string;
  seed?: number;
}): Promise<MediaTask> {
  const g = await json<Generation>(await eleven('/v1/flows/image', {
    method: 'POST',
    body: JSON.stringify({
      model_id: ELEVEN_IMAGE_MODEL,
      prompt: opts.promptText,
      aspect_ratio: aspectOf(opts.ratio),
      resolution: opts.resolution ?? '2K',
      ...(typeof opts.seed === 'number' ? { seed: opts.seed } : {}),
    }),
  }));
  return toTask('image', g);
}

export async function createVideo(opts: {
  promptText: string;
  duration: number;
  ratio?: string;
  resolution?: string;
  startFrame?: ImageRef;
  generateAudio?: boolean;
}): Promise<MediaTask> {
  const g = await json<Generation>(await eleven('/v1/flows/video', {
    method: 'POST',
    body: JSON.stringify({
      model_id: ELEVEN_VIDEO_MODEL,
      prompt: opts.promptText,
      duration_secs: clipDuration(opts.duration),
      aspect_ratio: aspectOf(opts.ratio),
      resolution: opts.resolution ?? '720p',
      generate_audio: opts.generateAudio ?? false,
      ...(opts.startFrame ? { start_frame: opts.startFrame } : {}),
    }),
  }));
  return toTask('video', g);
}

/** Reel pipeline: animate a stored still. */
export async function createImageToVideo(opts: { promptText: string; promptImage: string; duration: number }): Promise<MediaTask> {
  return createVideo({ promptText: opts.promptText, duration: opts.duration, startFrame: await imageRefFromUrl(opts.promptImage) });
}

/** Reel pipeline: video from text alone. */
export async function createTextToVideo(opts: { promptText: string; duration: number }): Promise<MediaTask> {
  return createVideo({ promptText: opts.promptText, duration: opts.duration });
}

export async function retrieveTask(id: string): Promise<MediaTask> {
  const [kind, gid] = id.includes(':') ? id.split(':', 2) as [MediaKind, string] : ['image', id] as [MediaKind, string];
  return toTask(kind, await json<Generation>(await eleven(`/v1/flows/${kind}/${gid}`, { method: 'GET' })));
}

export function isTerminalStatus(status: MediaTaskStatus): boolean {
  return status === 'SUCCEEDED' || status === 'FAILED';
}

/** Poll until done: images every 3s, video every 10s (ElevenLabs' guidance), up to a timeout. */
export async function waitForTask(task: MediaTask, timeoutMs = 6 * 60 * 1000): Promise<MediaTask> {
  const every = task.id.startsWith('video:') ? 10000 : 3000;
  const started = Date.now();
  let t = task;
  while (!isTerminalStatus(t.status)) {
    if (Date.now() - started > timeoutMs) return { ...t, status: 'FAILED', failure: 'timed out waiting for ElevenLabs' };
    await new Promise((r) => setTimeout(r, every));
    t = await retrieveTask(t.id);
  }
  return t;
}

// ---------- speech ----------

type Voice = { voice_id: string; name: string; category?: string; labels?: Record<string, string> };

/**
 * Narration voice: ELEVENLABS_VOICE_ID if set, otherwise a premade voice,
 * preferring an Australian accent and a narration or news use case.
 */
export async function narrationVoiceId(): Promise<string> {
  const fixed = process.env.ELEVENLABS_VOICE_ID?.trim();
  if (fixed) return fixed;
  const { voices } = await json<{ voices: Voice[] }>(await eleven('/v1/voices', { method: 'GET' }));
  const score = (v: Voice) => {
    const l = Object.values(v.labels ?? {}).join(' ').toLowerCase();
    return (l.includes('australian') ? 4 : 0) + (/narrat|news|informative/.test(l) ? 2 : 0) + (v.category === 'premade' ? 1 : 0);
  };
  const best = [...(voices ?? [])].sort((a, b) => score(b) - score(a))[0];
  if (!best) throw new MediaApiError(404, 'no voices available on this ElevenLabs account');
  return best.voice_id;
}

/**
 * MP3 narration for a short script, with the characters ElevenLabs billed for it: the
 * `character-cost` response header when present, else the text's own length (one credit a
 * character on the multilingual v2 model).
 */
export async function synthesizeSpeechWithCost(
  text: string,
  voiceId?: string,
): Promise<{ audio: Buffer; characters: number; voiceId: string }> {
  const voice = voiceId ?? await narrationVoiceId();
  const res = await eleven(`/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: ELEVEN_TTS_MODEL }),
  });
  if (!res.ok) throw new MediaApiError(res.status, await res.text());
  const billed = Number(res.headers.get('character-cost'));
  return {
    audio: Buffer.from(await res.arrayBuffer()),
    characters: Number.isFinite(billed) && billed > 0 ? billed : text.length,
    voiceId: voice,
  };
}

/** MP3 narration for a short script. */
export async function synthesizeSpeech(text: string, voiceId?: string): Promise<Buffer> {
  return (await synthesizeSpeechWithCost(text, voiceId)).audio;
}
