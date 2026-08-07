/** Core types for the index engine. Mirrors the Composite Index Construction Standard v1.0. */

export type Direction = 'higher_is_more_pressure' | 'higher_is_less_pressure';
export type Status = 'published' | 'derived' | 'estimated';
export type Tier = 1 | 2 | 3;

/** A single observation, per Standard section 8 (provenance). */
export interface Observation {
  entity: string;      // ISO-3166 alpha-3
  period: string;      // reference period of the observation, not retrieval date
  value: number;
  status: Status;
}

export interface Source {
  org: string;
  dataset: string;
  tier: Tier;
  url: string;
  published: string;
  period: string;
}

/** A metric file: one series with its definition, basis and source. */
export interface Metric {
  metric_id: string;
  definition: string;
  unit: string;
  basis: string;
  direction: Direction;
  source: Source;
  observations: Observation[];
}

/** A component of an index: a metric reference plus its bounds and weight. */
export interface Component {
  metric_id: string;
  label: string;
  /** Fixed anchor bounds. Standard section 5.3 - set once, do not move with the sample. */
  bounds: [number, number];
  weight: number;
}

export interface IndexDefinition {
  index_id: string;
  name: string;
  concept: string;
  vintage: string;
  components: Component[];
  custom_weights?: boolean;
  weight_justification?: string;
}

export interface ComponentResult {
  metric_id: string;
  label: string;
  raw: number | null;
  normalised: number | null;
  weight: number;
  status: Status | null;
  winsorised: boolean;
}

export interface IndexResult {
  entity: string;
  index_id: string;
  vintage: string;
  score: number | null;
  /** Percentage of total index weight represented by observed data. Section 7.3. */
  coverage: number;
  scored: boolean;
  reason?: string;
  components: ComponentResult[];
}
