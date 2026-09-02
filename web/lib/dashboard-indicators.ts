import { ALL_INDICES } from '@/content/indices/registry';
import { loadRbaRateIndicator } from '@/lib/rba-rate-indicator';

export type DashboardDial = {
  id: string;
  href: string;
  label: string;
  subtitle: string;
  kicker: string;
  tier: string;
  value: number | null;
  unit: string;
  footnote?: string;
};

export async function loadDashboardDials(): Promise<DashboardDial[]> {
  const hsi = ALL_INDICES.find((p) => p.index.id === 'hsi');
  const aus = hsi?.results.find((r) => r.entity === 'AUS');
  const scored = hsi?.results.filter((r) => r.scored).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)) ?? [];
  const rank = aus ? scored.findIndex((r) => r.entity === 'AUS') + 1 : null;

  let rba;
  try {
    rba = await loadRbaRateIndicator();
  } catch {
    rba = null;
  }

  const dials: DashboardDial[] = [
    {
      id: 'hsi',
      href: '/indices/hsi',
      label: 'Household Squeeze Index',
      subtitle: 'Composite pressure on Australian households',
      kicker: 'Index · Australia',
      tier: `Vintage ${hsi?.index.vintage ?? '—'} · tier 1/2 inputs`,
      value: aus?.score ?? null,
      unit: '/100',
      footnote: rank ? `${rank}${ord(rank)} of ${scored.length} OECD countries` : undefined,
    },
    {
      id: 'rba-market',
      href: '/indicators/rba-rate-rise',
      label: 'RBA hike · market-implied',
      subtitle: rba?.meetingLabel ?? 'Next RBA Board meeting',
      kicker: 'Indicator · ASX futures',
      tier: 'Tier 2 · 25bp hike probability',
      value: rba?.market?.hike ?? null,
      unit: '%',
    },
    {
      id: 'rba-model',
      href: '/indicators/rba-rate-rise',
      label: 'RBA hike · fundamentals',
      subtitle: rba?.meetingLabel ?? 'Next RBA Board meeting',
      kicker: 'Indicator · derived model',
      tier: 'Tier 1/2 inputs · CPI, real rate, credit',
      value: rba?.fundamentals?.hike ?? null,
      unit: '%',
    },
  ];

  return dials;
}

function ord(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0];
}
