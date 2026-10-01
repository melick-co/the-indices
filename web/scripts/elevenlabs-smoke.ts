/**
 * Check the ElevenLabs integration end to end with small, cheap generations.
 *
 *   npx tsx --import ./scripts/node-shims.mjs scripts/elevenlabs-smoke.ts           # image + speech
 *   npx tsx --import ./scripts/node-shims.mjs scripts/elevenlabs-smoke.ts --video   # also a 4s video
 *
 * Confirms the API key, plan and permissions, the request shapes, and polling,
 * before the daily article job relies on them.
 */
import { createTextToImage, createVideo, narrationVoiceId, synthesizeSpeech, waitForTask } from '@/lib/elevenlabs-client';

async function main() {
  console.log('Image: Gemini 3 Pro Image, 1:1, 1K…');
  const img = await waitForTask(await createTextToImage({
    promptText: 'Editorial illustration of a single red umbrella on a quiet street, muted newsprint palette, no text.',
    ratio: '1:1', resolution: '1K',
  }));
  console.log(`  ${img.status} ${img.id} ${img.contentType ?? ''} ${img.output?.[0] ? 'url ok' : img.failure ?? ''}`);
  if (img.status !== 'SUCCEEDED') process.exitCode = 1;

  const voice = await narrationVoiceId();
  const audio = await synthesizeSpeech('Housing credit grew 7.3 per cent in the year to August.', voice);
  console.log(`Speech: voice ${voice}, ${audio.length} bytes of MP3`);
  if (audio.length < 1000) process.exitCode = 1;

  if (process.argv.includes('--video')) {
    console.log('Video: Veo 3.1 Fast, 4s, 16:9, 720p, from the image…');
    const vid = await waitForTask(await createVideo({
      promptText: 'Slow push-in, rain beginning to fall, calm.', duration: 4, ratio: '16:9', resolution: '720p',
      startFrame: img.status === 'SUCCEEDED' ? { type: 'generation', generation_id: img.id.replace(/^image:/, '') } : undefined,
    }), 10 * 60 * 1000);
    console.log(`  ${vid.status} ${vid.id} ${vid.output?.[0] ? 'url ok' : vid.failure ?? ''}`);
    if (vid.status !== 'SUCCEEDED') process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
