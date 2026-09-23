import type { StoryBody, StoryEvidence, StoryOneNumber } from '@/lib/story-types';

export type StructuredStory = {
  kicker: string;
  title: string;
  hook: string;
  caveat: string;
  one_number: StoryOneNumber;
  evidence: StoryEvidence;
  body: StoryBody;
  slug_hint: string;
  generation_note: string;
  frame_check: boolean;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Write a proper layered article from the approved brief when the research
 * model is unavailable. Does not invent chart numbers.
 */
export function articleFromApprovedPitch(pitch: Record<string, unknown>): StructuredStory {
  const title = asText(pitch.headline).slice(0, 120) || 'The frame does not survive the denominator';
  const hook = asText(pitch.hook) || title;
  const caveat = asText(pitch.caveat)
    || 'A hostile reader will ask which period, which basis, and which source carries the claim.';
  const mechanism = asText(pitch.mechanism);
  const chartHint = asText(pitch.chart_hint);
  const layers = (mechanism ? splitSentences(mechanism) : [])
    .slice(0, 5);
  if (layers.length < 2) {
    layers.push(
      'The familiar number is the one everyone quotes.',
      'The useful number is the one with a denominator, a period, and a named source.',
    );
  }

  const trigger = (pitch.trigger_rows ?? {}) as Record<string, unknown>;
  const named = trigger.one_number && typeof trigger.one_number === 'object'
    ? trigger.one_number as { value?: unknown; label?: unknown }
    : null;
  const oneNumber: StoryOneNumber = {
    value: asText(named?.value) || '-',
    label: asText(named?.label) || 'Named figure still to be confirmed from the evidence',
  };

  const opening = hook.endsWith('.') ? hook : `${hook}.`;
  const close = caveat.endsWith('.') ? caveat : `${caveat}.`;

  const blocks: StoryBody['blocks'] = [
    {
      type: 'paragraph',
      text: `${opening} That is the frame in circulation. It is tidy, it travels well, and it is usually missing the bit that changes the ranking.`,
    },
    { type: 'layers', items: layers },
    { type: 'heading', text: 'The corrected frame' },
    {
      type: 'paragraph',
      text: mechanism
        ? `${mechanism}${chartHint ? ` The chart that shows it is ${chartHint.replace(/\.$/, '')}, drawn only from figures that already sit in the evidence.` : ''} The sequence is the story: each layer should make the first number harder to keep.`
        : 'Each layer should make the first number harder to keep. If the ranking does not move when the base changes, this is not a Caveat piece yet.',
    },
    { type: 'pull', text: close },
    {
      type: 'paragraph',
      text: 'The published piece should leave a reader able to check the claim in one click. Edit the copy, pin the sources, then publish. Do not invent a figure to fill a hole.',
    },
  ];

  return {
    kicker: 'Approved · Frame check',
    title,
    hook,
    caveat,
    one_number: oneNumber,
    evidence: { sources: [] },
    body: { blocks },
    slug_hint: title,
    generation_note: 'Article written from the approved brief. Confirm every figure against tier 1/2 sources before publishing.',
    frame_check: true,
  };
}
