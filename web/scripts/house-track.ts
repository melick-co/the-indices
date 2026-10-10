/**
 * The Caveat house track: one original theme, in the manner of a broadcast news countdown (a steady ticking pulse,
 * a rising build, a clean final hit), generated with ElevenLabs Music (cleared for commercial use) and reused on
 * every video instead of new music per render.
 *
 *   npx tsx --import ./scripts/node-shims.mjs scripts/house-track.ts            # three candidates to choose from
 *   HOUSE_TRACK_COUNT=1 ... house-track.ts                                       # one
 *
 * Candidates go to the visual-videos bucket under house/candidates/ and their links are printed. The chosen one is
 * then copied to house/caveat-theme.mp3 (see --choose).
 *   ... house-track.ts --choose=<n>                                              # make candidate n the house track
 */
import { createClient } from '@/lib/supabase-server';
import { ELEVEN_API_BASE } from '@/lib/elevenlabs-client';

const BUCKET = 'visual-videos';
const SECONDS = 60;
const PROMPT = [
  'Original theme music for a data-journalism news channel, in the manner of a broadcast news countdown.',
  'A steady ticking clock pulse runs through the whole piece at about 120 BPM, precise and insistent.',
  'Over it, layered synth strings, deep timpani and low percussion build steadily in tension;',
  'short, punchy brass-like synth stabs land on the downbeats; urgent but measured and authoritative, modern, clean mix.',
  'It rises to a decisive final hit and a clean ending. Instrumental only, no vocals. Entirely original melody and motif.',
].join(' ');

async function generate(n: number): Promise<Buffer> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('No ELEVENLABS_API_KEY.');
  const res = await fetch(`${ELEVEN_API_BASE}/v1/music`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ prompt: PROMPT, music_length_ms: SECONDS * 1000, model_id: 'music_v1' }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok) throw new Error(`Candidate ${n}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const db = createClient();
  const choose = process.argv.find((a) => a.startsWith('--choose='))?.slice(9) ?? process.env.HOUSE_TRACK_CHOOSE?.trim();
  if (choose) {
    const from = `house/candidates/theme-${choose}.mp3`;
    const { data, error } = await db.storage.from(BUCKET).download(from);
    if (error || !data) throw new Error(`No candidate ${choose}: ${error?.message}`);
    const { error: up } = await db.storage.from(BUCKET).upload('house/caveat-theme.mp3', Buffer.from(await data.arrayBuffer()), { contentType: 'audio/mpeg', upsert: true });
    if (up) throw new Error(up.message);
    console.log(`Candidate ${choose} is now the house track: ${db.storage.from(BUCKET).getPublicUrl('house/caveat-theme.mp3').data.publicUrl}`);
    return;
  }
  const count = Number(process.env.HOUSE_TRACK_COUNT ?? 3);
  for (let n = 1; n <= count; n++) {
    const audio = await generate(n);
    const path = `house/candidates/theme-${n}.mp3`;
    const { error } = await db.storage.from(BUCKET).upload(path, audio, { contentType: 'audio/mpeg', upsert: true });
    if (error) throw new Error(`upload ${path}: ${error.message}`);
    console.log(`Candidate ${n} (${(audio.length / 1e6).toFixed(1)} MB): ${db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl}?v=${Date.now()}`);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
