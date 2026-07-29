export type Direction = 'higher_is_more_pressure' | 'higher_is_less_pressure' | 'neutral';
export type Status = 'published' | 'derived' | 'estimated';

export interface Metric {
  metric_id: string;
  name: string;
  unit: string;
  basis: string;
  direction: Direction;
  category: string;
  source_tier: 1 | 2 | 3;
  source_org: string;
  source_dataset: string | null;
  source_url: string | null;
  source_published: string | null;
  period: string | null;
}

export interface Entity { code: string; name: string; region: string | null; }

export interface Observation {
  metric_id: string;
  entity: string;
  entity_name: string;
  period: string;
  value: number;
  status: Status;
  unit: string;
  category: string;
}
