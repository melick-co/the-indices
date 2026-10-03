/** Story registry. Each story is a versioned entry here; the body lives in its page.
 *  Evidence pages are generated from `evidence` below, so every claim on social
 *  resolves to its receipts. Agent-generated stories live in Supabase instead. */
import type { SourceRow, Story } from '@/lib/story-types';

export type { SourceRow, Story };

// The founding stories (migration-denominator, wage-spiral) now live in Supabase like every other article.
export const STORIES: Story[] = [];

export const bySlug = (s: string) => STORIES.find((x) => x.slug === s);
