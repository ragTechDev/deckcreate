import { registerRoot } from 'remotion';
import React from 'react';
import { Composition } from 'remotion';
import { OverlayGalleryComposition, GALLERY_TOTAL_FRAMES } from './components/OverlayGallery';

const GalleryRoot: React.FC = () => (
  React.createElement(Composition, {
    id: 'OverlayGallery',
    component: OverlayGalleryComposition,
    durationInFrames: GALLERY_TOTAL_FRAMES,
    fps: 60,
    width: 1920,
    height: 1080,
  })
);

registerRoot(GalleryRoot);
