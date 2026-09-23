import { EXPLAINERS, type Explainer } from '@/content/explainers/seed';

export function pickExplainer(now = new Date()): Explainer {
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const day = Math.floor((now.getTime() - start) / 86_400_000);
  return EXPLAINERS[day % EXPLAINERS.length];
}

export function explainerBySlug(slug: string): Explainer | undefined {
  return EXPLAINERS.find((e) => e.slug === slug);
}

export function allExplainers(): Explainer[] {
  return EXPLAINERS;
}
