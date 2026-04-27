import React from 'react';
import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion';
import type { Brand } from '../../types/brand';

interface HookTitleProps {
  brand: Brand;
  title: string;
  /** Frame when hooks section starts (for fade in) */
  startFrame: number;
  /** Frame when hooks section ends (for fade out) */
  endFrame: number;
}

export const HookTitle: React.FC<HookTitleProps> = ({
  brand,
  title,
  startFrame,
  endFrame,
}) => {
  const frame = useCurrentFrame();
  const { typography } = brand;

  // Fade in during first 15 frames of hooks
  const fadeIn = interpolate(
    frame,
    [startFrame, startFrame + 15],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Fade out during last 15 frames of hooks
  const fadeOut = interpolate(
    frame,
    [endFrame - 15, endFrame],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  const opacity = Math.min(fadeIn, fadeOut);

  // Slide up animation
  const translateY = interpolate(
    frame,
    [startFrame, startFrame + 15],
    [30, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          top: '20%',
          left: '5%',
          right: '5%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          opacity,
          transform: `translateY(${translateY}px)`,
        }}
      >
        <div
          style={{
            fontFamily: typography.fontFamily,
            fontSize: 72,
            fontWeight: typography.weights.bold,
            color: '#ffffff',
            textShadow: '0 2px 20px rgba(0,0,0,0.8), 0 0 40px rgba(0,0,0,0.4)',
            lineHeight: 1.2,
            maxWidth: '90%',
          }}
          dangerouslySetInnerHTML={{
            __html: title.replace(/\*\*(.*?)\*\*/g, `<strong style="color: ${brand.colors.primary}">$1</strong>`),
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
