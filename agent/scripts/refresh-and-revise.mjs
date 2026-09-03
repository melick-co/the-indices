/**
 * Hot refresh + pitch revision pipeline.
 * Used by Foundry refresh button, overnight CI, and manual CLI.
 *
 *   node scripts/refresh-and-revise.mjs           # load hot sources + revise affected pitches
 *   node scripts/refresh-and-revise.mjs --revise-only --metrics=a,b  # skip load, revise only
 *   node scripts/refresh-and-revise.mjs --force   # revise all active pitches after load
 */
import { createDb } from './lib/obs-loader.mjs';
import { loadHotSources } from './lib/hot-sources.mjs';
import { revisePitches, followActivePitches } from './lib/revise-pitches.mjs';
import { runDetectors } from './detectors.mjs';
import './lib/load-env.mjs';

function parseArgs(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const metricsArg = argv.find((a) => a.startsWith('--metrics='));
  return {
    reviseOnly: flags.has('--revise-only'),
    forceAll: flags.has('--force'),
    json: flags.has('--json'),
    overnight: flags.has('--overnight'),
    metrics: metricsArg ? metricsArg.slice('--metrics='.length).split(',').filter(Boolean) : [],
  };
}

async function detectNew(db) {
  const { data: obs } = await db.from('observations')
    .select('metric_id, entity, period, value, status').limit(10000);
  const { data: mets } = await db.from('metrics').select('metric_id, name, direction');
  const metricsById = new Map((mets ?? []).map((m) => [m.metric_id, m]));
  const cands = runDetectors(obs ?? [], metricsById);
  let inserted = 0;
  for (const c of cands) {
    const { count } = await db.from('pitches')
      .select('*', { count: 'exact', head: true })
      .contains('trigger_rows', { fingerprint: c.fingerprint });
    if ((count ?? 0) > 0) continue;
    const { error } = await db.from('pitches').insert({
      headline: c.headline, detector: c.detector,
      trigger_rows: { ...c.trigger_rows, fingerprint: c.fingerprint },
      metric_ids: c.metric_ids, state: 'candidate',
    });
    if (!error) inserted++;
  }
  return inserted;
}

export async function runRefreshPipeline(opts = {}) {
  const db = createDb();
  const log = [];
  const emit = (msg) => {
    log.push(msg);
    if (!opts.quiet) console.log(msg);
    opts.onProgress?.(msg);
  };

  let changedMetrics = opts.metrics ?? [];
  let sourcesChanged = 0;

  if (!opts.reviseOnly) {
    emit('Pulling high-churn sources (RBA, ABS, rate indicator)…');
    const load = await loadHotSources(db);
    sourcesChanged = load.totalNew;
    changedMetrics = [...new Set([...changedMetrics, ...load.changedMetrics])];
    for (const line of load.log) emit(line);
  }

  const newCandidates = await detectNew(db);
  if (newCandidates) emit(`${newCandidates} new detector candidate(s).`);

  emit(`Metrics touched: ${changedMetrics.length ? changedMetrics.join(', ') : '(none)'}`);

  const reviseFn = opts.overnight ? followActivePitches : revisePitches;
  const revise = await reviseFn(db, {
    changedMetrics,
    forceAll: opts.forceAll,
    onProgress: emit,
  });

  const run = {
    sources_changed: sourcesChanged,
    metrics_touched: changedMetrics.length,
    candidates_new: newCandidates,
    pitches_revised: revise.revised,
    notes: log.join('\n'),
  };

  await db.from('agent_runs').insert({
    sources_changed: sourcesChanged,
    candidates: newCandidates,
    pitched: revise.revised,
    resurfaced: 0,
    quiet_day: revise.revised === 0 && newCandidates === 0,
    notes: `refresh: ${run.notes.slice(0, 2000)}`,
  });

  return { ...run, revise, log, changedMetrics };
}

const args = parseArgs(process.argv.slice(2));
const isMain = process.argv[1]?.endsWith('refresh-and-revise.mjs');

if (isMain) {
  runRefreshPipeline({
    reviseOnly: args.reviseOnly,
    forceAll: args.forceAll,
    overnight: args.overnight,
    metrics: args.metrics,
    quiet: args.json,
  }).then((result) => {
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else console.log('\nDone.', result);
  }).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
