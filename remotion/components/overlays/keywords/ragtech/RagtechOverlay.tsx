import React from 'react';
import { staticFile, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import type { Brand } from '../../../../types/brand';

const MONO = "'SF Mono', 'Monaco', 'Cascadia Code', 'Consolas', monospace";

// Episode images from public/assets/episodes
const EPISODE_IMAGES = [
  'assets/episodes/ep_10x.webp',
  'assets/episodes/ep_ai.jpg',
  'assets/episodes/ep_career.jpg',
  'assets/episodes/ep_career1.webp',
  'assets/episodes/ep_imposter.jpg',
  'assets/episodes/ep_introvert.webp',
  'assets/episodes/ep_joy.jpg',
  'assets/episodes/ep_leadership.webp',
  'assets/episodes/ep_martin.jpg',
  'assets/episodes/ep_martin1.webp',
  'assets/episodes/ep_promotion.jpg',
  'assets/episodes/ep_saloni.webp',
];

export type RagtechOverlayProps = {
  brand: Brand;
  durationInFrames: number;
};

export const RagtechOverlay: React.FC<RagtechOverlayProps> = ({ brand, durationInFrames }) => {
  const { fps, width } = useVideoConfig();
  const frame = useCurrentFrame();
  const { shape } = brand;

  const safeDuration = Math.max(16, Math.floor(durationInFrames));
  const localFrame = frame;
  const isEntering = localFrame < Math.min(15, safeDuration * 0.2);
  const isExiting = localFrame >= safeDuration - Math.min(15, safeDuration * 0.2);

  const enterProgress = isEntering
    ? spring({ frame: localFrame, fps, config: { damping: 12, stiffness: 200 } })
    : 1;

  const exitProgress = isExiting
    ? spring({
        frame: localFrame - (safeDuration - Math.min(15, safeDuration * 0.2)),
        fps,
        config: { damping: 12, stiffness: 200 },
      })
    : 0;

  const slideProgress = interpolate(enterProgress, [0, 1], [100, 0]);
  const exitSlide = interpolate(exitProgress, [0, 1], [0, -50]);

  const opacity = interpolate(
    localFrame,
    [0, 8, safeDuration - 8, safeDuration],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Right third of the screen for episodes
  const rightThirdWidth = width * 0.33;
  const gridGap = 8;
  const imagesPerRow = 3;
  const imageSize = (rightThirdWidth - (imagesPerRow + 1) * gridGap) / imagesPerRow;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 60px',
        opacity,
        transform: `translateX(${slideProgress + exitSlide}px)`,
      }}
    >
      {/* Left side: Logo and Terminal */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
        {/* Logo */}
        <img
          src={staticFile('assets/logo/transparent-bg-logo.png')}
          style={{
            height: 180,
            objectFit: 'contain',
            flexShrink: 0,
          }}
        />

        {/* Terminal */}
        <div style={{ position: 'relative' }}>
          {/* Chrome */}
          <div
            style={{
              background: '#21262d',
              borderRadius: `${shape.borderRadius}px ${shape.borderRadius}px 0 0`,
              padding: '10px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57' }} />
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e' }} />
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840' }} />
            <span style={{ fontFamily: MONO, fontSize: 13, color: '#8b949e', marginLeft: 10 }}>
              ~/ragtech — zsh
            </span>
          </div>

          {/* Body */}
          <div
            style={{
              background: '#0d1117',
              borderRadius: `0 0 ${shape.borderRadius}px ${shape.borderRadius}px`,
              padding: '24px 32px',
              color: '#e6edf3',
              minWidth: 380,
              boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
            }}
          >
            {/* Dim prompt header */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, opacity: 0.45 }}>
              <span style={{ color: brand.colors.accent, fontFamily: MONO, marginRight: 8 }}>❯</span>
              <span style={{ color: '#8b949e', fontFamily: MONO, fontSize: 13 }}>about.ts</span>
            </div>

            {/* Main text */}
            <div
              style={{
                fontFamily: brand.typography.fontFamily,
                fontSize: 28,
                fontWeight: brand.typography.weights.bold,
                color: '#e6edf3',
                lineHeight: 1.3,
                letterSpacing: '-0.01em',
              }}
            >
              a tech podcast by real people in tech
            </div>
          </div>
        </div>
      </div>

      {/* Right third: Episode screenshots grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${imagesPerRow}, ${imageSize}px)`,
          gap: gridGap,
          padding: gridGap,
          background: 'rgba(13, 17, 23, 0.8)',
          borderRadius: shape.borderRadius,
          backdropFilter: 'blur(10px)',
        }}
      >
        {EPISODE_IMAGES.map((src, idx) => (
          <img
            key={idx}
            src={staticFile(src)}
            style={{
              width: imageSize,
              height: imageSize,
              objectFit: 'cover',
              borderRadius: shape.borderRadiusSmall,
              opacity: 0.9,
            }}
          />
        ))}
      </div>
    </div>
  );
};
