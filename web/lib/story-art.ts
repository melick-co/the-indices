/**
 * Story art: editor-set hero images and a write-hook for generated stills/clips.
 *
 * The News Desk does not call Runway. Succeeded rows in `story_reel_renders`
 * (written by the reel renderer) can be attached here with `recordStoryArt` /
 * `attachGeneratedArtToStory`. Home cards resolve a still via `resolveHeroImage`.
 */

import type { Story, StoryArt, StoryArtKind } from '@/lib/story-types';

export const STORY_ART_BUCKET = 'story-art';

export const STATIC_STORY_SLUGS = ['migration-denominator', 'wage-spiral'] as const;

export function isStaticStorySlug(slug: string): boolean {
  return (STATIC_STORY_SLUGS as readonly string[]).includes(slug);
}

export function newArtId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `art-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function parseStoryArt(raw: unknown): StoryArt[] {
  if (!Array.isArray(raw)) return [];
  const out: StoryArt[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.url !== 'string' || !row.url.trim()) continue;
    const kind = row.kind === 'clip' || row.kind === 'hero' || row.kind === 'still' ? row.kind : 'still';
    const source = row.source === 'upload' || row.source === 'generated' || row.source === 'url'
      ? row.source
      : 'url';
    out.push({
      id: typeof row.id === 'string' && row.id ? row.id : newArtId(),
      kind,
      url: row.url.trim(),
      alt: typeof row.alt === 'string' ? row.alt : undefined,
      source,
      generator: typeof row.generator === 'string' ? row.generator : undefined,
      prompt: typeof row.prompt === 'string' ? row.prompt : undefined,
      createdAt: typeof row.createdAt === 'string' ? row.createdAt : new Date().toISOString(),
    });
  }
  return out;
}

/** Append a generated (or uploaded) still/clip. Does not call any API. */
export function attachGeneratedArt(
  existing: StoryArt[] | unknown,
  piece: Omit<StoryArt, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
): StoryArt[] {
  const current = parseStoryArt(existing);
  const next: StoryArt = {
    id: piece.id ?? newArtId(),
    kind: piece.kind,
    url: piece.url,
    alt: piece.alt,
    source: piece.source,
    generator: piece.generator,
    prompt: piece.prompt,
    createdAt: piece.createdAt ?? new Date().toISOString(),
  };
  return [...current.filter((a) => a.id !== next.id), next];
}

/** Prefer the editor-set hero URL; otherwise the latest hero/still attachment. */
export function resolveHeroImage(story: Pick<Story, 'title' | 'heroImageUrl' | 'heroImageAlt' | 'art'>): {
  url: string;
  alt: string;
} | null {
  if (story.heroImageUrl?.trim()) {
    return {
      url: story.heroImageUrl.trim(),
      alt: story.heroImageAlt?.trim() || story.title,
    };
  }
  const stills = (story.art ?? []).filter((a) => a.kind === 'hero' || a.kind === 'still');
  const latest = stills[stills.length - 1];
  if (!latest) return null;
  return { url: latest.url, alt: latest.alt?.trim() || story.title };
}

export function clipsOf(story: Pick<Story, 'art'>): StoryArt[] {
  return (story.art ?? []).filter((a) => a.kind === 'clip');
}

export function artOfKind(art: StoryArt[] | undefined, kind: StoryArtKind): StoryArt[] {
  return (art ?? []).filter((a) => a.kind === kind);
}
