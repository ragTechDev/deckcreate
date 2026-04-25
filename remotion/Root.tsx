import React from 'react';
import {Composition} from 'remotion';
import {MyComposition, calculateMetadata} from './Composition';
import { PodcastIntroComposition, INTRO_DURATION_FRAMES } from './components/PodcastIntro';
import { PodcastOutroComposition, OUTRO_DURATION_FRAMES } from './components/PodcastOutro';
import { OverlayGalleryComposition, GALLERY_TOTAL_FRAMES } from './components/OverlayGallery';
import { PodcastThumbnailComposition } from './components/PodcastThumbnail';

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
            src: 'sync/output/synced-output-1.mp4',
            transcriptSrc: 'edit/transcript.json',
            cameraProfilesSrc: 'camera/camera-profiles.json',
            hookMusicSrc: 'sounds/jazz-cafe-music.mp3',
        }}
        calculateMetadata={calculateMetadata}
        />
        <Composition
        id="OverlayGallery"
        component={OverlayGalleryComposition}
        durationInFrames={GALLERY_TOTAL_FRAMES}
        fps={60}
        width={1920}
        height={1080}
        />
        <Composition
        id="PodcastOutro"
        component={PodcastOutroComposition}
        durationInFrames={OUTRO_DURATION_FRAMES}
        fps={60}
        width={1920}
        height={1080}
        />
        <Composition
        id="PodcastThumbnail"
        component={PodcastThumbnailComposition}
        durationInFrames={1}
        fps={60}
        width={1280}
        height={720}
        defaultProps={{
            transcriptSrc: 'edit/transcript.json',
            brandSrc: 'brand.json',
            manifestSrc: 'thumbnail/cutouts/manifest.json',
            layoutVariant: 'left' as const,
        }}
        />
    </>
  );
};