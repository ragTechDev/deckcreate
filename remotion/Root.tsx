import React from 'react';
import {Composition} from 'remotion';
import {MyComposition, calculateMetadata} from './Composition';

export const RemotionRoot: React.FC = () => {
  return (
    <>
        <Composition
        id="MyComp"
        component={MyComposition}
        durationInFrames={300}
        fps={60}
        width={1920}
        height={1080}
        defaultProps={{
            src: 'video/isCodingRelevant.mp4',
            audioSrc: 'audio/isCodeRelevant.mp3',
            audioStartFrom: 0, // Assume audio is synced from the start
        }}
        calculateMetadata={calculateMetadata}
        />
    </>
  );
};