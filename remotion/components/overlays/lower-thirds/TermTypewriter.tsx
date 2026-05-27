import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import type { Brand } from '../../../types/brand';

const MONO = "'SF Mono', 'Monaco', 'Cascadia Code', 'Consolas', monospace";

/** Frames for the fade-out tail */
const EXIT_FRAMES = 15;
/** Frames per character while typing */
const TERM_FRAMES_PER_CHAR = 2.5;
/** Blink interval in frames */
const BLINK_INTERVAL = 18;
/** Max opacity for the background scrim */
const SCRIM_OPACITY = 0.45;

// Floating emoji timing constants
/** Vertical bob amplitude in px */
const FLOAT_AMP_Y = 10;
/** Horizontal drift amplitude in px */
const FLOAT_AMP_X = 5;
/** Vertical bob angular speed (radians per frame) — full cycle ≈ 2 s @ 60 fps */
const FLOAT_SPEED_Y = 0.055;
/** Horizontal drift angular speed — slightly different phase for organic feel */
const FLOAT_SPEED_X = 0.032;

export interface TermTypewriterProps {
  brand: Brand;
  /** The term to display, e.g. "frugal innovation" */
  term: string;
  /**
   * Small dim label shown above the term.
   * Pass an empty string to hide it. Defaults to "concept".
   */
  label?: string;
  /**
   * Optional emoji shown to the left of the term, floating around its anchor.
   * e.g. "🌍"  "🚀"  "💡"
   */
  emoji?: string;
  durationInFrames: number;
}

export const TermTypewriter: React.FC<TermTypewriterProps> = ({
  brand,
  term,
  label = 'concept',
  emoji,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // ── Timing ────────────────────────────────────────────────────────────────

  const safeDuration = Math.max(60, durationInFrames);
  const exitStart = safeDuration - EXIT_FRAMES;

  // ── Entrance: fade + very subtle scale ────────────────────────────────────

  const enterSpring = spring({ frame, fps, config: { damping: 28, stiffness: 120, mass: 0.8 } });
  const scale = interpolate(enterSpring, [0, 1], [0.94, 1]);

  // Shared opacity envelope — drives text, cursor, and scrim
  const opacity = interpolate(
    frame,
    [0, 6, exitStart, safeDuration],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  // ── Typewriter ────────────────────────────────────────────────────────────

  const typeStart = 4;
  const typeEnd = typeStart + term.length * TERM_FRAMES_PER_CHAR;

  const visibleChars = Math.floor(
    interpolate(frame, [typeStart, typeEnd], [0, term.length], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  const typingDone = visibleChars >= term.length;

  // Cursor rendered via visibility (not conditional) so text never shifts on blink
  const blinkOn = Math.floor(frame / BLINK_INTERVAL) % 2 === 0;
  const cursorVisible = frame >= typeStart && (!typingDone || (frame < exitStart && blinkOn));

  // ── Floating emoji ────────────────────────────────────────────────────────

  // Independent sin/cos offsets — no layout impact (transform only)
  const floatY = Math.sin(frame * FLOAT_SPEED_Y) * FLOAT_AMP_Y;
  const floatX = Math.cos(frame * FLOAT_SPEED_X) * FLOAT_AMP_X;

  const { colors, typography } = brand;

  // Build a rich text-shadow: hard edge for legibility + soft glow + colour halo
  const textShadow = [
    '0 2px 0 rgba(0,0,0,0.85)',           // crisp dark edge
    '0 6px 24px rgba(0,0,0,0.65)',         // soft drop shadow
    `0 0 80px ${colors.primary}55`,        // colour halo
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

      {/* ── Centred text ─────────────────────────────────────────────────── */}
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
            transform: `translate(-50%, -50%) scale(${scale})`,
            opacity,
            textAlign: 'center',
          }}
        >
          {/* Label */}
          {label ? (
            <div
              style={{
                fontFamily: MONO,
                fontSize: 22,
                color: 'rgba(255,255,255,0.4)',
                letterSpacing: '0.08em',
                marginBottom: 18,
                textShadow: '0 2px 8px rgba(0,0,0,0.5)',
              }}
            >
              {`// ${label}`}
            </div>
          ) : null}

          {/* Row: floating emoji (if provided) + term + cursor */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: emoji ? 28 : 0,
              whiteSpace: 'nowrap',
            }}
          >
            {/* Floating emoji — transform offset keeps layout stable */}
            {emoji && (
              <span
                style={{
                  fontSize: 110,
                  lineHeight: 1,
                  display: 'inline-block',
                  // Float around anchor using transform (no layout shift)
                  transform: `translateX(${floatX}px) translateY(${floatY}px)`,
                  // Emoji drop-shadow for depth on video
                  filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.55))',
                  userSelect: 'none',
                }}
              >
                {emoji}
              </span>
            )}

            {/* Term text */}
            <span
              style={{
                fontFamily: typography.fontFamily,
                fontSize: 130,
                fontWeight: typography.weights.extraBold ?? 800,
                color: colors.primary,
                letterSpacing: '-0.02em',
                lineHeight: 1,
                textShadow,
              }}
            >
              {term.slice(0, visibleChars)}
            </span>

            {/* Cursor — always in DOM so blink never shifts the text */}
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: '0.75em',
                background: colors.primary,
                marginLeft: 4,
                verticalAlign: 'text-bottom',
                borderRadius: 2,
                flexShrink: 0,
                boxShadow: `0 0 16px ${colors.primary}`,
                visibility: cursorVisible ? 'visible' : 'hidden',
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
};
