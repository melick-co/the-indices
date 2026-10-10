/**
 * The Caveat house track: one original theme (made by scripts/house-track.ts, chosen by an editor) that every video
 * uses, in place of new music for each render. It lives in the visual-videos bucket at house/caveat-theme.mp3.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
