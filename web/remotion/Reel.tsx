import React, { useEffect, useState } from 'react';
import { AbsoluteFill, Audio, Sequence, cancelRender, continueRender, delayRender, interpolate, staticFile, useVideoConfig } from 'remotion';
import { VOICE_LEAD_SECONDS, framesFor, type CutProps } from '../lib/reel-cut-types';
import { loadFonts } from './fonts';
import { Scene } from './scenes';
import { PAPER } from './theme';

/**
 * The reel: scenes in storyboard order, each holding for its planned seconds, each with its own
 * read starting a beat after the frame settles. The paper never cuts, so a scene change is a
 * change of what is printed on it.
 */
export const Reel: React.FC<CutProps> = (props) => {
  const [handle] = useState(() => delayRender('Loading the house fonts'));
  useEffect(() => {
    loadFonts().then(() => continueRender(handle)).catch((e) => cancelRender(e));
  }, [handle]);

  const { durationInFrames } = useVideoConfig();
  let from = 0;
  return (
    <AbsoluteFill style={{ background: PAPER }}>
      {/* The house track, low under the voiceover, faded in and out. */}
      {props.music && (
        <Audio src={staticFile(props.music)} loop volume={(f) => interpolate(f, [0, 20, durationInFrames - 40, durationInFrames], [0, 0.16, 0.16, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} />
      )}
      {props.scenes.map((scene, i) => {
        const frames = framesFor(scene.seconds);
        const start = from;
        from += frames;
        return (
          <Sequence key={scene.id} from={start} durationInFrames={frames} name={`${i + 1} ${scene.kind}`}>
            <Scene scene={scene} index={i} total={props.scenes.length} props={props} />
            {scene.voice && (
              <Sequence from={framesFor(VOICE_LEAD_SECONDS)} name={`${i + 1} voice`}>
                <Audio src={staticFile(scene.voice.file)} />
              </Sequence>
            )}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
