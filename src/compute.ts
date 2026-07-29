import { IndexDefinition, Metric, IndexResult, ComponentResult } from './types.js';
import { normalise } from './normalise.js';

/** Standard section 7.2: coverage thresholds. */
export const MIN_COMPONENTS = 3;
export const MIN_WEIGHT_COVERAGE = 0.75;

/**
 * Compute an index score for one entity.
 *
 * Implements Standard sections 5 (normalisation), 6 (weighting) and 7 (coverage).
 * Missing values are NEVER imputed - an entity is either scored from observed
 * data or reported as insufficient coverage.
 */
export function computeIndex(
  def: IndexDefinition,
  metrics: Map<string, Metric>,
  entity: string
): IndexResult {
  const totalWeight = def.components.reduce((s, c) => s + c.weight, 0);
  const parts: ComponentResult[] = [];
  let presentWeight = 0;

  for (const comp of def.components) {
    const metric = metrics.get(comp.metric_id);
    if (!metric) throw new Error(`Metric not loaded: ${comp.metric_id}`);

    const obs = metric.observations.find((o) => o.entity === entity);
    if (!obs) {
      parts.push({ metric_id: comp.metric_id, label: comp.label, raw: null,
        normalised: null, weight: 0, status: null, winsorised: false });
      continue;
    }

    const { score, winsorised } = normalise(obs.value, comp.bounds, metric.direction);
    presentWeight += comp.weight;
    parts.push({ metric_id: comp.metric_id, label: comp.label, raw: obs.value,
      normalised: score, weight: comp.weight, status: obs.status, winsorised });
  }

  const present = parts.filter((p) => p.normalised !== null);
  const coverage = (presentWeight / totalWeight) * 100;

  if (present.length < MIN_COMPONENTS || presentWeight / totalWeight < MIN_WEIGHT_COVERAGE) {
    return { entity, index_id: def.index_id, vintage: def.vintage, score: null,
      coverage, scored: false,
      reason: `Insufficient coverage: ${present.length}/${def.components.length} components, `
            + `${coverage.toFixed(1)}% of weight`,
      components: parts };
  }

  // Section 7.2: rescale present weights to sum to 1.000
  let score = 0;
  for (const p of present) {
    p.weight = p.weight / presentWeight;
    score += p.normalised! * p.weight;
  }

  return { entity, index_id: def.index_id, vintage: def.vintage,
    score, coverage, scored: true, components: parts };
}

/** Compute for every entity, sorted by score descending. */
export function computeAll(
  def: IndexDefinition,
  metrics: Map<string, Metric>,
  entities: string[]
): IndexResult[] {
  return entities
    .map((e) => computeIndex(def, metrics, e))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}
