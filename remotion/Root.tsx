import React from 'react';
import {Composition} from 'remotion';
import {MyComposition, calculateMetadata} from './Composition';
import { PodcastIntroComposition, INTRO_DURATION_FRAMES } from './components/PodcastIntro';

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
            src: 'input/video/synced-output-rekf.mp4',
            transcriptSrc: 'transcribe/output/edit/transcript.json',
            cameraProfilesSrc: 'transcribe/output/camera/camera-profiles.json',
            hookMusicSrc: 'sounds/jazz-cafe-music.mp3',
        }}
        calculateMetadata={calculateMetadata}
        />
    </>
  );
};