export type InstrumentObservation = {
  period: string;
  value: number;
  status: 'published' | 'derived' | 'estimated';
};

export type InstrumentSeries = {
  metricId: string;
  name: string;
  unit: string;
  basis: string;
  org: string;
  dataset: string;
  url: string;
  tier: 1 | 2 | 3;
  observations: InstrumentObservation[];
};

export type ChartKind = 'line' | 'dual' | 'stacked' | 'spread' | 'tape' | 'print';

export type InstrumentCard = {
  id: string;
  kicker: string;
  title: string;
  hook: string;
  caveat: string;
  chart: ChartKind;
  headline: string;
  subhead: string;
  period: string;
  sources: { org: string; url: string; note: string }[];
  series: { label: string; color: string; points: InstrumentObservation[]; unit: string }[];
  volume?: { label: string; points: InstrumentObservation[] };
  derivedNote?: string;
};
