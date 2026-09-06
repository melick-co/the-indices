/** Shared story shape for static registry and DB-generated stories. */

export interface SourceRow {
  metric: string;
  org: string;
  tier: 1 | 2 | 3;
  url: string;
  period: string;
  basis: string;
}

export interface StoryEvidence {
  table?: { head: string[]; rows: string[][] };
  sources: SourceRow[];
}

export interface StoryOneNumber {
  value: string;
  label: string;
}

export type StoryBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'layers'; items: string[] }
  | { type: 'heading'; text: string }
  | { type: 'pull'; text: string };

export interface StoryBody {
  blocks: StoryBlock[];
}

export interface Story {
  slug: string;
  kicker: string;
  title: string;
  hook: string;
  caveat: string;
  published: string;
  oneNumber: StoryOneNumber;
  evidence: StoryEvidence;
  /** Present for agent-generated stories; static stories use React body components. */
  body?: StoryBody;
  pitchId?: string;
}
