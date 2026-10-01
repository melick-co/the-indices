import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

/**
 * Web-sized encodes with ffmpeg (on the GitHub runner; see the articles job).
 * Generated media arrives large (a 2K hero PNG is ~7 MB, an 8s 1080p clip
 * ~23 MB); pages need a fraction of that. Without ffmpeg, the original is used.
 * FFMPEG_PATH points at the binary (the workflow installs ffmpeg-static,
 * because apt on the runners is unreliable); otherwise `ffmpeg` on PATH.
 */

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
export const WEB_WIDTH = 1600;

export async function hasFfmpeg(): Promise<boolean> {
  try { await run(FFMPEG, ['-version']); return true; } catch { return false; }
}

/** JPEG at WEB_WIDTH (quality ~85). Returns the original if ffmpeg is unavailable or fails. */
export async function webImage(input: Buffer, contentType: string): Promise<{ data: Buffer; contentType: string; ext: string }> {
  const fallbackExt = contentType.includes('jpeg') ? 'jpg' : contentType.includes('webp') ? 'webp' : 'png';
  if (!(await hasFfmpeg())) return { data: input, contentType, ext: fallbackExt };
  const dir = await mkdtemp(join(tmpdir(), 'webimg-'));
  try {
    const src = join(dir, `in.${fallbackExt}`);
    const out = join(dir, 'out.jpg');
    await writeFile(src, input);
    await run(FFMPEG, ['-y', '-i', src, '-vf', `scale='min(${WEB_WIDTH},iw)':-2`, '-q:v', '3', out]);
    return { data: await readFile(out), contentType: 'image/jpeg', ext: 'jpg' };
  } catch {
    return { data: input, contentType, ext: fallbackExt };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * H.264 MP4 at WEB_WIDTH with fast start, optionally muxing a voiceover
 * (padded with silence to the video's length, never cutting the picture).
 */
export async function webVideo(videoFile: string, audioFile: string | null, outFile: string): Promise<void> {
  // Pin the output to the picture's length. `apad` with `-shortest` alone produced a
  // 47-minute file (8s of video, endless silence) with a real voiceover.
  const length = await mediaDuration(videoFile);
  if (!(length > 0)) throw new Error(`could not read the clip's duration from ${videoFile}`);
  const args = ['-y', '-i', videoFile];
  if (audioFile) {
    args.push('-i', audioFile, '-map', '0:v:0', '-map', '1:a:0',
      '-af', `apad=whole_dur=${length.toFixed(3)}`, '-c:a', 'aac', '-b:a', '128k');
  } else {
    args.push('-an');
  }
  args.push('-t', length.toFixed(3), '-vf', `scale='min(${WEB_WIDTH},iw)':-2`, '-c:v', 'libx264', '-preset', 'veryfast',
    '-crf', '25', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outFile);
  await run(FFMPEG, args);
  const out = await mediaDuration(outFile);
  if (Math.abs(out - length) > 0.5) throw new Error(`encoded clip is ${out}s, expected ${length}s`);
}

/** Duration in seconds, read from ffmpeg's own stream info (no ffprobe needed). */
export async function mediaDuration(file: string): Promise<number> {
  // `ffmpeg -i <file>` with no output exits non-zero but prints the duration on stderr.
  const stderr = await run(FFMPEG, ['-hide_banner', '-i', file]).then((r) => r.stderr, (e) => String(e.stderr ?? ''));
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}
