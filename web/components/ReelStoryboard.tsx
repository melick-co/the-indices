import StoryChart from '@/components/StoryChart';
import { REEL_FORMAT, wordBudget, wordCount, type ReelScene, type ReelSpec } from '@/lib/reel-types';
import type { StoryChartBlock } from '@/lib/story-types';

/** The reel's chart frame is a story chart plus reveal direction, so it renders with the same component. */
function asStoryChart(scene: ReelScene): StoryChartBlock | null {
  if (!scene.chart) return null;
  const { reveal, unverified, unverified_note, ...chart } = scene.chart;
  return { type: 'chart', ...chart };
}

function SceneCard({
  scene,
  index,
  showVisuals,
}: {
  scene: ReelScene;
  index: number;
  showVisuals: boolean;
}) {
  const words = wordCount(scene.narration);
  const budget = wordBudget(scene.seconds);
  const over = words > budget;
  const chart = asStoryChart(scene);

  return (
    <article className="reel-scene">
      <header className="reel-scene-head">
        <span className="reel-scene-n">{String(index + 1).padStart(2, '0')}</span>
        <span className="reel-scene-kind">{scene.kind.replace('_', ' ')}</span>
        <span className="reel-scene-secs">{scene.seconds}s</span>
      </header>

      <div className="reel-scene-body">
        <div className="reel-frame">
          <div className="reel-frame-inner">
            <p className="reel-on-screen">{scene.on_screen}</p>
            {showVisuals && chart && <p className="reel-frame-hold">chart holds this frame</p>}
            {scene.lower_third && <p className="reel-lower-third">{scene.lower_third}</p>}
          </div>
          <p className="reel-frame-cap">burned in · {REEL_FORMAT.aspect} safe area</p>
        </div>

        <div className="reel-scene-text">
          <div className="reel-field">
            <span className="reel-field-label">
              Voiceover
              <span className={over ? 'reel-budget reel-budget-over' : 'reel-budget'}>
                {words} / {budget} words
              </span>
            </span>
            <p className="reel-vo">{scene.narration}</p>
          </div>

          {showVisuals && (
            <div className="reel-field">
              <span className="reel-field-label">Visual direction</span>
              <p className="reel-visual">{scene.visual_prompt}</p>
            </div>
          )}
        </div>
      </div>

      {showVisuals && chart && (
        <div className="reel-scene-chart">
          <span className="reel-field-label">
            Chart
            <span className="reel-budget">
              {scene.chart!.kind} · reveal {scene.chart!.reveal.replace(/_/g, ' ')} · {scene.chart!.caption}
            </span>
          </span>
          <StoryChart chart={chart} />
          {scene.chart!.unverified && (
            <p className="reel-untraced">{scene.chart!.unverified_note}</p>
          )}
        </div>
      )}
    </article>
  );
}

/** Runtime summary, outstanding checks, house style and the scene-by-scene board. */
export default function ReelStoryboard({
  spec,
  warnings,
  stage = 'storyboard',
}: {
  spec: ReelSpec;
  warnings: string[];
  stage?: 'script' | 'storyboard' | 'prompts';
}) {
  return (
    <>
      <dl className="reel-meta">
        <div>
          <dt>Runtime</dt>
          <dd>{spec.total_seconds}s</dd>
        </div>
        <div>
          <dt>Scenes</dt>
          <dd>{spec.scenes.length}</dd>
        </div>
        <div>
          <dt>Format</dt>
          <dd>{spec.format.aspect} · {spec.format.width}x{spec.format.height} · {spec.format.fps}fps</dd>
        </div>
        <div>
          <dt>Figures</dt>
          <dd>{warnings.length ? `${warnings.length} to check` : 'all traced'}</dd>
        </div>
        <div>
          <dt>Pass</dt>
          <dd>{stage}</dd>
        </div>
      </dl>

      {warnings.length > 0 ? (
        <section className="reel-warnings">
          <h3>Checks outstanding</h3>
          <p>
            These have to clear before the next pass. Regenerating usually fixes wording and
            budget breaches; an untraceable figure means the brief asserted something the story
            does not carry.
          </p>
          <ul>
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </section>
      ) : (
        <p className="reel-clear">
          {stage === 'script'
            ? 'Every spoken figure traces back to the story evidence, and every scene fits its read.'
            : 'Every figure on screen traces back to the story evidence, and every scene fits its read.'}
        </p>
      )}

      <section className="reel-style">
        <h3>Held constant across every scene</h3>
        <dl>
          <div><dt>Presenter</dt><dd>{spec.style.presenter}</dd></div>
          <div><dt>Look</dt><dd>{spec.style.look}</dd></div>
          <div><dt>Voice</dt><dd>{spec.style.voice}</dd></div>
          <div><dt>Audio</dt><dd>{spec.style.audio}</dd></div>
        </dl>
      </section>

      <h2 className="reel-h2">{stage === 'script' ? 'Script' : 'Storyboard'}</h2>
      <div className="reel-scenes">
        {spec.scenes.map((scene, i) => (
          <SceneCard
            key={scene.id}
            scene={scene}
            index={i}
            showVisuals={stage !== 'script'}
          />
        ))}
      </div>
    </>
  );
}
