import React from 'react';
import { Composition } from 'remotion';
import { CUT_COMPOSITION_ID, CUT_FPS, CUT_HEIGHT, CUT_WIDTH, DEMO_PROPS, totalFrames, type CutProps } from '../lib/reel-cut-types';
import { Reel } from './Reel';

/** One composition; its length is whatever the scenes add up to. */
export const Root: React.FC = () => (
  <Composition
    id={CUT_COMPOSITION_ID}
    component={Reel}
    width={CUT_WIDTH}
    height={CUT_HEIGHT}
    fps={CUT_FPS}
    durationInFrames={totalFrames(DEMO_PROPS)}
    defaultProps={DEMO_PROPS}
    calculateMetadata={async ({ props }: { props: CutProps }) => ({ durationInFrames: totalFrames(props) })}
  />
);
