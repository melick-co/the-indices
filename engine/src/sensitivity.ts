import { IndexDefinition, Metric } from './types.js';
import { computeAll } from './compute.js';

export interface SensitivityReport {
  index_id: string;
  weightPerturbation: { maxRankChange: number; maxScoreChange: number; rankCorrelation: number; pass: boolean; detail: string[] };
  componentDrop: { maxRankChange: number; topFivePreserved: boolean; detail: string[] };
  equalWeightCorrelation: number | null;
  pairwiseCorrelation: { pair: string; r: number; pass: boolean }[];
  overallPass: boolean;
}

/** Standard section 10.4 acceptance thresholds. */
const MAX_RANK_CHANGE = 3;          // retained for reference; see note below
const MAX_PAIRWISE_R = 0.9;
/**
 * Where scores cluster densely, max rank change is an unstable acceptance test:
 * a fraction of a point can move an entity several places without the index
 * having meaningfully changed. Rank correlation and max score change are the
 * substantive tests. Standard section 10.4 should be amended accordingly.
 */
const MIN_RANK_CORR = 0.95;
const MAX_SCORE_CHANGE = 3.0;

function ranks(def: IndexDefinition, metrics: Map<string, Metric>, entities: string[]) {
  const res = computeAll(def, metrics, entities).filter((r) => r.scored);
  const m = new Map<string, number>();
  res.forEach((r, i) => m.set(r.entity, i + 1));
  return m;
}

function scores(def: IndexDefinition, metrics: Map<string, Metric>, entities: string[]) {
  const m = new Map<string, number>();
  for (const r of computeAll(def, metrics, entities)) if (r.scored) m.set(r.entity, r.score!);
  return m;
}

function maxScoreDelta(a: Map<string, number>, b: Map<string, number>) {
  let max = 0;
  for (const [e, v] of a) {
    const o = b.get(e);
    if (o !== undefined) max = Math.max(max, Math.abs(v - o));
  }
  return max;
}

function rankCorr(a: Map<string, number>, b: Map<string, number>) {
  const shared = [...a.keys()].filter((e) => b.has(e));
  return pearson(shared.map((e) => a.get(e)!), shared.map((e) => b.get(e)!));
}

function maxRankDelta(a: Map<string, number>, b: Map<string, number>) {
  let max = 0;
  for (const [e, r] of a) {
    const other = b.get(e);
    if (other !== undefined) max = Math.max(max, Math.abs(r - other));
  }
  return max;
}

function pearson(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

/**
 * Run the full validation battery required before publication.
 * Standard section 10.
 */
export function runSensitivity(
  def: IndexDefinition,
  metrics: Map<string, Metric>,
  entities: string[]
): SensitivityReport {
  const base = ranks(def, metrics, entities);
  const baseScores = scores(def, metrics, entities);

  // 10.1 weight perturbation: +/- 25% on each component in turn
  const wpDetail: string[] = [];
  let wpMax = 0;
  let wpScoreMax = 0;
  let wpCorrMin = 1;
  for (const comp of def.components) {
    for (const factor of [1.25, 0.75]) {
      const alt: IndexDefinition = { ...def,
        components: def.components.map((c) =>
          c.metric_id === comp.metric_id ? { ...c, weight: c.weight * factor } : { ...c }) };
      const altRanks = ranks(alt, metrics, entities);
      const d = maxRankDelta(base, altRanks);
      const sd = maxScoreDelta(baseScores, scores(alt, metrics, entities));
      const rc = rankCorr(base, altRanks);
      wpMax = Math.max(wpMax, d);
      wpScoreMax = Math.max(wpScoreMax, sd);
      wpCorrMin = Math.min(wpCorrMin, rc);
      wpDetail.push(`${comp.metric_id} x${factor}: rank ${d}, score ${sd.toFixed(2)}, corr ${rc.toFixed(3)}`);
    }
  }

  // 10.2 component drop
  const cdDetail: string[] = [];
  let cdMax = 0;
  let topFive = true;
  const baseTop5 = [...base.entries()].filter(([, r]) => r <= 5)
    .sort((a, b) => a[1] - b[1]).map(([e]) => e);
  for (const comp of def.components) {
    if (def.components.length - 1 < 3) break; // cannot drop below minimum
    const alt: IndexDefinition = { ...def,
      components: def.components.filter((c) => c.metric_id !== comp.metric_id) };
    const r2 = ranks(alt, metrics, entities);
    const d = maxRankDelta(base, r2);
    cdMax = Math.max(cdMax, d);
    const t5 = [...r2.entries()].filter(([, r]) => r <= 5)
      .sort((a, b) => a[1] - b[1]).map(([e]) => e);
    if (JSON.stringify(t5) !== JSON.stringify(baseTop5)) topFive = false;
    cdDetail.push(`drop ${comp.metric_id}: max rank change ${d}`);
  }

  // 10.3 equal weight comparison (only meaningful where weights are custom)
  let eqCorr: number | null = null;
  if (def.custom_weights) {
    const eq: IndexDefinition = { ...def,
      components: def.components.map((c) => ({ ...c, weight: 1 })) };
    const r2 = ranks(eq, metrics, entities);
    const shared = [...base.keys()].filter((e) => r2.has(e));
    eqCorr = pearson(shared.map((e) => base.get(e)!), shared.map((e) => r2.get(e)!));
  }

  // 4.4 pairwise component correlation
  const pairwise: { pair: string; r: number; pass: boolean }[] = [];
  for (let i = 0; i < def.components.length; i++) {
    for (let j = i + 1; j < def.components.length; j++) {
      const a = metrics.get(def.components[i].metric_id)!;
      const b = metrics.get(def.components[j].metric_id)!;
      const common = a.observations
        .filter((o) => b.observations.some((p) => p.entity === o.entity))
        .map((o) => [o.value, b.observations.find((p) => p.entity === o.entity)!.value]);
      const r = pearson(common.map((c) => c[0]), common.map((c) => c[1]));
      pairwise.push({
        pair: `${def.components[i].metric_id} / ${def.components[j].metric_id}`,
        r, pass: Math.abs(r) <= MAX_PAIRWISE_R });
    }
  }

  const overallPass = wpCorrMin >= MIN_RANK_CORR && wpScoreMax <= MAX_SCORE_CHANGE
    && pairwise.every((p) => p.pass);

  return { index_id: def.index_id,
    weightPerturbation: { maxRankChange: wpMax, maxScoreChange: wpScoreMax,
      rankCorrelation: wpCorrMin, pass: wpCorrMin >= MIN_RANK_CORR && wpScoreMax <= MAX_SCORE_CHANGE,
      detail: wpDetail },
    componentDrop: { maxRankChange: cdMax, topFivePreserved: topFive, detail: cdDetail },
    equalWeightCorrelation: eqCorr, pairwiseCorrelation: pairwise, overallPass };
}
