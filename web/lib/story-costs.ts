import { createClient } from '@/lib/supabase-server';

/**
 * The cost ledger (agent/supabase/40_story_costs.sql): one row per billable call made for a story.
 * Every stage write, picture, clip, read and runner minute records itself here, so a story's video
 * cost is the sum of everything ever spent on it, regenerations included.
 *
 * Prices come from story_cost_price and are copied onto the row, so history keeps the price it
 * was made at. A sku with no price yet records the quantity and a null cost: visible, not zero.
 * Recording never throws into the pipeline that called it; a failed write is logged and the
 * generation it describes still stands.
 */

export type CostStage =
  | 'script' | 'storyboard' | 'prompts'
  | 'still' | 'chart' | 'clip' | 'chart_video'
  | 'voice' | 'cut'
  | 'hero_image' | 'hero_video' | 'hero_voice';

export const SKU = {
  anthropicInput: (model: string) => `anthropic:${model}:input`,
  anthropicOutput: (model: string) => `anthropic:${model}:output`,
  anthropicCacheRead: (model: string) => `anthropic:${model}:cache_read`,
  anthropicCacheWrite: (model: string) => `anthropic:${model}:cache_write`,
  elevenCredit: 'elevenlabs:credit',
  elevenImage: (model: string) => `elevenlabs:image:${model}`,
  elevenVideo: (model: string) => `elevenlabs:video:${model}`,
  runnerMinute: 'github:actions:linux-2core',
} as const;

export type Price = { sku: string; provider: string; unit: string; unit_price_usd: number | null };

export type CostEntry = {
  slug: string;
  stage: CostStage;
  provider: 'anthropic' | 'elevenlabs' | 'github';
  model?: string | null;
  sku: string;
  quantity: number;
  /** Named when the sku is unknown to the price table, so the row still says what it counted. */
  unit: string;
  renderId?: string | null;
  detail?: Record<string, unknown>;
};

/** Cost to the microdollar, or null when there is no price to apply. */
export function costUsd(quantity: number, unitPrice: number | null | undefined): number | null {
  if (unitPrice === null || unitPrice === undefined || !Number.isFinite(unitPrice)) return null;
  return Math.round(quantity * unitPrice * 1_000_000) / 1_000_000;
}

export type AnthropicUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

export function readAnthropicUsage(usage: unknown): AnthropicUsage {
  const u = (usage ?? {}) as Record<string, unknown>;
  return {
    input_tokens: Number(u.input_tokens ?? 0),
    output_tokens: Number(u.output_tokens ?? 0),
    cache_read_input_tokens: Number(u.cache_read_input_tokens ?? 0),
    cache_creation_input_tokens: Number(u.cache_creation_input_tokens ?? 0),
  };
}

/** One row per token class that was actually used, so a call with no cache traffic makes two rows, not four. */
export function anthropicEntries(
  slug: string,
  stage: CostStage,
  model: string,
  usage: AnthropicUsage,
  detail: Record<string, unknown> = {},
): CostEntry[] {
  const classes: Array<[string, number]> = [
    [SKU.anthropicInput(model), usage.input_tokens],
    [SKU.anthropicOutput(model), usage.output_tokens],
    [SKU.anthropicCacheRead(model), usage.cache_read_input_tokens ?? 0],
    [SKU.anthropicCacheWrite(model), usage.cache_creation_input_tokens ?? 0],
  ];
  return classes
    .filter(([, n]) => n > 0)
    .map(([sku, n]) => ({ slug, stage, provider: 'anthropic', model, sku, quantity: n, unit: 'token', detail }));
}

let priceCache: { at: number; prices: Map<string, Price> } | null = null;
const PRICE_TTL_MS = 5 * 60 * 1000;

export async function loadPrices(): Promise<Map<string, Price>> {
  if (priceCache && Date.now() - priceCache.at < PRICE_TTL_MS) return priceCache.prices;
  const supabase = createClient();
  const { data, error } = await supabase.from('story_cost_price').select('sku, provider, unit, unit_price_usd');
  if (error) throw new Error(`story_cost_price: ${error.message}`);
  const prices = new Map<string, Price>();
  for (const row of (data ?? []) as Array<Price & { unit_price_usd: number | string | null }>) {
    prices.set(row.sku, { ...row, unit_price_usd: row.unit_price_usd === null ? null : Number(row.unit_price_usd) });
  }
  priceCache = { at: Date.now(), prices };
  return prices;
}

/**
 * Write the rows. Failures are reported through `log` and swallowed: the ledger must never be the
 * reason a script, a picture or a cut is lost.
 */
export async function recordCosts(entries: CostEntry[], log: (m: string) => void = console.warn): Promise<void> {
  if (!entries.length) return;
  try {
    const prices = await loadPrices();
    const rows = entries.map((e) => {
      const price = prices.get(e.sku);
      return {
        story_slug: e.slug,
        render_id: e.renderId ?? null,
        stage: e.stage,
        provider: e.provider,
        model: e.model ?? null,
        sku: price ? e.sku : null,
        quantity: e.quantity,
        unit: price?.unit ?? e.unit,
        unit_price_usd: price?.unit_price_usd ?? null,
        cost_usd: costUsd(e.quantity, price?.unit_price_usd),
        detail: { ...(e.detail ?? {}), ...(price ? {} : { unknown_sku: e.sku }) },
      };
    });
    const supabase = createClient();
    const { error } = await supabase.from('story_costs').insert(rows);
    if (error) throw new Error(error.message);
  } catch (e) {
    log(`Cost ledger: could not record ${entries.length} row(s): ${e instanceof Error ? e.message : e}`);
  }
}

export async function recordCost(entry: CostEntry, log?: (m: string) => void): Promise<void> {
  return recordCosts([entry], log);
}

export type StageCost = {
  story_slug: string;
  stage: CostStage;
  provider: string;
  unit: string;
  calls: number;
  quantity: number;
  cost_usd: number;
  unpriced: number;
  last_at: string;
};

export async function loadStoryCosts(slug: string): Promise<StageCost[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('v_story_cost_by_stage')
    .select('*')
    .eq('story_slug', slug)
    .order('stage');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    story_slug: String(r.story_slug),
    stage: r.stage as CostStage,
    provider: String(r.provider),
    unit: String(r.unit),
    calls: Number(r.calls ?? 0),
    quantity: Number(r.quantity ?? 0),
    cost_usd: Number(r.cost_usd ?? 0),
    unpriced: Number(r.unpriced ?? 0),
    last_at: String(r.last_at ?? ''),
  }));
}

export function sumCosts(rows: StageCost[]): { total: number; unpriced: number; calls: number } {
  return rows.reduce(
    (acc, r) => ({ total: Math.round((acc.total + r.cost_usd) * 1_000_000) / 1_000_000, unpriced: acc.unpriced + r.unpriced, calls: acc.calls + r.calls }),
    { total: 0, unpriced: 0, calls: 0 },
  );
}
