import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate, AbsoluteFill, staticFile } from 'remotion';
import type { Brand } from '../../../types/brand';

const MONO = "'SF Mono', 'Monaco', 'Cascadia Code', 'Consolas', monospace";
const LOGO = staticFile('assets/logo/transparent-bg-logo.png');

export interface ChapterMarkerProps {
  brand: Brand;
  chapterTitle?: string;
  durationInFrames: number;
  nextMarkerFrame?: number;
  side?: 'left' | 'right';
}

// Loop duration for typing animation (in seconds)
const LOOP_SECONDS = 180; // 3 minutes
const TYPE_PAUSE_SECONDS = 60; // 1 minute pause between loops

export const ChapterMarker: React.FC<ChapterMarkerProps> = ({
  brand,
  chapterTitle = 'Chapter',
  durationInFrames,
  nextMarkerFrame,
  side = 'right',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentGlobalFrame = frame; // frame within this Sequence

  const { colors, shape } = brand;

  // Calculate loop cycle
  const loopFrames = LOOP_SECONDS * fps;
  const pauseFrames = TYPE_PAUSE_SECONDS * fps;
  const cycleFrames = loopFrames + pauseFrames;
  const cyclePosition = frame % cycleFrames;

  // Determine if we're in typing phase or pause phase
  const isTypingPhase = cyclePosition < loopFrames;
  const isPausePhase = !isTypingPhase;

  // Entry animation (only on first appearance)
  const entrySpring = spring({
    frame: Math.min(frame, 15),
    fps,
    config: { damping: 22, stiffness: 90, mass: 1 }
  });

  const slideIn = interpolate(entrySpring, [0, 1], [-80, 0]);
  const entryOpacity = interpolate(frame, [0, 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Fade to 0.5 opacity after 3 seconds
  const FADE_START_FRAMES = 3 * fps;
  let opacity = interpolate(
    frame,
    [0, FADE_START_FRAMES, FADE_START_FRAMES + 30],
    [entryOpacity, 1, 0.5],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Fade out before next marker appears
  if (nextMarkerFrame !== undefined) {
    const fadeOutStart = durationInFrames - 60; // Start fading 1s before end
    if (frame > fadeOutStart) {
      opacity = interpolate(frame, [fadeOutStart, durationInFrames], [opacity, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
    }
  }

  // Terminal content
  const chapterLine = `chapter: "${chapterTitle}",`;
  const codeLines = [chapterLine];

  // Typing animation within the loop
  const TYPE_START_FRAMES = 15;
  const charsPerFrame = 2;
  const totalChars = codeLines.reduce((s, l) => s + l.length, 0);
  const typeDurationFrames = totalChars / charsPerFrame;

  // Calculate typing progress
  let charsRevealed = 0;
  if (isTypingPhase) {
    const typingFrame = Math.max(0, cyclePosition - TYPE_START_FRAMES);
    charsRevealed = Math.floor(
      interpolate(
        typingFrame,
        [0, typeDurationFrames],
        [0, totalChars],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
      ),
    );
  } else {
    // During pause phase, show all characters
    charsRevealed = totalChars;
  }

  let remaining = charsRevealed;
  const lineChars = codeLines.map((line) => {
    const visible = Math.min(remaining, line.length);
    remaining = Math.max(0, remaining - line.length);
    return visible;
  });

  const typingDone = charsRevealed >= totalChars;
  const showCursor = Math.floor(frame / 18) % 2 === 0;

  const renderLine = () => (
    <>
      <span style={{ color: colors.accent }}>chapter</span>
      <span style={{ color: '#e6edf3' }}>: </span>
      <span style={{ color: colors.secondary }}>"{chapterTitle}"</span>
      <span style={{ color: '#e6edf3' }}>,</span>
    </>
  );

  const cursor = (
    <span
      style={{
        display: 'inline-block',
        width: 2,
        height: '1em',
        background: colors.accent,
        marginLeft: 1,
        verticalAlign: 'text-bottom',
      }}
    />
  );

  return (
    <div
      style={{
        position: 'absolute',
        ...(side === 'left' ? { top: 120, left: 50 } : { top: 3, right: 3 }),
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        pointerEvents: 'none',
        transform: `translateX(${slideIn}px)`,
        opacity,
      }}
    >
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
              ~/ragtech — chapter.ts
            </span>
          </div>

          {/* Body */}
          <div
            style={{
              background: '#0d1117',
              borderRadius: `0 0 ${shape.borderRadius}px ${shape.borderRadius}px`,
              padding: '16px 28px 20px',
              fontFamily: MONO,
              fontSize: 18,
              lineHeight: 1.7,
              color: '#e6edf3',
              minWidth: 320,
              boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
            }}
          >
            {/* Dim prompt header */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, opacity: 0.45 }}>
              <span style={{ color: colors.accent, marginRight: 8 }}>❯</span>
              <span style={{ color: '#8b949e' }}>chapter.ts</span>
            </div>

            {/* Code line */}
            {lineChars[0] > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', whiteSpace: 'pre' }}>
                {lineChars[0] === chapterLine.length ? renderLine() : (
                  <span style={{ color: '#e6edf3' }}>{chapterLine.slice(0, lineChars[0])}</span>
                )}
                {lineChars[0] !== chapterLine.length && showCursor && cursor}
              </div>
            )}

            {/* Blinking prompt after done */}
            {typingDone && isTypingPhase && (
              <div style={{ display: 'flex', alignItems: 'center', marginTop: 4 }}>
                <span style={{ color: colors.accent, marginRight: 8 }}>❯</span>
                {showCursor && cursor}
              </div>
            )}

            {/* Pause indicator */}
            {isPausePhase && (
              <div style={{ display: 'flex', alignItems: 'center', marginTop: 4, opacity: 0.5 }}>
                <span style={{ color: colors.accent, marginRight: 8 }}>❯</span>
                <span style={{ fontSize: 12, color: '#8b949e' }}>// waiting...</span>
              </div>
            )}
          </div>
        </div>

        {/* Logo — to the right of the terminal, overlapping */}
        <img
          src={LOGO}
          style={{
            height: 120,
            objectFit: 'contain',
            position: 'relative',
            zIndex: 2,
            marginLeft: -30,
            flexShrink: 0,
            alignSelf: 'center',
          }}
        />
    </div>
  );
};
