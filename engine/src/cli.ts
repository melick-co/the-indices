#!/usr/bin/env node
import { loadMetrics, loadIndex, loadEntities } from './load.js';
import { computeAll } from './compute.js';
import { runSensitivity } from './sensitivity.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const [, , cmd, indexId = 'hsi'] = process.argv;

const metrics = loadMetrics();
const def = loadIndex(indexId);
const entities = loadEntities();
const codes = entities.map((e) => e.code);
const nameOf = new Map(entities.map((e) => [e.code, e.name]));

function table() {
  const results = computeAll(def, metrics, codes);
  console.log(`\n${def.name} (${def.index_id.toUpperCase()})  vintage ${def.vintage}`);
  console.log(`${def.concept}`);
  console.log('Higher score = greater pressure. Standard v1.0.\n');
  console.log('Rank  Entity                Score   Coverage  Note');
  console.log('-'.repeat(64));
  let rank = 0;
  for (const r of results) {
    if (r.scored) {
      rank++;
      const flag = r.components.some((c) => c.winsorised) ? ' winsorised' : '';
      const est = r.components.some((c) => c.status === 'estimated') ? ' est' : '';
      console.log(
        `${String(rank).padStart(4)}  ${(nameOf.get(r.entity) ?? r.entity).padEnd(20)} ` +
        `${r.score!.toFixed(1).padStart(5)}   ${r.coverage.toFixed(0).padStart(5)}%${flag}${est}`
      );
    }
  }
  const unscored = results.filter((r) => !r.scored);
  if (unscored.length) {
    console.log(`\nInsufficient coverage (not scored, not imputed): ` +
      unscored.map((r) => nameOf.get(r.entity) ?? r.entity).join(', '));
  }
}

function detail(entity: string) {
  const r = computeAll(def, metrics, [entity])[0];
  console.log(`\n${def.name} - ${nameOf.get(entity) ?? entity}  vintage ${def.vintage}\n`);
  console.log('Component                              Raw     Bounds        Norm   Weight');
  console.log('-'.repeat(78));
  for (const c of r.components) {
    const comp = def.components.find((x) => x.metric_id === c.metric_id)!;
    const m = metrics.get(c.metric_id)!;
    const inv = m.direction === 'higher_is_less_pressure' ? ' (inv)' : '';
    console.log(
      `${c.label.padEnd(36)} ${(c.raw ?? 'n/a').toString().padStart(7)}  ` +
      `[${comp.bounds[0]}, ${comp.bounds[1]}]`.padEnd(13) +
      ` ${(c.normalised?.toFixed(1) ?? 'n/a').padStart(5)}${inv.padEnd(6)} ${c.weight.toFixed(3)}`
    );
  }
  console.log('-'.repeat(78));
  console.log(`${'SCORE'.padEnd(36)} ${(r.score?.toFixed(1) ?? 'not scored').padStart(7)}` +
              `   coverage ${r.coverage.toFixed(0)}%`);
}

function sensitivity() {
  const rep = runSensitivity(def, metrics, codes);
  console.log(`\nSensitivity report - ${def.name} ${def.vintage}\n`);
  console.log(`Weight perturbation  rank corr ${rep.weightPerturbation.rankCorrelation.toFixed(3)}  ` +
    `max score change ${rep.weightPerturbation.maxScoreChange.toFixed(2)}  ` +
    `max rank change ${rep.weightPerturbation.maxRankChange}  ` +
    `${rep.weightPerturbation.pass ? 'PASS' : 'FAIL'}`);
  console.log(`Component drop       max rank change ${rep.componentDrop.maxRankChange}  ` +
    `top five preserved: ${rep.componentDrop.topFivePreserved ? 'yes' : 'no'}`);
  if (rep.equalWeightCorrelation !== null)
    console.log(`Equal weight corr    ${rep.equalWeightCorrelation.toFixed(3)}`);
  console.log('\nPairwise component correlation:');
  for (const p of rep.pairwiseCorrelation)
    console.log(`  ${p.r >= 0 ? ' ' : ''}${p.r.toFixed(3)}  ${p.pass ? 'ok  ' : 'FAIL'}  ${p.pair}`);
  console.log(`\nOverall: ${rep.overallPass ? 'PASS' : 'REVIEW REQUIRED'}`);
}

function publish() {
  const results = computeAll(def, metrics, codes);
  mkdirSync('dist/published', { recursive: true });
  const payload = {
    index: { id: def.index_id, name: def.name, concept: def.concept, vintage: def.vintage,
      direction: 'higher_is_more_pressure', scale: '0-100' },
    methodology: { components: def.components, normalisation: 'min-max against fixed bounds',
      weighting: def.custom_weights ? 'custom' : 'equal',
      standard: 'Composite Index Construction Standard v1.0' },
    sources: [...metrics.values()].map((m) => ({ metric_id: m.metric_id, definition: m.definition,
      unit: m.unit, basis: m.basis, source: m.source })),
    results: results.map((r) => ({ entity: r.entity, name: nameOf.get(r.entity),
      score: r.score === null ? null : Number(r.score.toFixed(1)),
      coverage: Number(r.coverage.toFixed(1)), scored: r.scored, reason: r.reason,
      components: r.components })),
    sensitivity: runSensitivity(def, metrics, codes),
    generated_at: new Date().toISOString()
  };
  writeFileSync(`dist/published/${def.index_id}-${def.vintage}.json`, JSON.stringify(payload, null, 2));

  const rows = ['entity,name,score,coverage,scored'];
  for (const r of results)
    rows.push(`${r.entity},"${nameOf.get(r.entity)}",${r.score?.toFixed(1) ?? ''},` +
              `${r.coverage.toFixed(1)},${r.scored}`);
  writeFileSync(`dist/published/${def.index_id}-${def.vintage}.csv`, rows.join('\n'));
  console.log(`Published dist/published/${def.index_id}-${def.vintage}.{json,csv}`);
}

switch (cmd) {
  case 'table': table(); break;
  case 'detail': detail(process.argv[4] ?? 'AUS'); break;
  case 'sensitivity': sensitivity(); break;
  case 'publish': publish(); break;
  default:
    console.log('Usage: indices <table|detail|sensitivity|publish> [indexId] [entity]');
    console.log('  npm run table');
    console.log('  npm run detail            # defaults to hsi AUS');
    console.log('  npm run sensitivity');
    console.log('  npm run publish');
}
