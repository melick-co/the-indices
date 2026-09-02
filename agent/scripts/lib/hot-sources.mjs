/**
 * Load high-churn sources only — RBA tables, ABS CPI/WPI, RBA rate indicator.
 * Skips World Bank (annual, unlikely to change overnight).
 */
import { createDb } from './obs-loader.mjs';
import { loadRba } from '../watch-rba.mjs';
import { loadAbs } from '../watch-abs.mjs';
import { computeRbaIndicator } from '../compute-rba-rate-indicator.mjs';

export async function loadHotSources(db = createDb()) {
  const log = [];
  const changed = new Set();
  let totalNew = 0;

  const steps = [
    { name: 'RBA statistical tables', fn: () => loadRba(db) },
    { name: 'ABS CPI / WPI', fn: () => loadAbs(db) },
    { name: 'RBA rate indicator', fn: () => computeRbaIndicator(db) },
  ];

  for (const step of steps) {
    try {
      log.push(`Loading ${step.name}…`);
      const result = await step.fn();
      totalNew += result.totalNew ?? 0;
      for (const m of result.changedMetrics ?? []) changed.add(m);
      log.push(`  ${step.name}: ${result.summary ?? 'done'}`);
    } catch (e) {
      log.push(`  ${step.name}: FAILED — ${e.message}`);
      console.error(`${step.name}:`, e.message);
    }
  }

  return {
    totalNew,
    changedMetrics: [...changed],
    log,
  };
}
