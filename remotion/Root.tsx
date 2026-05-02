import React from 'react';
import {Composition} from 'remotion';
import {MyComposition, calculateMetadata} from './Composition';
import { ShortFormClip, calculateShortMetadata } from './ShortFormClip';
import { OverlayGalleryComposition, GALLERY_TOTAL_FRAMES } from './components/OverlayGallery';

// require.context is a webpack API — scans public/shorts/ at bundle time
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SHORT_IDS: string[] = (() => {
  try {
    return (require as any)
      .context('../public/shorts', true, /\/transcript\.json$/)
      .keys()
      .map((k: string) => k.split('/')[1]);
  } catch {
    // Directory doesn't exist - no shorts configured yet
    return [];
  }
})();

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
        {SHORT_IDS.map((shortId) => (
          <Composition
            key={shortId}
            id={`ShortFormClip-${shortId}`}
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
        ))}
    </>
  );
};