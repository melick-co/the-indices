/**
 * Fundamentals-based hike pressure at the next RBA meeting.
 * Derived from tier 1/2 inputs — not a market forecast.
 */

const TARGET_MID = 2.5;
const TARGET_BAND = 0.5;

/**
 * @param {{ cashRate: number, cpi: number, creditGrowth12m?: number | null }} inputs
 * @returns {{ hike: number, hold: number, cut: number, score: number, components: Record<string, number> }}
 */
export function fundamentalsProbabilities(inputs) {
  const { cashRate, cpi, creditGrowth12m } = inputs;
  const realRate = cashRate - cpi;
  const inflationGap = (cpi - TARGET_MID) / TARGET_BAND;
  const realRateGap = (1.0 - realRate) / 2.5;
  const creditSignal = creditGrowth12m != null ? (creditGrowth12m - 5) / 8 : 0;

  const score =
    0.45 * inflationGap +
    0.35 * realRateGap +
    0.20 * creditSignal;

  const pHike = sigmoid(score * 1.4);
  const pCut = sigmoid(-score * 1.4) * 0.35;
  const pHold = Math.max(0, 1 - pHike - pCut);
  const norm = pHike + pHold + pCut || 1;

  return {
    hike: roundPct((pHike / norm) * 100),
    hold: roundPct((pHold / norm) * 100),
    cut: roundPct((pCut / norm) * 100),
    score: round(score, 3),
    components: {
      inflation_gap: round(inflationGap, 3),
      real_rate: round(realRate, 3),
      real_rate_gap: round(realRateGap, 3),
      credit_growth_12m: creditGrowth12m ?? null,
      credit_signal: round(creditSignal, 3),
    },
  };
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function round(n, d = 1) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function roundPct(n) {
  return Math.round(n * 10) / 10;
}
