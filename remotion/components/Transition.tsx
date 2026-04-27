import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, AbsoluteFill, staticFile, Audio, Sequence } from 'remotion';
import { whoosh } from '@remotion/sfx';

interface TransitionProps {
  /** Frame at which the transition starts (end of hooks, start of main) */
  startFrame: number;
  /** Duration of transition in frames (default: 30 frames = 0.5s at 60fps) */
  durationInFrames?: number;
}

export const Transition: React.FC<TransitionProps> = ({
  startFrame,
  durationInFrames = 30,
}) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();

  // Only render Sequence during transition window for better performance
  if (frame < startFrame || frame > startFrame + durationInFrames) {
    return null;
  }

  return (
    <Sequence from={startFrame} durationInFrames={durationInFrames}>
      <TransitionContent durationInFrames={durationInFrames} />
    </Sequence>
  );
};

interface TransitionContentProps {
  durationInFrames: number;
}

const TransitionContent: React.FC<TransitionContentProps> = ({
  durationInFrames,
}) => {
  const frame = useCurrentFrame();

  // Flash effect - white flash that fades
  const flashOpacity = interpolate(
    frame,
    [0, 5, 15, durationInFrames],
    [0, 0.8, 0.3, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Logo scale animation
  const scale = interpolate(
    frame,
    [5, 15, durationInFrames - 5, durationInFrames],
    [0.8, 1, 1, 0.9],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  const textOpacity = interpolate(
    frame,
    [5, 10, durationInFrames - 10, durationInFrames - 5],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 200 }}>
      {/* Whoosh sound effect */}
      <Audio src={whoosh} volume={0.5} />

      {/* White flash overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: '#ffffff',
          opacity: flashOpacity,
        }}
      />

      {/* Logo reveal */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `scale(${scale})`,
          opacity: textOpacity,
        }}
      >
        <img
          src={staticFile('assets/logo/transparent-bg-logo.png')}
          alt="Logo"
          style={{
            height: '600px',
            width: 'auto',
            filter: 'drop-shadow(0 4px 20px rgba(0,0,0,0.5))',
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
