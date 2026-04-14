import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate, AbsoluteFill, staticFile } from 'remotion';
import type { Brand } from '../../../types/brand';

const MONO = "'SF Mono', 'Monaco', 'Cascadia Code', 'Consolas', monospace";
const TECHYBARA = staticFile('assets/techybara/techybara-teacher.png');

interface ConceptExplainerProps {
  brand: Brand;
  keyPhrase: string;
  description: string;
  durationInFrames: number;
}

export const ConceptExplainer: React.FC<ConceptExplainerProps> = ({
  brand,
  keyPhrase,
  description,
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

  const translateY = interpolate(slideIn - slideOut, [0, 1], [60, 0]);
  const opacity = interpolate(
    frame,
    [0, 8, exitStart, safeDuration],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  // Typewriter for $ command line
  const cmdPrefix = '$ define ';
  const cmdFull = `${cmdPrefix}"${keyPhrase}"`;
  const typeStart = 10;
  const typeEnd = typeStart + cmdFull.length * 1.5;
  const visibleChars = Math.floor(
    interpolate(frame, [typeStart, typeEnd], [0, cmdFull.length], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  const isTyping = frame >= typeStart && visibleChars < cmdFull.length;
  const showCursor =
    isTyping || (visibleChars === cmdFull.length && Math.floor(frame / 18) % 2 === 0);

  // Description fades in after command is fully typed
  const descOpacity = interpolate(
    frame,
    [typeEnd, typeEnd + 12],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const { colors, typography, shape } = brand;

  // Colour segments for the command line
  const rendered = cmdFull.slice(0, visibleChars);
  const prefixVisible = rendered.slice(0, Math.min(rendered.length, cmdPrefix.length));
  const keyVisible = rendered.slice(cmdPrefix.length);

  const cursor = (
    <span
      style={{
        display: 'inline-block',
        width: 2,
        height: '1em',
        background: colors.primary,
        marginLeft: 1,
        verticalAlign: 'text-bottom',
      }}
    />
  );

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        padding: '0 0 52px',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          transform: `translateX(-20px) translateY(${translateY}px)`,
          opacity,
        }}
      >
        {/* Techybara teacher — overlaps the terminal's left edge */}
        <img
          src={TECHYBARA}
          style={{
            height: 180,
            objectFit: 'contain',
            position: 'relative',
            zIndex: 2,
            marginRight: -28,
            flexShrink: 0,
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
              ~/ragtech — zsh
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
              <span style={{ color: colors.secondary, marginRight: 8 }}>❯</span>
              <span style={{ color: '#8b949e' }}>define.ts</span>
            </div>

            {/* $ command line — typewriter */}
            <div style={{ display: 'flex', alignItems: 'center', whiteSpace: 'pre', marginBottom: 16 }}>
              {prefixVisible.length > 0 && (
                <span style={{ color: colors.primary, fontWeight: 700 }}>{'$ '}</span>
              )}
              {prefixVisible.length > 2 && (
                <span style={{ color: colors.secondary }}>{prefixVisible.slice(2)}</span>
              )}
              {keyVisible && (
                <span style={{ color: '#e6edf3' }}>{keyVisible}</span>
              )}
              {showCursor && cursor}
            </div>

            {/* Output — description */}
            <div style={{ opacity: descOpacity }}>
              <div style={{ fontSize: 14, color: '#484f58', marginBottom: 10, letterSpacing: '0.03em' }}>
                {'> output:'}
              </div>
              <div
                style={{
                  fontFamily: typography.fontFamily,
                  fontSize: 28,
                  fontWeight: typography.weights.semiBold,
                  color: '#e6edf3',
                  lineHeight: 1.45,
                  letterSpacing: '0.01em',
                }}
              >
                {description}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
