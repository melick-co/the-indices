import {
  VIDEO_STAGE_LABEL,
  VIDEO_STAGES,
  type VideoStage,
} from '@/lib/reel-types';

function stateOf(
  id: VideoStage,
  current: VideoStage | null,
): 'done' | 'current' | 'next' | 'locked' {
  if (!current) return id === 'script' ? 'next' : 'locked';
  const here = VIDEO_STAGES.indexOf(id);
  const now = VIDEO_STAGES.indexOf(current);
  if (here < now) return 'done';
  if (here === now) return 'current';
  if (here === now + 1) return 'next';
  return 'locked';
}

/** Script → storyboard → prompt output. Later stages stay locked until the earlier pass exists. */
export default function VideoStepper({ stage }: { stage: VideoStage | null }) {
  return (
    <ol className="video-steps">
      {VIDEO_STAGES.map((id, i) => {
        const state = stateOf(id, stage);
        return (
          <li
            key={id}
            className={`video-step video-step-${state}`}
          >
            <span className="video-step-n">{String(i + 1).padStart(2, '0')}</span>
            <span className="video-step-label">{VIDEO_STAGE_LABEL[id]}</span>
            <span className="video-step-state">{state === 'next' ? 'up next' : state}</span>
          </li>
        );
      })}
    </ol>
  );
}
