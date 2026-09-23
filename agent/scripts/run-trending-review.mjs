/**
 * Review daily trending topics against the Foundry pitch bank.
 *
 *   node scripts/run-trending-review.mjs
 *   node scripts/run-trending-review.mjs --json
 */
import './lib/load-env.mjs';
import { runTrendingReview } from './lib/trending-review.mjs';

const json = process.argv.includes('--json');

runTrendingReview({ quiet: json }).then((result) => {
  if (json) console.log(JSON.stringify(result, null, 2));
}).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
