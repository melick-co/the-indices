/**
 * Run all configured source watchers.
 * Used by GitHub Actions and manual invocations.
 *
 *   node scripts/load-sources.mjs              # ABS + World Bank + RBA
 *   node scripts/load-sources.mjs abs          # ABS only
 *   node scripts/load-sources.mjs wb           # World Bank only
 *   node scripts/load-sources.mjs rba          # RBA only
 *   node scripts/load-sources.mjs hot          # high-churn only (RBA + ABS + indicator)
 *   node scripts/load-sources.mjs all --revise # full load + overnight pitch follow-up
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import './lib/load-env.mjs';
import { loadRba } from './watch-rba.mjs';
import { loadAbs } from './watch-abs.mjs';
import { computeRbaIndicator } from './compute-rba-rate-indicator.mjs';
import { createDb } from './lib/obs-loader.mjs';
import { followActivePitches } from './lib/revise-pitches.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function run(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(here, script), ...args], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))));
  });
}

async function loadWb() {
  await run('watch-wb.mjs', ['load']);
  return { changedMetrics: [] };
}

const argv = process.argv.slice(2);
const target = argv.find((a) => !a.startsWith('--')) ?? 'all';
const shouldRevise = argv.includes('--revise');

async function main() {
  const changed = new Set();

  if (target === 'hot') {
    const db = createDb();
    for (const fn of [() => loadRba(db), () => loadAbs(db), () => computeRbaIndicator(db)]) {
      const r = await fn();
      for (const m of r.changedMetrics ?? []) changed.add(m);
    }
  } else {
    if (target === 'all' || target === 'abs') {
      const r = await loadAbs();
      for (const m of r.changedMetrics ?? []) changed.add(m);
    }
    if (target === 'all' || target === 'wb') await loadWb();
    if (target === 'all' || target === 'rba') {
      const db = createDb();
      const r = await loadRba(db);
      for (const m of r.changedMetrics ?? []) changed.add(m);
      const ind = await computeRbaIndicator(db);
      for (const m of ind.changedMetrics ?? []) changed.add(m);
    }
  }

  if (shouldRevise) {
    const db = createDb();
    console.log('\nFollowing active pitches to fresh data…');
    const revise = await followActivePitches(db, [...changed], (msg) => console.log(msg));
    console.log(`Revised ${revise.revised} pitch(es).`);
  }
}

if (!['all', 'abs', 'wb', 'rba', 'hot'].includes(target)) {
  console.log('Usage: node scripts/load-sources.mjs [all|abs|wb|rba|hot] [--revise]');
  process.exit(1);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
