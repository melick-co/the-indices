import { INSTRUMENT_SERIES } from '@/content/instruments/seed';
import type { InstrumentCard, InstrumentObservation, InstrumentSeries } from '@/lib/instrument-types';
import { formatPeriodLabel, loadRecentSeries } from '@/lib/metrics';

const SEED_IDS = INSTRUMENT_SERIES.map((s) => s.metricId);

function latest(rows: InstrumentObservation[] | undefined): InstrumentObservation | undefined {
  return rows && rows.length ? rows[rows.length - 1] : undefined;
}

function prior(rows: InstrumentObservation[] | undefined): InstrumentObservation | undefined {
  return rows && rows.length > 1 ? rows[rows.length - 2] : undefined;
}

function audBn(n: number, digits = 1) {
  return `A$${n.toLocaleString('en-AU', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })}bn`;
}

function aud(n: number) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(n);
}

function people(n: number) {
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 }).format(n);
}

function daysBetween(a: string, b: string): number | null {
  const da = Date.parse(a.length === 7 ? `${a}-01` : a);
  const db = Date.parse(b.length === 7 ? `${b}-01` : b);
  if (!Number.isFinite(da) || !Number.isFinite(db) || db <= da) return null;
  return (db - da) / 86_400_000;
}

function overlayDb(
  seed: InstrumentSeries[],
  db: Map<string, { period: string; value: number; status?: string | null }[]>,
): InstrumentSeries[] {
  return seed.map((series) => {
    const rows = db.get(series.metricId);
    if (!rows?.length) return series;
    return {
      ...series,
      observations: rows.map((r) => ({
        period: r.period,
        value: r.value,
        status: r.status === 'derived' || r.status === 'estimated' ? r.status : 'published',
      })),
    };
  });
}

function byId(series: InstrumentSeries[]) {
  return new Map(series.map((s) => [s.metricId, s]));
}

