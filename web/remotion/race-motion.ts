import type { Race } from '../lib/visuals-race';

/**
 * Smooth motion for a bar race. Time runs at a constant speed; each entity's value follows a monotone cubic through
 * its yearly values (Fritsch–Carlson tangents: smooth through every year, never overshooting between them), so numbers
 * grow continuously across the whole timeline rather than easing in and out each year.
 */
export type Curves = Record<string, (s: number) => number | null>;

export function curves(race: Race): Curves {
  const n = race.frames.length;
  const keys = [...new Set(race.frames.flatMap((f) => Object.keys(f.values)))];
  const out: Curves = {};
  for (const k of keys) {
    const y = race.frames.map((f) => (k in f.values ? f.values[k] : null));
    // Tangents per point, over runs of consecutive known values.
    const m: (number | null)[] = new Array(n).fill(null);
    const d = (i: number) => (y[i] != null && y[i + 1] != null ? y[i + 1]! - y[i]! : null);
    for (let i = 0; i < n; i++) {
      if (y[i] == null) continue;
      const a = i > 0 ? d(i - 1) : null, b = i < n - 1 ? d(i) : null;
      if (a == null && b == null) m[i] = 0;
      else if (a == null) m[i] = b;
      else if (b == null) m[i] = a;
      else m[i] = a * b <= 0 ? 0 : (2 * a * b) / (a + b); // harmonic mean: monotone, no overshoot
    }
    out[k] = (s: number) => {
      const i = Math.min(n - 2, Math.max(0, Math.floor(s)));
      const t = Math.min(1, Math.max(0, s - i));
      const y0 = y[i], y1 = y[i + 1];
      if (y0 == null && y1 == null) return null;
      if (y0 == null) return t >= 1 ? y1 : null; // not yet reported: appears when its data starts
      if (y1 == null) return t <= 0 ? y0 : null; // no longer reported
      const m0 = m[i] ?? 0, m1 = m[i + 1] ?? 0;
      const t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * m1;
    };
  }
  return out;
}

/** Values at time s, and each entity's place (0 = first) among those with a value. */
export function standings(c: Curves, s: number): { k: string; v: number; rank: number }[] {
  return Object.entries(c)
    .map(([k, f]) => ({ k, v: f(s) }))
    .filter((x): x is { k: string; v: number } => x.v != null && x.v > 0)
    .sort((a, b) => b.v - a.v)
    .map((x, rank) => ({ ...x, rank }));
}

/**
 * Bar positions: the average rank over the last `window` frames, so an overtaking bar glides into its new place over
 * about a quarter of a second instead of jumping. Entities not ranked in a frame count as just below the visible slots.
 */
export function glidingRanks(c: Curves, sAt: (frame: number) => number, frame: number, slots: number, window = 8): Record<string, number> {
  const sums: Record<string, number> = {};
  for (let j = 0; j < window; j++) {
    const ranks = Object.fromEntries(standings(c, sAt(Math.max(0, frame - j))).map((x) => [x.k, x.rank]));
    for (const k of Object.keys(c)) sums[k] = (sums[k] ?? 0) + (k in ranks ? Math.min(ranks[k], slots + 1) : slots + 1);
  }
  return Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, v / window]));
}
