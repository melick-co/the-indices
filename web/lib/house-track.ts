/**
 * The Caveat house track: one original theme (made by scripts/house-track.ts, chosen by an editor) that every video
 * uses, in place of new music for each render. It lives in the visual-videos bucket at house/caveat-theme.mp3.
 */
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { mediaDuration } from '@/lib/media-encode';

export const HOUSE_TRACK_PATH = 'house/caveat-theme.mp3';

/** Put the house track in `publicDir` as `file` and return that name, or null if no track has been chosen yet. */
export async function fetchHouseTrack(publicDir: string, file = 'house-track.mp3'): Promise<string | null> {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!base) return null;
  try {
    const res = await fetch(`${base}/storage/v1/object/public/visual-videos/${HOUSE_TRACK_PATH}`, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return null;
    await writeFile(join(publicDir, file), Buffer.from(await res.arrayBuffer()));
    return file;
  } catch {
    return null;
  }
}

/** Seconds each repeat of the theme overlaps the next, so a longer video never hears the track restart. */
const CROSSFADE_SECONDS = 4;

/**
 * The house track at least `minSeconds` long: the theme crossfaded into itself as many times as it takes, with a
 * fade-out at the end. A 68-second reel otherwise looped the 45-second theme and the restart was audible. Falls
 * back to the plain track (which the composition loops) when ffmpeg cannot do it.
 */
export async function houseTrackFor(minSeconds: number, publicDir: string, file = 'house-track.mp3'): Promise<string | null> {
  const got = await fetchHouseTrack(publicDir, file);
  if (!got) return null;
  const secs = await mediaDuration(join(publicDir, got)).catch(() => 0);
  if (!(secs > CROSSFADE_SECONDS * 2) || secs >= minSeconds) return got;
  const copies = Math.ceil((minSeconds - CROSSFADE_SECONDS) / (secs - CROSSFADE_SECONDS));
  const length = copies * secs - (copies - 1) * CROSSFADE_SECONDS;
  const chain: string[] = [];
  let last = '[0:a]';
  for (let i = 1; i < copies; i++) {
    const out = i === copies - 1 ? '[joined]' : `[x${i}]`;
    chain.push(`${last}[${i}:a]acrossfade=d=${CROSSFADE_SECONDS}:c1=qsin:c2=qsin${out}`);
    last = out;
  }
  if (copies === 1) chain.push('[0:a]anull[joined]');
  chain.push(`[joined]afade=t=out:st=${Math.max(0, length - 3).toFixed(2)}:d=3[out]`);
  const long = `long-${file}`;
  try {
    await promisify(execFile)(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-y', '-loglevel', 'error',
      ...Array.from({ length: copies }, () => ['-i', join(publicDir, got)]).flat(),
      '-filter_complex', chain.join(';'), '-map', '[out]', '-c:a', 'libmp3lame', '-b:a', '192k', join(publicDir, long),
    ]);
    return long;
  } catch {
    return got;
  }
}
