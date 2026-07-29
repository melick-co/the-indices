import { Direction } from './types.js';

/**
 * Min-max normalisation against FIXED anchor bounds. Standard section 5.
 *
 * Bounds are fixed at index creation and never move with the sample. This is
 * what makes a change in score over time meaningful rather than merely relative.
 */
export function normalise(
  value: number,
  bounds: [number, number],
  direction: Direction
): { score: number; winsorised: boolean } {
  const [lo, hi] = bounds;
  if (hi <= lo) throw new Error(`Invalid bounds [${lo}, ${hi}]: upper must exceed lower`);

  const raw = ((value - lo) / (hi - lo)) * 100;
  const winsorised = raw < 0 || raw > 100;
  const clamped = Math.min(100, Math.max(0, raw));

  const score = direction === 'higher_is_more_pressure' ? clamped : 100 - clamped;
  return { score, winsorised };
}
