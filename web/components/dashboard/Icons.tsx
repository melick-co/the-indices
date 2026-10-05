/**
 * Line icons for the dashboards (24×24, stroke-based, inherit currentColor). Drawn for this site; no icon library.
 */
const PATHS = {
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  briefcase: 'M3 8h18v12H3zM8 8V5h8v3M3 13h18',
  tag: 'M3 12V4h8l10 10-8 8L3 12zM7.5 7.5h.01',
  bank: 'M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18',
  home: 'M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6',
  users: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a6 6 0 0112 0v1M16 3.5a4 4 0 010 7.5M22 21v-1a6 6 0 00-4-5.6',
  building: 'M4 21V5l8-3 8 3v16M4 21h16M9 9h.01M15 9h.01M9 13h.01M15 13h.01M10 21v-4h4v4',
  cart: 'M3 4h2l2.4 11.2a1 1 0 001 .8h9.7a1 1 0 001-.8L21 8H6.2M9 20.5h.01M18 20.5h.01',
  factory: 'M3 21V10l6 4V10l6 4V6l6-3v18H3zM7 17h2M12 17h2M17 17h2',
  wallet: 'M3 7a2 2 0 012-2h13v4M3 7v11a2 2 0 002 2h16V9H5a2 2 0 01-2-2zM17 14.5h.01',
  key: 'M14 10a5 5 0 11-10 0 5 5 0 0110 0zM12.5 13.5L21 22M17 18l2-2M19 20l2-2',
  gauge: 'M12 14l4-4M3.5 17a9 9 0 1117 0M12 14a1 1 0 100 .01',
  percent: 'M19 5L5 19M7 9a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z',
  card: 'M2 6h20v12H2zM2 10h20M6 15h4',
  heart: 'M12 20s-7-4.4-9.2-9A5 5 0 0112 5.5 5 5 0 0121.2 11C19 15.6 12 20 12 20z',
  book: 'M4 4h6a2 2 0 012 2v14a2 2 0 00-2-2H4zM20 4h-6a2 2 0 00-2 2v14a2 2 0 012-2h6z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z',
  smile: 'M12 21a9 9 0 100-18 9 9 0 000 18zM8.5 14a4.5 4.5 0 007 0M9 9.5h.01M15 9.5h.01',
  ballot: 'M4 12h16v8H4zM8 12V4h8v8M10 8l1.5 1.5L14 7',
  compass: 'M12 21a9 9 0 100-18 9 9 0 000 18zM15.5 8.5l-2 5-5 2 2-5 5-2z',
  user: 'M12 11a4 4 0 100-8 4 4 0 000 8zM4 21v-1a8 8 0 0116 0v1',
  scale: 'M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 006 0L5 7zM19 7l-3 7a3 3 0 006 0l-3-7z',
  leaf: 'M5 19C5 10 10 5 20 4c-1 10-6 15-15 15zM5 19l7-7',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  alert: 'M12 3l10 18H2L12 3zM12 10v5M12 18h.01',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className ? `dx-icon ${className}` : 'dx-icon'} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

const SECTION_ICONS: Record<string, IconName> = {
  growth: 'trend', jobs: 'briefcase', prices: 'tag', rates: 'bank', housing: 'home', people: 'users', public: 'building',
  consumers: 'cart', business: 'factory',
  income: 'wallet', work: 'briefcase', health: 'heart', skills: 'book', safety: 'shield', wellbeing: 'smile', civic: 'ballot',
};
export const sectionIcon = (id: string): IconName => SECTION_ICONS[id] ?? 'chart';

/** An icon for an indicator, from what its series measures. */
export function indicatorIcon(metricId: string): IconName {
  const rules: Array<[RegExp, IconName]> = [
    [/consumer_confidence/, 'cart'], [/business_confidence/, 'factory'],
    [/rent/, 'key'], [/cpi|inflation|trimmed/, 'tag'], [/wpi|wage|earnings|hsl_2_8/, 'wallet'],
    [/unemployment|employment|hsl_2_/, 'briefcase'], [/repayments|debt_income|dwelling|hsl_3_/, 'home'],
    [/productivity|gva_per_hour|per_hour/, 'gauge'], [/gdp/, 'trend'], [/cash_rate|rba_/, 'bank'], [/bond_yield/, 'percent'],
    [/credit/, 'card'], [/population|nom_|erp_|migration/, 'users'], [/gov_|tax_/, 'building'],
    [/hsl_1_/, 'wallet'], [/hsl_5_/, 'heart'], [/hsl_6_/, 'book'], [/hsl_10_/, 'shield'], [/hsl_11_|hsl_7_/, 'smile'],
    [/hsl_8_/, 'ballot'], [/hsl_9_/, 'leaf'],
  ];
  return rules.find(([re]) => re.test(metricId))?.[1] ?? 'chart';
}
