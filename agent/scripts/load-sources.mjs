/**
 * Run all configured source watchers.
 * Used by GitHub Actions and manual invocations.
 *
 *   node scripts/load-sources.mjs          # ABS + World Bank + RBA
 *   node scripts/load-sources.mjs abs    # ABS only
 *   node scripts/load-sources.mjs wb     # World Bank only
 *   node scripts/load-sources.mjs rba    # RBA only
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import './lib/load-env.mjs';

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

const target = process.argv[2] ?? 'all';
const tasks = [];

if (target === 'all' || target === 'abs') tasks.push(() => run('watch-abs.mjs', ['load']));
if (target === 'all' || target === 'wb') tasks.push(() => run('watch-wb.mjs', ['load']));
if (target === 'all' || target === 'rba') tasks.push(() => run('watch-rba.mjs', ['load']));
if (target === 'all' || target === 'rba') tasks.push(() => run('compute-rba-rate-indicator.mjs'));

if (!tasks.length) {
  console.log('Usage: node scripts/load-sources.mjs [all|abs|wb|rba]');
  process.exit(1);
}

for (const task of tasks) {
  await task();
}
