import 'server-only';

/**
 * Server-only Runway Dev API client.
 *
 * Current contract (https://docs.dev.runwayml.com, X-Runway-Version 2024-11-06):
 *   POST https://api.dev.runwayml.com/v1/text_to_image
 *   POST https://api.dev.runwayml.com/v1/image_to_video
 *   POST https://api.dev.runwayml.com/v1/text_to_video
 *   GET  https://api.dev.runwayml.com/v1/tasks/{id}
 *
 * Auth: Bearer RUNWAYML_API_SECRET (official) or RUNWAY_API_KEY.
 * Tasks are asynchronous. There is no webhook; poll GET /v1/tasks/{id}
 * no more than once every five seconds until SUCCEEDED or FAILED.
 * Output URLs expire in 24-48 hours and must be copied to our storage.
 */

export const RUNWAY_API_BASE = 'https://api.dev.runwayml.com';
export const RUNWAY_VERSION = '2024-11-06';

export const RUNWAY_IMAGE_MODEL = 'gen4_image';
export const RUNWAY_IMAGE_RATIO = '1080:1920';
export const RUNWAY_VIDEO_MODEL = 'gen4.5';
export const RUNWAY_VIDEO_RATIO = '720:1280';

export const RUNWAY_PROMPT_MAX = 1000;

export type RunwayEndpoint = 'text_to_image' | 'image_to_video' | 'text_to_video';

export type RunwayTaskStatus =
  | 'PENDING'
  | 'THROTTLED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'CANCELED';

export type RunwayTask = {
  id: string;
  createdAt?: string;
  status: RunwayTaskStatus;
  progress?: number;
  output?: string[];
  failure?: string;
  failureCode?: string;
  estimatedCost?: { credits: number };
};

export class RunwayConfigError extends Error {
  constructor() {
    super(
      'Runway is not configured. Set RUNWAY_API_KEY or RUNWAYML_API_SECRET on the server (Vercel env, never NEXT_PUBLIC_). Create a key at https://dev.runwayml.com',
    );
    this.name = 'RunwayConfigError';
  }
}

export class RunwayApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Runway ${status}: ${body.slice(0, 280)}`);
    this.name = 'RunwayApiError';
    this.status = status;
    this.body = body;
  }
}

/** Official docs use RUNWAYML_API_SECRET; RUNWAY_API_KEY is accepted as an alias. */
export function getRunwayApiKey(): string | null {
  const key = process.env.RUNWAYML_API_SECRET?.trim() || process.env.RUNWAY_API_KEY?.trim();
  return key || null;
}

export function isRunwayConfigured(): boolean {
  return Boolean(getRunwayApiKey());
}

function requireKey(): string {
  const key = getRunwayApiKey();
  if (!key) throw new RunwayConfigError();
  return key;
}

async function runwayFetch(path: string, init?: RequestInit): Promise<Response> {
  const key = requireKey();
  return fetch(`${RUNWAY_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      'X-Runway-Version': RUNWAY_VERSION,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) throw new RunwayApiError(res.status, text || res.statusText);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new RunwayApiError(res.status, text || 'Runway returned a non-JSON body');
  }
}

export function clipRunwayDuration(seconds: number): number {
  const n = Math.round(Number(seconds) || 5);
  return Math.min(10, Math.max(2, n));
}

export async function createTextToImage(opts: {
  promptText: string;
  seed?: number;
}): Promise<RunwayTask> {
  return readJson<RunwayTask>(
    await runwayFetch('/v1/text_to_image', {
      method: 'POST',
      body: JSON.stringify({
        model: RUNWAY_IMAGE_MODEL,
        promptText: opts.promptText,
        ratio: RUNWAY_IMAGE_RATIO,
        ...(typeof opts.seed === 'number' ? { seed: opts.seed } : {}),
      }),
    }),
  );
}

export async function createImageToVideo(opts: {
  promptText: string;
  promptImage: string;
  duration: number;
  seed?: number;
}): Promise<RunwayTask> {
  return readJson<RunwayTask>(
    await runwayFetch('/v1/image_to_video', {
      method: 'POST',
      body: JSON.stringify({
        model: RUNWAY_VIDEO_MODEL,
        promptText: opts.promptText,
        promptImage: opts.promptImage,
        ratio: RUNWAY_VIDEO_RATIO,
        duration: clipRunwayDuration(opts.duration),
        outputFormat: 'mp4',
        ...(typeof opts.seed === 'number' ? { seed: opts.seed } : {}),
      }),
    }),
  );
}

export async function createTextToVideo(opts: {
  promptText: string;
  duration: number;
  seed?: number;
}): Promise<RunwayTask> {
  return readJson<RunwayTask>(
    await runwayFetch('/v1/text_to_video', {
      method: 'POST',
      body: JSON.stringify({
        model: RUNWAY_VIDEO_MODEL,
        promptText: opts.promptText,
        ratio: RUNWAY_VIDEO_RATIO,
        duration: clipRunwayDuration(opts.duration),
        outputFormat: 'mp4',
        ...(typeof opts.seed === 'number' ? { seed: opts.seed } : {}),
      }),
    }),
  );
}

export async function retrieveTask(id: string): Promise<RunwayTask> {
  return readJson<RunwayTask>(await runwayFetch(`/v1/tasks/${id}`, { method: 'GET' }));
}

export function isTerminalStatus(status: RunwayTaskStatus): boolean {
  return status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELLED' || status === 'CANCELED';
}
