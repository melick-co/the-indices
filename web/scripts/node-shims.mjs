/**
 * Lets scripts run web/lib code outside Next.js (npx tsx --import ./scripts/node-shims.mjs ...).
 * `server-only` is a build-time guard Next supplies; outside Next it has nothing
 * to guard, so resolve it to an empty module.
 */
import { registerHooks } from 'node:module';

const EMPTY = new URL('./empty.cjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'server-only') return { url: EMPTY, format: 'commonjs', shortCircuit: true };
    return next(specifier, context);
  },
});
