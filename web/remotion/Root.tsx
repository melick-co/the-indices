import React from 'react';
import { Composition } from 'remotion';
import { CUT_COMPOSITION_ID, CUT_FPS, CUT_HEIGHT, CUT_WIDTH, DEMO_PROPS, totalFrames, type CutProps } from '../lib/reel-cut-types';
import { Reel } from './Reel';
import { BarRace } from './BarRace';
import { DEMO_RACE, RACE_COMPOSITION_ID, RACE_FPS, RACE_SIZE, raceFrames, type RaceProps } from '../lib/race-video-types';

/** The reel, and the bar-chart race (its size and length come from its props). */
export const Root: React.FC = () => (
  <>
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

  <Composition
    id={RACE_COMPOSITION_ID}
    component={BarRace}
    width={1080}
    height={1920}
    fps={RACE_FPS}
    durationInFrames={raceFrames(DEMO_RACE)}
    defaultProps={{ race: DEMO_RACE, format: '9:16', musicFile: null } as RaceProps}
    calculateMetadata={async ({ props }: { props: RaceProps }) => ({ durationInFrames: raceFrames(props.race), ...RACE_SIZE[props.format] })}
  />
  </>
);
