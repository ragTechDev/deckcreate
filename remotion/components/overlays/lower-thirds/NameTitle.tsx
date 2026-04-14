import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate, AbsoluteFill, staticFile } from 'remotion';
import type { Brand } from '../../../types/brand';

const MONO = "'SF Mono', 'Monaco', 'Cascadia Code', 'Consolas', monospace";
const TECHYBARA = staticFile('assets/techybara/techybara-holding-laptop.png');

export interface NameTitleProps {
  brand: Brand;
  name: string;
  title: string;
  durationInFrames: number;
}

export const NameTitle: React.FC<NameTitleProps> = ({
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

  // Just name + role — no wrapper object
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
    <AbsoluteFill
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'flex-end',
        padding: '0 80px 52px',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          transform: `translateX(${translateX}px)`,
          opacity,
        }}
      >
        {/* Techybara — overlaps the terminal's left edge */}
        <img
          src={TECHYBARA}
          style={{
            height: 164,
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
              padding: '16px 28px 20px',
              fontFamily: MONO,
              fontSize: 22,
              lineHeight: 1.7,
              color: '#e6edf3',
              minWidth: 400,
              boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
            }}
          >
            {/* Dim prompt header */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, opacity: 0.45 }}>
              <span style={{ color: colors.secondary, marginRight: 8 }}>❯</span>
              <span style={{ color: '#8b949e' }}>speaker.ts</span>
            </div>

            {/* Code lines */}
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

            {/* Blinking prompt after done */}
            {typingDone && (
              <div style={{ display: 'flex', alignItems: 'center', marginTop: 4 }}>
                <span style={{ color: colors.secondary, marginRight: 8 }}>❯</span>
                {showCursor && cursor}
              </div>
            )}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
