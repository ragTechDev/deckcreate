import React from 'react';
import {Composition} from 'remotion';
import {MyComposition, calculateMetadata} from './Composition';

export const RemotionRoot: React.FC = () => {
  return (
    <>
        <Composition
        id="ragTechVodcast"
        component={MyComposition}
        durationInFrames={300}
        fps={60}
        width={1920}
        height={1080}
        defaultProps={{
            src: 'output/synced-output.mp4',
            transcriptSrc: 'output/transcript.json',
        }}
        calculateMetadata={calculateMetadata}
        />
    </>
  );
};