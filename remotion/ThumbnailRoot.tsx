import React from 'react';
import { Composition } from 'remotion';
import { PodcastThumbnailComposition } from './components/PodcastThumbnail';

export const ThumbnailRoot: React.FC = () => (
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
);
