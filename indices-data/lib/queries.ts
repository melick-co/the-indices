import { createClient } from './supabase.js';
import type { Metric, Entity, Observation } from './types.js';

/**
 * Data access for charting. Every function is dataset-agnostic: charts are
 * driven by metric_id, so the same code renders migration, tax, housing, etc.
 */

export async function listMetrics(category?: string): Promise<Metric[]> {
  const supabase = createClient();
  let q = supabase.from('metrics').select('*').order('category').order('name');
  if (category) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) throw error;
  return data as Metric[];
}

export async function listEntities(): Promise<Entity[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('entities').select('*').order('name');
  if (error) throw error;
  return data as Entity[];
}

/** Cross-country snapshot for one metric at its latest period. Bar / choropleth. */
export async function crossSection(metricId: string, period?: string): Promise<Observation[]> {
  const supabase = createClient();
  let q = supabase.from('observations_labelled').select('*').eq('metric_id', metricId);
  if (period) q = q.eq('period', period);
  const { data, error } = await q.order('value', { ascending: false });
  if (error) throw error;
  return data as Observation[];
}

/** Time series for one metric across selected entities. Line chart. */
export async function timeSeries(metricId: string, entities?: string[]): Promise<Observation[]> {
  const supabase = createClient();
  let q = supabase.from('observations_labelled').select('*').eq('metric_id', metricId);
  if (entities?.length) q = q.in('entity', entities);
  const { data, error } = await q.order('entity').order('period');
  if (error) throw error;
  return data as Observation[];
}

/** Every metric for one entity - the country profile / scorecard source. */
export async function entityProfile(entity: string): Promise<Observation[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('observations_labelled').select('*').eq('entity', entity).order('category');
  if (error) throw error;
  return data as Observation[];
}
