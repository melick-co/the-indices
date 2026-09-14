'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase-server';
import { looksLikeCsv, parseCsvSeries } from '@/lib/market-quotes';
import { fetchQuote, type MarketKind, type MarketProvider } from '@/lib/markets-loader';

const UA = 'Caveat-Markets/0.1 (+https://the-indices.vercel.app)';

export type InspectedSource = {
  url: string;
  title: string;
  snippet: string;
  csvPoints: number;
  samplePeriod: string | null;
  sampleValue: number | null;
};

export async function inspectSourceUrl(rawUrl: string): Promise<
  { ok: true; data: InspectedSource } | { ok: false; error: string }
> {
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { ok: false, error: 'Only http(s) URLs are supported.' };
    }
    const res = await fetch(parsed.toString(), {
      headers: { 'user-agent': UA, accept: 'text/csv,text/html,application/json,text/plain,*/*' },
      signal: AbortSignal.timeout(20000),
      redirect: 'follow',
    });
    if (!res.ok) return { ok: false, error: `Fetch failed (${res.status})` };
    const raw = await res.text();
    const title = raw.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? parsed.hostname;
    const csv = looksLikeCsv(raw);
    const points = csv ? parseCsvSeries(raw) : [];
    const last = points.at(-1);
    const snippet = csv
      ? `CSV with ${points.length} numeric observations.`
      : raw
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 600);
    return {
      ok: true,
      data: {
        url: parsed.toString(),
        title,
        snippet,
        csvPoints: points.length,
        samplePeriod: last?.period ?? null,
        sampleValue: last?.value ?? null,
      },
    };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not fetch that URL.' };
  }
}

export async function addMarketWatch(input: {
  kind: MarketKind;
  label: string;
  url: string;
  org?: string;
  unit?: string;
  why?: string;
  cadence?: string;
  proposedTier?: number;
  provider?: MarketProvider;
  symbol?: string;
}) {
  const label = input.label.trim();
  if (!label) return { ok: false as const, error: 'Give the series a name.' };
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return { ok: false as const, error: 'Need a source URL.' };
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { ok: false as const, error: 'Only http(s) URLs are supported.' };
  }

  const provider: MarketProvider = input.provider ?? 'url';
  const supabase = createClient();
  const { data, error } = await supabase.from('market_watches').insert({
    kind: input.kind,
    label,
    symbol: input.symbol?.trim() || null,
    provider,
    source_url: url.toString(),
    org: input.org?.trim() || url.hostname,
    unit: input.unit?.trim() || null,
    why: input.why?.trim() || null,
    cadence: input.cadence?.trim() || 'irregular',
    proposed_tier: input.proposedTier && [1, 2, 3].includes(input.proposedTier) ? input.proposedTier : 2,
    status: 'watching',
    builtin: false,
  }).select('*').single();
  if (error) return { ok: false as const, error: error.message };

  const watch = {
    watch_id: data.watch_id as string,
    kind: data.kind,
    label: data.label,
    symbol: data.symbol,
    provider: data.provider,
    source_url: data.source_url,
    org: data.org,
    unit: data.unit,
    notes: data.notes,
    why: data.why,
    cadence: data.cadence,
    proposed_tier: data.proposed_tier,
    status: data.status,
    builtin: false,
    linked_source_id: null,
    linked_metric_id: null,
    linked_suggestion: null,
    last_value: null,
    last_period: null,
    last_change_pct: null,
    last_fetched: null,
    history: [],
  };
  const quote = await fetchQuote(watch);
  if (quote) {
    await supabase.from('market_watches').update({
      last_value: quote.value,
      last_period: quote.period,
      last_change_pct: quote.changePct,
      last_fetched: new Date().toISOString(),
      history: quote.history,
      updated_at: new Date().toISOString(),
    }).eq('watch_id', data.watch_id);
  }

  revalidatePath('/markets');
  return { ok: true as const, watchId: data.watch_id as string };
}

export async function dropMarketWatch(watchId: string) {
  const supabase = createClient();
  const { error } = await supabase.from('market_watches')
    .update({ status: 'dropped', updated_at: new Date().toISOString() })
    .eq('watch_id', watchId)
    .eq('builtin', false);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/markets');
  return { ok: true as const };
}

export async function proposeMarketWatch(watchId: string, why?: string) {
  const supabase = createClient();
  const { data: watch, error } = await supabase.from('market_watches')
    .select('*').eq('watch_id', watchId).maybeSingle();
  if (error || !watch) return { ok: false as const, error: error?.message ?? 'Watch not found.' };

  const reason = (why ?? watch.why ?? '').trim();
  const { data: suggestion, error: sugErr } = await supabase.from('source_suggestions').insert({
    action: 'register_data_source',
    summary: watch.label,
    payload: {
      name: watch.label,
      org: watch.org ?? 'Unknown',
      url: watch.source_url,
      tier: watch.proposed_tier ?? 2,
      cadence: watch.cadence ?? 'irregular',
      why: reason || 'Tracked on the Markets desk as a candidate for the data store.',
      symbol: watch.symbol,
      kind: watch.kind,
      watch_id: watch.watch_id,
    },
  }).select('suggestion_id').single();
  if (sugErr) return { ok: false as const, error: sugErr.message };

  await supabase.from('market_watches').update({
    status: 'proposed',
    why: reason || watch.why,
    linked_suggestion: suggestion.suggestion_id,
    updated_at: new Date().toISOString(),
  }).eq('watch_id', watchId);

  revalidatePath('/markets');
  revalidatePath('/foundry');
  return { ok: true as const, suggestionId: suggestion.suggestion_id as string };
}

export async function refreshMarketWatches() {
  const { refreshStaleWatches, loadMarketWatches } = await import('@/lib/markets-loader');
  try {
    await refreshStaleWatches(await loadMarketWatches(), { force: true });
  } catch {
    /* page reload still shows last prints */
  }
  revalidatePath('/markets');
  return { ok: true as const };
}
