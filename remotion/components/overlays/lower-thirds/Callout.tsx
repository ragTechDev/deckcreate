import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate, staticFile, Img } from 'remotion';
import type { Brand } from '../../../types/brand';

const MONO = "'SF Mono', 'Monaco', 'Cascadia Code', 'Consolas', monospace";
const TECHYBARA = staticFile('assets/techybara/techybara-front.png');

interface CalloutProps {
  brand: Brand;
  text: string;
  durationInFrames: number;
}

export const Callout: React.FC<CalloutProps> = ({
  brand,
  text,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const safeDuration = Math.max(30, durationInFrames);
  const exitStart = safeDuration - 15;

  const slideIn = spring({ frame, fps, config: { damping: 22, stiffness: 90, mass: 1 } });
  const slideOut = frame > exitStart
    ? spring({ frame: frame - exitStart, fps, config: { damping: 22, stiffness: 90, mass: 1 } })
    : 0;

  const translateY = interpolate(slideIn - slideOut, [0, 1], [120, 0]);
  const opacity = interpolate(
    frame,
    [0, 8, exitStart, safeDuration],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  // Text fades in with a short delay
  const textOpacity = interpolate(
    frame,
    [15, 27],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const { colors, typography, shape } = brand;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '5%',
        right: '5%',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          transform: `translateX(50px) translateY(${translateY}px)`,
          opacity,
          overflow: 'visible',
        }}
      >
        {/* Techybara holding from top — overlaps the terminal's top edge */}
        <Img
          src={TECHYBARA}
          alt=""
          style={{
            height: 180,
            objectFit: 'contain',
            position: 'relative',
            zIndex: 2,
            marginBottom: -28,
            flexShrink: 0,
            opacity: 1,
            willChange: 'transform',
          }}
        />

        {/* Terminal window */}
        <div style={{ position: 'relative', zIndex: 1 }}>

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
              ~/ragtech — callout.ts
            </span>
          </div>

          {/* Body */}
          <div
            style={{
              background: '#0d1117',
              borderRadius: `0 0 ${shape.borderRadius}px ${shape.borderRadius}px`,
              padding: '16px 28px 24px',
              fontFamily: MONO,
              fontSize: 26,
              lineHeight: 1.7,
              color: '#e6edf3',
              minWidth: 640,
              boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
            }}
          >
            {/* Dim prompt header */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, opacity: 0.45 }}>
              <span style={{ color: colors.accent, marginRight: 8 }}>❯</span>
              <span style={{ color: '#8b949e' }}>callout.ts</span>
            </div>

            {/* Icon/prefix */}
            <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 10 }}>
              <span style={{ color: colors.accent, fontWeight: 700, fontSize: 28, marginRight: 12 }}>💡</span>
              <span style={{ color: colors.accent, fontFamily: MONO, fontSize: 14, opacity: 0.7 }}>Key Insight:</span>
            </div>

            {/* Callout text */}
            <div style={{ opacity: textOpacity }}>
              <div
                style={{
                  fontFamily: typography.fontFamily,
                  fontSize: 28,
                  fontWeight: typography.weights.semiBold,
                  color: '#e6edf3',
                  lineHeight: 1.45,
                  letterSpacing: '0.01em',
                  borderLeft: `3px solid ${colors.accent}`,
                  paddingLeft: 16,
                }}
              >
                {text}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
