import React from 'react';
import {Composition, getInputProps} from 'remotion';
import {MyComposition, calculateMetadata} from './Composition';
import { ShortFormClip, calculateShortMetadata } from './ShortFormClip';
import { OverlayGalleryComposition, GALLERY_TOTAL_FRAMES } from './components/OverlayGallery';

export const RemotionRoot: React.FC = () => {
  // Support dynamic short selection via URL query parameter: ?shortId=mediocrity
  const inputProps = getInputProps();
  const shortId = (inputProps.shortId as string) || 'mediocrity';

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
        id="ShortFormClip"
        component={ShortFormClip}
        durationInFrames={300}
        fps={60}
        width={1080}
        height={1920}
        defaultProps={{
            src: 'sync/output/synced-output-1.mp4',
            transcriptSrc: `shorts/${shortId}/transcript.json`,
            cameraProfilesSrc: 'shorts/camera-profiles.json',
            brandSrc: 'brand.json',
            hookMusicSrc: 'sounds/hook-music.mp3',
        }}
        calculateMetadata={calculateShortMetadata}
        />
    </>
  );
};