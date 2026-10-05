import { loadStoryCosts, sumCosts, type CostStage } from '@/lib/story-costs';

const STAGE_LABEL: Record<CostStage, string> = {
  script: 'Script (model)',
  storyboard: 'Storyboard (model)',
  prompts: 'Prompt pack (model)',
  still: 'Stills',
  chart: 'Chart stills',
  clip: 'Scene clips',
  chart_video: 'Animated charts',
  voice: 'Voice reads',
  cut: 'Cut (runner minutes)',
  hero_image: 'Hero illustration',
  hero_video: 'Hero clip',
  hero_voice: 'Hero voice reads',
};

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const qty = (n: number, unit: string) => `${Number.isInteger(n) ? n : n.toFixed(2)} ${unit}${n === 1 ? '' : 's'}`;

/**
 * What this story's video has cost so far: every stage write, picture, clip, read and runner
 * minute, regenerations included, from the cost ledger. Rows without a price yet are counted
 * rather than hidden, so a partial total reads as partial.
 */
export default async function ReelCosts({ slug }: { slug: string }) {
  let rows: Awaited<ReturnType<typeof loadStoryCosts>> = [];
  let failure: string | null = null;
  try {
    rows = await loadStoryCosts(slug);
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
  }
  const total = sumCosts(rows);

  return (
    <section className="runway-block reel-costs">
      <h2 className="reel-h2">Cost so far</h2>
      <p className="reel-lede">
        Every call made for this video, regenerations included, at the price on the day it ran.
        {total.unpriced > 0 && ` ${total.unpriced} call${total.unpriced === 1 ? ' has' : 's have'} no price yet (ElevenLabs credits per picture and per second are set from the account's usage page), so the total is a floor.`}
      </p>
      {failure ? (
        <p className="runway-missing">The cost ledger could not be read: {failure}</p>
      ) : rows.length === 0 ? (
        <p className="reel-action-note">Nothing recorded yet. Costs are recorded from the next stage write, picture or cut.</p>
      ) : (
        <table className="reel-costs-table">
          <thead>
            <tr><th>Stage</th><th>Calls</th><th>Used</th><th>Cost</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.stage}-${r.provider}-${r.unit}`}>
                <td>{STAGE_LABEL[r.stage] ?? r.stage}</td>
                <td>{r.calls}</td>
                <td>{qty(r.quantity, r.unit)}</td>
                <td>{r.unpriced === r.calls ? 'unpriced' : `${usd(r.cost_usd)}${r.unpriced ? ' +' : ''}`}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><th>Total</th><th>{total.calls}</th><th /><th>{usd(total.total)}{total.unpriced ? ' +' : ''}</th></tr>
          </tfoot>
        </table>
      )}
    </section>
  );
}