export async function loadInstrumentCards(): Promise<InstrumentCard[]> {
  let db = new Map<string, { period: string; value: number; status?: string | null }[]>();
  try {
    db = await loadRecentSeries([...SEED_IDS, 'wpi_annual_au', 'cpi_annual_au'], 24);
  } catch {
    db = new Map();
  }
  const seeded = overlayDb(INSTRUMENT_SERIES, db);
  const map = byId(seeded);

  const ags = map.get('ags_face_value_bn');
  const interest = map.get('ags_interest_payments_bn');
  const gst = map.get('gst_receipts_bn');
  const gdp = map.get('gdp_nominal_aud_bn');
  const hh = map.get('household_credit_bn');
  const erp = map.get('erp_persons');
  const nom = map.get('nom_annual');
  const ni = map.get('natural_increase_annual');
  const growth = map.get('population_growth_annual');
  const completes = map.get('dwelling_completions');
  const stock = map.get('dwelling_stock_value_bn');
  const meanPrice = map.get('mean_dwelling_price');

  const wpi = db.get('wpi_annual_au') ?? [];
  const cpi = db.get('cpi_annual_au') ?? [];
  const wageSpread = alignSpread(wpi, cpi);

  const cards: InstrumentCard[] = [];

  if (ags) {
    const last = latest(ags.observations)!;
    const prev = prior(ags.observations);
    const days = prev ? daysBetween(prev.period, last.period) : null;
    const perDay = days ? ((last.value - prev!.value) * 1e9) / days : null;
    const interestLast = latest(interest?.observations);
    cards.push({
      id: 'ags-stock',
      kicker: 'Fiscal · Commonwealth',
      title: 'AGS on issue',
      hook: 'Face value of Commonwealth securities. Not net debt.',
      caveat: 'Gross AGS excludes state debt and is not the Budget net-debt figure. The $/day figure is derived from the gap between official prints, not a live feed.',
      chart: 'line',
      headline: audBn(last.value),
      subhead: interestLast
        ? `Face value at ${formatPeriodLabel(last.period)} · interest bill ${audBn(interestLast.value)}`
        : `Face value at ${formatPeriodLabel(last.period)}`,
      period: last.period,
      derivedNote: perDay
        ? `Implied ${aud(perDay)} a day since ${formatPeriodLabel(prev!.period)}. Interest is the annual cash bill, not a second stock line.`
        : undefined,
      sources: [
        { org: ags.org, url: ags.url, note: ags.dataset },
        ...(interest ? [{ org: interest.org, url: interest.url, note: interest.dataset }] : []),
      ],
      series: [
        { label: 'AGS face value', color: 'var(--ink)', points: ags.observations, unit: ags.unit },
      ],
    });
  }

  if (ags && hh) {
    const a = latest(ags.observations)!;
    const h = latest(hh.observations)!;
    const multiple = h.value / a.value;
    cards.push({
      id: 'twin-stock',
      kicker: 'Two truths · Stock',
      title: 'Household vs Commonwealth',
      hook: 'Household credit outstanding next to AGS on issue, same dollars.',
      caveat: 'Household credit is RBA D2 (banks and other lenders to households). AGS is Commonwealth securities only. Different sectors, same unit.',
      chart: 'dual',
      headline: `${multiple.toFixed(1)}×`,
      subhead: `Household ${audBn(h.value, 0)} vs AGS ${audBn(a.value, 0)}`,
      period: h.period,
      sources: [
        { org: hh.org, url: hh.url, note: hh.dataset },
        { org: ags.org, url: ags.url, note: ags.dataset },
      ],
      series: [
        { label: 'Household credit', color: 'var(--verify)', points: hh.observations, unit: hh.unit },
        { label: 'AGS face value', color: 'var(--ink)', points: ags.observations, unit: ags.unit },
      ],
    });
  }

  if (ags && erp && gdp) {
    const a = latest(ags.observations)!;
    const pop = latest(erp.observations)!;
    const g = latest(gdp.observations)!;
    const perPerson = (a.value * 1e9) / pop.value;
    const ofGdp = (a.value / g.value) * 100;
    cards.push({
      id: 'debt-denominators',
      kicker: 'Fiscal · Denominator',
      title: 'Per person and vs GDP',
      hook: 'The same AGS stock on two bases.',
      caveat: 'Population is ABS ERP (Dec 2025). GDP is implied from Budget receipts as a share of GDP, so the ratio is derived. AGS print is 11 Feb 2026.',
      chart: 'print',
      headline: aud(perPerson),
      subhead: `${ofGdp.toFixed(0)}% of 2025–26 nominal GDP`,
      period: a.period,
      derivedNote: `AGS ${audBn(a.value)} ÷ ${people(pop.value)} people`,
      sources: [
        { org: ags.org, url: ags.url, note: ags.dataset },
        { org: erp.org, url: erp.url, note: erp.dataset },
        { org: gdp.org, url: gdp.url, note: gdp.dataset },
      ],
      series: [
        { label: 'AGS face value', color: 'var(--ink)', points: ags.observations, unit: ags.unit },
      ],
    });
  }

  if (nom && ni) {
    const n = latest(nom.observations)!;
    const nat = latest(ni.observations)!;
    const share = n.value / (n.value + nat.value) * 100;
    cards.push({
      id: 'population-mix',
      kicker: 'People · Mix',
      title: 'Who is adding the people',
      hook: 'Net overseas migration versus natural increase, year ended December.',
      caveat: 'ABS preliminary. NOM is not the permanent-visa intake; it is arrivals minus departures on a 12/16 month rule.',
      chart: 'stacked',
      headline: `${share.toFixed(0)}%`,
      subhead: `of 2025 growth from NOM (${people(n.value)} vs ${people(nat.value)} natural increase)`,
      period: n.period,
      sources: [
        { org: nom.org, url: nom.url, note: nom.dataset },
      ],
      series: [
        { label: 'Net overseas migration', color: 'var(--verify)', points: nom.observations, unit: nom.unit },
        { label: 'Natural increase', color: 'var(--ink-soft)', points: ni.observations, unit: ni.unit },
      ],
    });
  }

  if (growth && completes) {
    const g = latest(growth.observations)!;
    const yearCompletes = completes.observations
      .filter((o) => o.period.startsWith('2025'))
      .reduce((s, o) => s + o.value, 0);
    const ratio = g.value / yearCompletes;
    cards.push({
      id: 'people-per-dwelling',
      kicker: 'People · Housing',
      title: 'People per new dwelling',
      hook: 'Population growth in 2025 divided by seasonally adjusted completions.',
      caveat: 'Completions are quarterly SA summed for 2025. Population growth is year ended December. This is not households formed, and it is not sales.',
      chart: 'line',
      headline: `${ratio.toFixed(1)}`,
      subhead: `${people(g.value)} people added / ${people(yearCompletes)} completions`,
      period: g.period,
      sources: [
        { org: growth.org, url: growth.url, note: growth.dataset },
        { org: completes.org, url: completes.url, note: completes.dataset },
      ],
      series: [
        { label: 'Completions', color: 'var(--ink)', points: completes.observations, unit: completes.unit },
      ],
    });
  }

  if (stock && completes) {
    const s = latest(stock.observations)!;
    const price = latest(meanPrice?.observations);
    cards.push({
      id: 'housing-tape',
      kicker: 'Housing · Tape',
      title: 'Dwelling stock and completions',
      hook: 'Official stock value as the price line, completions as volume. Not a daily equity tape.',
      caveat: 'ABS ceased RPPI after 2021. This uses Total Value of Dwellings and Building Activity completions. Completions are not sales. Mean price is the latest ABS print only.',
      chart: 'line',
      headline: price ? aud(price.value) : audBn(s.value, 0),
      subhead: price
        ? `Mean dwelling price, ${formatPeriodLabel(price.period)} · stock ${audBn(s.value, 0)}`
        : `Residential dwelling stock, ${formatPeriodLabel(s.period)}`,
      period: s.period,
      sources: [
        { org: stock.org, url: stock.url, note: stock.dataset },
        { org: completes.org, url: completes.url, note: completes.dataset },
      ],
      series: [
        { label: 'Dwelling stock value', color: 'var(--ink)', points: stock.observations, unit: stock.unit },
      ],
      volume: { label: 'Completions', points: completes.observations },
    });
  }

  if (wageSpread.length) {
    const last = wageSpread[wageSpread.length - 1];
    cards.push({
      id: 'real-wage-spread',
      kicker: 'Labour · Spread',
      title: 'Wages minus CPI',
      hook: 'Private-sector-relevant WPI less headline CPI, as a spread.',
      caveat: 'WPI is the price of labour for a fixed job mix. Headline CPI carries volatile items. Trimmed mean would be the RBA comparison; this uses the ABS prints already on the dashboard.',
      chart: 'spread',
      headline: `${last.value >= 0 ? '+' : ''}${last.value.toFixed(1)} pp`,
      subhead: `WPI minus CPI, ${formatPeriodLabel(last.period)}`,
      period: last.period,
      sources: [
        { org: 'Australian Bureau of Statistics', url: 'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/wage-price-index-australia/latest-release', note: 'Wage Price Index' },
        { org: 'Australian Bureau of Statistics', url: 'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/consumer-price-index-australia/latest-release', note: 'CPI' },
      ],
      series: [
        { label: 'WPI − CPI', color: last.value >= 0 ? 'var(--verify)' : 'var(--ink)', points: wageSpread, unit: 'percentage points' },
      ],
    });
  }

  if (interest && gst) {
    const i = latest(interest.observations)!;
    const t = latest(gst.observations)!;
    const gstDays = (i.value / t.value) * 365;
    const perSecond = (i.value * 1e9) / (365.25 * 24 * 3600);
    cards.push({
      id: 'interest-as-tax',
      kicker: 'Fiscal · Denominator',
      title: 'Interest as GST-days',
      hook: 'Annual AGS interest payments as days of GST receipts.',
      caveat: 'Both figures are Budget estimates for 2025–26, not year-to-date collections. This is a denominator flip on the interest bill, not a clock.',
      chart: 'print',
      headline: `${gstDays.toFixed(0)} days`,
      subhead: `${audBn(i.value)} interest / ${audBn(t.value)} GST`,
      period: i.period,
      derivedNote: `${aud(perSecond)} a second if the annual bill were smoothed. Derived, not a live tick.`,
      sources: [
        { org: interest.org, url: interest.url, note: interest.dataset },
        { org: gst.org, url: gst.url, note: gst.dataset },
      ],
      series: [
        { label: 'Interest payments', color: 'var(--verify)', points: interest.observations, unit: interest.unit },
        { label: 'GST receipts', color: 'var(--ink)', points: gst.observations, unit: gst.unit },
      ],
    });
  }

  return cards;
}

function alignSpread(
  wpi: { period: string; value: number }[],
  cpi: { period: string; value: number }[],
): InstrumentObservation[] {
  const cpiMap = new Map(cpi.map((r) => [r.period, r.value]));
  return wpi
    .filter((r) => cpiMap.has(r.period))
    .map((r) => ({
      period: r.period,
      value: r.value - (cpiMap.get(r.period) as number),
      status: 'derived' as const,
    }));
}

export async function loadInstrument(id: string): Promise<InstrumentCard | null> {
  const cards = await loadInstrumentCards();
  return cards.find((c) => c.id === id) ?? null;
}
