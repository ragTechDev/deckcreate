import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate, AbsoluteFill, staticFile } from 'remotion';
import type { Brand } from '../../../types/brand';

const MONO = "'SF Mono', 'Monaco', 'Cascadia Code', 'Consolas', monospace";

interface SpeakerIntroProps {
  brand: Brand;
  name: string;
  title: string;
  durationInFrames: number;
  showLogo?: boolean;
}

export const SpeakerIntro: React.FC<SpeakerIntroProps> = ({
  brand,
  name,
  title,
  durationInFrames,
  showLogo = true,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const safeDuration = Math.max(30, durationInFrames);
  const exitStart = safeDuration - 15;

  const slideIn = spring({
    frame,
    fps,
    config: { damping: 22, stiffness: 90, mass: 1 },
  });

  const slideOut =
    frame > exitStart
      ? spring({
          frame: frame - exitStart,
          fps,
          config: { damping: 22, stiffness: 90, mass: 1 },
        })
      : 0;

  const translateX = interpolate(slideIn - slideOut, [0, 1], [-80, 0]);

  const opacity = interpolate(
    frame,
    [0, 8, exitStart, safeDuration],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const { colors, typography, shape, logo } = brand;

  // Typewriter effect for the role line: role: "Software Developer"
  const roleStr = `role: "${title}"`;
  const typeStart = 12;
  const typeEnd = typeStart + roleStr.length * 2;
  const visibleChars = Math.floor(
    interpolate(frame, [typeStart, typeEnd], [0, roleStr.length], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  const isTyping = frame >= typeStart && visibleChars < roleStr.length;
  const showCursor =
    isTyping || (visibleChars === roleStr.length && Math.floor(frame / 18) % 2 === 0);

  // Colour segments: "role:" in accent, `: "..."` in secondary
  const rendered = roleStr.slice(0, visibleChars);
  const keyPart = rendered.slice(0, Math.min(rendered.length, 5)); // "role:"
  const valPart = rendered.slice(5);

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'flex-end',
        padding: '60px 80px',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          transform: `translateX(${translateX}px)`,
          opacity,
          display: 'flex',
          alignItems: 'center',
          gap: 20,
        }}
      >
        {showLogo && logo && (
          <img
            src={staticFile(logo)}
            style={{
              width: 72,
              height: 72,
              objectFit: 'contain',
              filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.2))',
              flexShrink: 0,
            }}
          />
        )}

        {/* White card */}
        <div
          style={{
            background: '#FFFFFF',
            borderLeft: `5px solid ${colors.primary}`,
            borderRadius: `0 ${shape.borderRadius}px ${shape.borderRadius}px 0`,
            padding: '20px 36px 20px 28px',
            boxShadow: '0 8px 40px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08)',
          }}
        >
          {/* Name */}
          <div
            style={{
              fontFamily: typography.fontFamily,
              fontSize: 48,
              fontWeight: typography.weights.black,
              color: '#0F0F1A',
              lineHeight: 1.1,
              letterSpacing: '-0.01em',
            }}
          >
            {name}
          </div>

          {/* role: "Title" — typewriter */}
          <div
            style={{
              fontFamily: MONO,
              fontSize: 22,
              marginTop: 10,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <span style={{ color: colors.secondary, fontWeight: 600 }}>
              {keyPart}
            </span>
            <span style={{ color: '#71717a' }}>{valPart}</span>
            {showCursor && (
              <span
                style={{
                  display: 'inline-block',
                  width: 2,
                  height: '1em',
                  background: colors.primary,
                  marginLeft: 2,
                  verticalAlign: 'text-bottom',
                }}
              />
            )}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
