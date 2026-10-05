/**
 * Every address on The Indices, in one place. The site lives under /indices so it can later be served from its own
 * domain by mapping that domain to this prefix.
 */
export const IX = {
  home: '/indices',
  economy: '/indices/economy',
  qol: '/indices/quality-of-life',
  sentiment: '/indices/sentiment',
  polls: '/indices/sentiment/polls',
  population: '/indices/population',
  pnl: '/indices/australia-inc',
  visuals: '/indices/visuals',
  /** Caveat composite indices (e.g. the Household Squeeze Index). */
  composite: (id: string) => `/indices/${id}`,
} as const;

/** Economy dashboard section ids: their old addresses (/indices/<id>) redirect to /indices/economy/<id>. */
export const ECONOMY_SECTION_IDS = ['growth', 'jobs', 'prices', 'rates', 'housing', 'people', 'public'] as const;
