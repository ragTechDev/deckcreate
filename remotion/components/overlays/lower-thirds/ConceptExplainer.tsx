import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate, AbsoluteFill } from 'remotion';
import type { Brand } from '../../../types/brand';

const MONO = "'SF Mono', 'Monaco', 'Cascadia Code', 'Consolas', monospace";

interface ConceptExplainerProps {
  brand: Brand;
  keyPhrase: string;
  description: string;
  durationInFrames: number;
}

/** Traffic-light dots for the terminal chrome bar */
const WindowDots: React.FC = () => (
  <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
    {(['#ff5f57', '#febc2e', '#28c840'] as const).map((c) => (
      <div
        key={c}
        style={{
          width: 13,
          height: 13,
          borderRadius: '50%',
          background: c,
          flexShrink: 0,
        }}
      />
    ))}
  </div>
);

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

  const slideIn = spring({
    frame,
    fps,
    config: { damping: 22, stiffness: 120, mass: 0.9 },
  });

  const slideOut =
    frame > exitStart
      ? spring({
          frame: frame - exitStart,
          fps,
          config: { damping: 22, stiffness: 120, mass: 0.9 },
        })
      : 0;

  const translateY = interpolate(slideIn - slideOut, [0, 1], [60, 0]);

  const opacity = interpolate(
    frame,
    [0, 8, exitStart, safeDuration],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  // Typewriter for the $ command line — starts after the card slides in
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

  // Colour the "$" in brand primary, keyword in brand secondary
  const rendered = cmdFull.slice(0, visibleChars);
  const prefixVisible = rendered.slice(0, Math.min(rendered.length, cmdPrefix.length));
  const keyVisible = rendered.slice(cmdPrefix.length);

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingBottom: '8%',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          transform: `translateY(${translateY}px)`,
          opacity,
          width: 860,
          background: '#FFFFFF',
          borderRadius: shape.borderRadius * 1.5,
          overflow: 'hidden',
          boxShadow:
            '0 24px 64px rgba(0,0,0,0.16), 0 4px 16px rgba(0,0,0,0.10)',
        }}
      >
        {/* Terminal chrome bar */}
        <div
          style={{
            background: '#f5f5f5',
            borderBottom: '1.5px solid #e5e5e5',
            padding: '12px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <WindowDots />
          <span
            style={{
              fontFamily: MONO,
              fontSize: 13,
              color: '#9ca3af',
              letterSpacing: '0.04em',
              flex: 1,
              textAlign: 'center',
              marginRight: 52, // offset for dots width
            }}
          >
            rag-tech — bash
          </span>
        </div>

        {/* Terminal body */}
        <div
          style={{
            padding: '32px 40px 36px',
            background: '#FFFFFF',
            borderLeft: `5px solid ${colors.secondary}`,
          }}
        >
          {/* $ command line */}
          <div
            style={{
              fontFamily: MONO,
              fontSize: 28,
              lineHeight: 1.4,
              display: 'flex',
              alignItems: 'baseline',
              gap: 0,
              marginBottom: 20,
            }}
          >
            {/* $ prompt */}
            {prefixVisible.length > 0 && (
              <span style={{ color: colors.primary, fontWeight: 700 }}>
                {'$ '}
              </span>
            )}
            {/* "define " keyword */}
            {prefixVisible.length > 2 && (
              <span style={{ color: colors.secondary, fontWeight: 600 }}>
                {prefixVisible.slice(2)}
              </span>
            )}
            {/* quoted phrase */}
            {keyVisible && (
              <span style={{ color: '#0F0F1A' }}>{keyVisible}</span>
            )}
            {showCursor && (
              <span
                style={{
                  display: 'inline-block',
                  width: 3,
                  height: '1.1em',
                  background: colors.primary,
                  marginLeft: 2,
                  verticalAlign: 'text-bottom',
                }}
              />
            )}
          </div>

          {/* Output — description */}
          <div style={{ opacity: descOpacity }}>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 14,
                color: '#9ca3af',
                marginBottom: 8,
                letterSpacing: '0.03em',
              }}
            >
              {'> output:'}
            </div>
            <div
              style={{
                fontFamily: typography.fontFamily,
                fontSize: 32,
                fontWeight: typography.weights.semiBold,
                color: '#1a1a2e',
                lineHeight: 1.45,
                letterSpacing: '0.01em',
              }}
            >
              {description}
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
