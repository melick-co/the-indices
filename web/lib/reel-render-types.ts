export type RenderKind = 'still' | 'chart' | 'clip' | 'chart_video' | 'reel';
export type RenderStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type RenderChainTo = 'clip' | 'chart_video';

export type StoryReelRender = {
  renderId: string;
  storySlug: string;
  sceneId: string;
  kind: RenderKind;
  status: RenderStatus;
  model: string | null;
  promptText: string;
  outputUrl: string | null;
  contentType: string | null;
  outputManifest: { clips: Array<{ sceneId: string; kind: RenderKind; url: string }> } | null;
  error: string | null;
  chainTo: RenderChainTo | null;
  createdAt: string;
  updatedAt: string;
};

export type RenderListResponse = {
  configured: boolean;
  renders: StoryReelRender[];
};

export const REEL_SCENE_ID = '_reel';

export const RENDER_KIND_LABEL: Record<RenderKind, string> = {
  still: 'Still',
  chart: 'Chart still',
  clip: 'Scene clip',
  chart_video: 'Animated chart',
  reel: 'Whole reel',
};

export function isRenderKind(value: unknown): value is RenderKind {
  return value === 'still'
    || value === 'chart'
    || value === 'clip'
    || value === 'chart_video'
    || value === 'reel';
}
