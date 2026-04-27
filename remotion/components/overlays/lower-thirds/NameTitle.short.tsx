import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate, AbsoluteFill, staticFile } from 'remotion';
import type { Brand } from '../../../types/brand';

const MONO = "'SF Mono', 'Monaco', 'Cascadia Code', 'Consolas', monospace";
const TECHYBARA = staticFile('assets/techybara/techybara-holding-mic.png');

export interface NameTitleShortProps {
  brand: Brand;
  name: string;
  title: string;
  durationInFrames: number;
}

export const NameTitleShort: React.FC<NameTitleShortProps> = ({
  brand,
  name,
  title,
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

  const translateX = interpolate(slideIn - slideOut, [0, 1], [80, 0]);
  const opacity = interpolate(
    frame,
    [0, 8, exitStart, safeDuration],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const { colors, shape } = brand;

  const codeLines = [
    `name: "${name}",`,
    `role: "${title}",`,
  ];

  const TYPE_START = 12;
  const CHARS_PER_FRAME = 2;
  const totalChars = codeLines.reduce((s, l) => s + l.length, 0);

  const charsRevealed = Math.floor(
    interpolate(
      frame,
      [TYPE_START, TYPE_START + totalChars / CHARS_PER_FRAME],
      [0, totalChars],
      { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
    ),
  );

  let remaining = charsRevealed;
  const lineChars = codeLines.map((line) => {
    const visible = Math.min(remaining, line.length);
    remaining = Math.max(0, remaining - line.length);
    return visible;
  });

  const typingDone = charsRevealed >= totalChars;
  const showCursor = Math.floor(frame / 18) % 2 === 0;

  const renderLine = (i: number) => {
    if (i === 0) return (
      <>
        <span style={{ color: colors.primary }}>name</span>
        <span style={{ color: '#e6edf3' }}>: </span>
        <span style={{ color: colors.secondary }}>"{name}"</span>
        <span style={{ color: '#e6edf3' }}>,</span>
      </>
    );
    return (
      <>
        <span style={{ color: colors.primary }}>role</span>
        <span style={{ color: '#e6edf3' }}>: </span>
        <span style={{ color: colors.secondary }}>"{title}"</span>
        <span style={{ color: '#e6edf3' }}>,</span>
      </>
    );
  };

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
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          top: 1380,
          right: 80,
          display: 'flex',
          alignItems: 'flex-end',
          transform: `translateX(${translateX}px)`,
          opacity,
        }}
      >
        <img
          src={TECHYBARA}
          style={{
            height: 246,
            objectFit: 'contain',
            position: 'relative',
            zIndex: 2,
            marginRight: -42,
            flexShrink: 0,
          }}
        />

        <div style={{ position: 'relative', zIndex: 1 }}>
          <div
            style={{
              background: '#21262d',
              borderRadius: `${shape.borderRadius * 1.5}px ${shape.borderRadius * 1.5}px 0 0`,
              padding: '15px 27px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#ff5f57' }} />
            <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#febc2e' }} />
            <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#28c840' }} />
            <span style={{ fontFamily: MONO, fontSize: 20, color: '#8b949e', marginLeft: 15 }}>
              ~/ragtech — zsh
            </span>
          </div>

          <div
            style={{
              background: '#0d1117',
              borderRadius: `0 0 ${shape.borderRadius * 1.5}px ${shape.borderRadius * 1.5}px`,
              padding: '24px 42px 30px',
              fontFamily: MONO,
              fontSize: 33,
              lineHeight: 1.7,
              color: '#e6edf3',
              minWidth: 600,
              boxShadow: '0 15px 60px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, opacity: 0.45 }}>
              <span style={{ color: colors.secondary, marginRight: 12 }}>❯</span>
              <span style={{ color: '#8b949e' }}>speaker.ts</span>
            </div>

            {codeLines.map((line, i) => {
              if (lineChars[i] === 0) return null;
              const isComplete = lineChars[i] === line.length;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', whiteSpace: 'pre' }}>
                  {isComplete ? renderLine(i) : (
                    <span style={{ color: '#e6edf3' }}>{line.slice(0, lineChars[i])}</span>
                  )}
                  {!isComplete && showCursor && cursor}
                </div>
              );
            })}

            {typingDone && (
              <div style={{ display: 'flex', alignItems: 'center', marginTop: 6 }}>
                <span style={{ color: colors.secondary, marginRight: 12 }}>❯</span>
                {showCursor && cursor}
              </div>
            )}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
