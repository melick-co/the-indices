import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Metric, IndexDefinition } from './types.js';

export function loadMetrics(dir = 'data/metrics'): Map<string, Metric> {
  const m = new Map<string, Metric>();
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const metric = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Metric;
    m.set(metric.metric_id, metric);
  }
  return m;
}

export function loadIndex(id: string, dir = 'indices'): IndexDefinition {
  return JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')) as IndexDefinition;
}

export function loadEntities(path = 'data/entities.json'): { code: string; name: string }[] {
  return JSON.parse(readFileSync(path, 'utf8')).entities;
}
