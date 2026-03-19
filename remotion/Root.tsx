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
            src: '/video/IMG_5238.MOV',
            audioSrc: '/audio/your-audio-file.mp3', // Replace with your audio file path
            audioStartFrom: 0, // Start audio from 0 seconds (sync with video start)
        }}
        calculateMetadata={calculateMetadata}
        />
    </>
  );
};