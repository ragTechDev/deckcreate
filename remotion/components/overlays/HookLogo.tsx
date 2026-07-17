import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame, interpolate } from 'remotion';

interface HookLogoProps {
  /** Frame when the hooks section starts (for fade in) */
  startFrame: number;
  /** Frame when the hooks section ends (for fade out) */
  endFrame: number;
}

const LOGO = staticFile('assets/logo/transparent-bg-logo.png');

export const HookLogo: React.FC<HookLogoProps> = ({ startFrame, endFrame }) => {
  const frame = useCurrentFrame();

  const fadeIn = interpolate(
    frame,
    [startFrame, startFrame + 15],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const fadeOut = interpolate(
    frame,
    [endFrame - 15, endFrame],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const opacity = Math.min(fadeIn, fadeOut) * 0.95;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 150 }}>
      <Img
        src={LOGO}
        style={{
          position: 'absolute',
          bottom: 48,
          right: 40,
          height: 130,
          objectFit: 'contain',
          opacity,
        }}
      />
    </AbsoluteFill>
  );
};
