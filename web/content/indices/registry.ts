import hsi from './hsi-2026.1.json';

export interface IndexPayload {
  index: { id: string; name: string; concept: string; vintage: string;
    direction: string; scale: string };
  methodology: {
    components: { metric_id: string; label: string; bounds: [number, number]; weight: number }[];
    normalisation: string; weighting: string; standard: string;
  };
  sources: { metric_id: string; definition: string; unit: string; basis: string;
    source: { org: string; dataset: string; tier: number; url: string;
      published: string; period: string } }[];
  results: {
    entity: string; name: string; score: number | null; coverage: number;
    scored: boolean; reason?: string;
    components: { metric_id: string; label: string; raw: number | null;
      normalised: number | null; weight: number; status: string | null;
      winsorised: boolean }[];
  }[];
  sensitivity: {
    weightPerturbation: { maxRankChange: number; maxScoreChange: number;
      rankCorrelation: number; pass: boolean };
    componentDrop: { maxRankChange: number; topFivePreserved: boolean };
    pairwiseCorrelation: { pair: string; r: number; pass: boolean }[];
    overallPass: boolean;
  };
  generated_at: string;
}

export const INDICES: Record<string, IndexPayload> = { hsi: hsi as unknown as IndexPayload };
export const indexById = (id: string) => INDICES[id];
export const ALL_INDICES = Object.values(INDICES);
