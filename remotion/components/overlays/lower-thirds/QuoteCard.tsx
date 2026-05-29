import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import type { Brand } from '../../../types/brand';

const MONO = "'SF Mono', 'Monaco', 'Cascadia Code', 'Consolas', monospace";

/** Frames for the fade-out tail */
const EXIT_FRAMES = 20;
/** Characters typed per second */
const CHARS_PER_SECOND = 28;
/** Scrim max opacity — slightly stronger than TermTypewriter so the quote reads clearly */
const SCRIM_OPACITY = 0.62;
/** Frames after typing finishes before the attribution fades in */
const ATTRIBUTION_DELAY_FRAMES = 12;
/** Frames for the attribution fade-in */
const ATTRIBUTION_FADE_FRAMES = 20;
/** Cursor blink interval in frames */
const BLINK_INTERVAL = 18;

export interface QuoteCardProps {
  brand: Brand;
  /** The full quote text, e.g. "What man of us has never felt…" */
  quote: string;
  /**
   * Attribution shown below the quote, e.g. "Jorge Luis Borges, Dreamtigers (1960)".
   * Omit to show the quote alone.
   */
  attribution?: string;
  durationInFrames: number;
}

export const QuoteCard: React.FC<QuoteCardProps> = ({
  brand,
  quote,
  attribution,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // ── Timing ────────────────────────────────────────────────────────────────

  const safeDuration = Math.max(120, durationInFrames);
  const exitStart = safeDuration - EXIT_FRAMES;

  // ── Entrance: gentle upward spring + fade ─────────────────────────────────

  const enterSpring = spring({ frame, fps, config: { damping: 28, stiffness: 100, mass: 0.9 } });
  const translateY = interpolate(enterSpring, [0, 1], [28, 0]);

  // Shared opacity envelope — drives scrim, quote text, and decorative mark
  const opacity = interpolate(
    frame,
    [0, 8, exitStart, safeDuration],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  // ── Typewriter ────────────────────────────────────────────────────────────

  const typeStart = 6;
  const framesPerChar = fps / CHARS_PER_SECOND;
  const typeEnd = typeStart + quote.length * framesPerChar;

  const visibleChars = Math.floor(
    interpolate(frame, [typeStart, typeEnd], [0, quote.length], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  const typingDone = visibleChars >= quote.length;

  const blinkOn = Math.floor(frame / BLINK_INTERVAL) % 2 === 0;
  const cursorVisible = frame >= typeStart && (!typingDone || (frame < exitStart && blinkOn));

  // ── Attribution: fades in after typing completes ──────────────────────────

  const attrFadeStart = typeEnd + ATTRIBUTION_DELAY_FRAMES;
  const attrOpacity = interpolate(
    frame,
    [attrFadeStart, attrFadeStart + ATTRIBUTION_FADE_FRAMES, exitStart, safeDuration],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const { colors, typography } = brand;

  const textShadow = [
    '0 2px 0 rgba(0,0,0,0.85)',
    '0 6px 24px rgba(0,0,0,0.65)',
    `0 0 60px ${colors.primary}44`,
  ].join(', ');

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Full-frame scrim ─────────────────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0,0,0,1)',
          opacity: opacity * SCRIM_OPACITY,
          pointerEvents: 'none',
        }}
      />

      {/* ── Centred card ─────────────────────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            transform: `translate(-50%, -50%) translateY(${translateY}px)`,
            opacity,
            textAlign: 'center',
            maxWidth: 1100,
            padding: '0 60px',
          }}
        >
          {/* Decorative opening quotation mark */}
          <div
            style={{
              fontFamily: typography.fontFamily,
              fontSize: 160,
              fontWeight: 800,
              lineHeight: 0.8,
              marginBottom: 20,
              color: colors.primary,
              opacity: 0.75,
              textShadow: `0 0 60px ${colors.primary}88`,
              userSelect: 'none',
            }}
          >
            &ldquo;
          </div>

          {/* Quote text + inline cursor */}
          <div
            style={{
              fontFamily: typography.fontFamily,
              fontSize: 56,
              fontWeight: typography.weights.semiBold ?? 600,
              color: '#ffffff',
              lineHeight: 1.48,
              letterSpacing: '-0.01em',
              textShadow,
            }}
          >
            {quote.slice(0, visibleChars)}
            {/* Cursor — stays in DOM so the text never shifts on blink */}
            <span
              style={{
                display: 'inline-block',
                width: 6,
                height: '0.7em',
                background: colors.primary,
                marginLeft: 3,
                verticalAlign: 'text-bottom',
                borderRadius: 2,
                boxShadow: `0 0 12px ${colors.primary}`,
                visibility: cursorVisible ? 'visible' : 'hidden',
              }}
            />
          </div>

          {/* Attribution */}
          {attribution ? (
            <div
              style={{
                marginTop: 40,
                fontFamily: MONO,
                fontSize: 28,
                color: colors.primary,
                opacity: attrOpacity,
                letterSpacing: '0.02em',
                textShadow: '0 2px 12px rgba(0,0,0,0.7)',
              }}
            >
              — {attribution}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
};
