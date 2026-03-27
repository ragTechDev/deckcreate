import React, { useMemo } from 'react';
import {
  AbsoluteFill, Audio, Img, Sequence,
  staticFile, useCurrentFrame, useVideoConfig,
  spring, interpolate,
} from 'remotion';
import { whip } from '@remotion/sfx';
import type { Segment, Token } from '../types/transcript';
import type { Brand } from '../types/brand';

// ── Token helpers ──────────────────────────────────────────────────────────────

function isSpecialToken(t: Token) { return /_[A-Z]+_/.test(t.text.trim()); }

function extractCaptionWords(
  tokens: Token[],
  sourceStart: number,
  sourceEnd: number,
): { text: string; sourceTime: number }[] {
  const firstIdx = tokens.findIndex(t => !isSpecialToken(t) && t.text.trim() !== '');
  return tokens
    .filter((t, idx) => {
      if (isSpecialToken(t)) return false;
      const norm = t.text.trim().replace(/^[^\w']+|[^\w']+$/g, '');
      if (!norm) return false;
      return t.text.startsWith(' ') || idx === firstIdx;
    })
    .filter(t => t.t_dtw >= sourceStart && t.t_dtw < sourceEnd)
    .map(t => ({ text: t.text.trim().replace(/^[^\w']+|[^\w']+$/g, ''), sourceTime: t.t_dtw }))
    .filter(w => w.text.length > 0);
}

// ── Clause builder ─────────────────────────────────────────────────────────────

type Word = { text: string; sourceTime: number };
type Clause = { words: Word[]; wordStart: number; wordEnd: number };

/**
 * Groups words into clauses at natural pause points (gap > GAP_S) or when a
 * clause would exceed MAX_WORDS. Returns clauses with absolute word-index ranges.
 */
function buildClauses(words: Word[]): Clause[] {
  if (!words.length) return [];
  const GAP_S    = 0.45;
  const MAX_WORDS = 7;
  const clauses: Clause[] = [];
  let start = 0;

  for (let i = 0; i < words.length; i++) {
    const isLast     = i === words.length - 1;
    const gapToNext  = isLast ? Infinity : words[i + 1].sourceTime - words[i].sourceTime;
    const clauseLen  = i - start + 1;

    if (gapToNext > GAP_S || clauseLen >= MAX_WORDS || isLast) {
      clauses.push({ words: words.slice(start, i + 1), wordStart: start, wordEnd: i + 1 });
      start = i + 1;
    }
  }
  return clauses;
}

// ── Per-hook segment timing ────────────────────────────────────────────────────

type HookTiming = {
  seg: Segment;
  outputStartFrame: number;
  outputEndFrame: number;
  sourceStart: number;
  words: Word[];
  clauses: Clause[];
};

function buildHookTimings(segments: Segment[], fps: number): HookTiming[] {
  const timings: HookTiming[] = [];
  let cum = 0;
  for (const seg of segments) {
    if (!seg.hook || seg.cut) continue;
    const sourceStart = seg.hookFrom ?? seg.start;
    const sourceEnd   = seg.hookTo   ?? seg.end;
    const dur         = Math.round((sourceEnd - sourceStart) * fps);
    const words       = extractCaptionWords(seg.tokens, sourceStart, sourceEnd);
    timings.push({
      seg,
      outputStartFrame: cum,
      outputEndFrame:   cum + dur,
      sourceStart,
      words,
      clauses: buildClauses(words),
    });
    cum += dur;
  }
  return timings;
}

// ── Layout constants (1920 × 1080) ────────────────────────────────────────────

const GRAPHIC_HEIGHT = 30;   // reduced to 1/3 of original 90px
const GRAPHIC_TOP    = 630;  // top of floating graphic (above captions)
const CAPTION_TOP    = 720;  // top of caption text block

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  hookSegments: Segment[];
  brand: Brand;
};

export const HookOverlay: React.FC<Props> = ({ hookSegments, brand }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const timings = useMemo(() => buildHookTimings(hookSegments, fps), [hookSegments, fps]);

  // Frames at which a hook-with-graphic begins — used to fire the whip SFX
  const whipFrames = useMemo(
    () => timings.filter(t => t.seg.hookGraphic).map(t => t.outputStartFrame),
    [timings],
  );

  const active = useMemo(
    () => timings.find(t => frame >= t.outputStartFrame && frame < t.outputEndFrame) ?? null,
    [timings, frame],
  );

  // Pill: spring in once at frame 0
  const pillProgress = spring({ frame, fps, config: { damping: 14, stiffness: 180 }, durationInFrames: 20 });
  const pillScale    = interpolate(pillProgress, [0, 1], [0.4, 1]);
  const pillOpacity  = interpolate(pillProgress, [0, 1], [0, 1]);

  // Blinking recording dot — 1.4 s period
  const blinkPeriod = Math.ceil(fps * 1.4);
  const blinkPhase  = frame % blinkPeriod;
  const dotOpacity  = interpolate(
    blinkPhase,
    [0, Math.ceil(fps * 0.12), Math.ceil(fps * 0.32), blinkPeriod],
    [1, 0.15, 1, 1],
    { extrapolateRight: 'clamp' },
  );

  const { colors, typography, logo } = brand;

  // Per-frame derived values (computed outside conditional to keep hook count stable)
  const localFrame    = active ? frame - active.outputStartFrame : 0;
  const sourceTime    = active ? active.sourceStart + localFrame / fps : 0;
  const floatY        = Math.sin((frame / fps) * Math.PI * 0.72) * 10;
  // Techybara oval float — Y leads X by 90° to trace a small ellipse
  const charFloatY    = Math.sin((frame / fps) * Math.PI * 0.55) * 8;
  const charFloatX    = Math.cos((frame / fps) * Math.PI * 0.55) * 4;

  let activeWordIdx = -1;
  if (active) {
    for (let i = active.words.length - 1; i >= 0; i--) {
      if (active.words[i].sourceTime <= sourceTime) { activeWordIdx = i; break; }
    }
  }

  const currentClause = active
    ? (active.clauses.find(c => activeWordIdx >= c.wordStart && activeWordIdx < c.wordEnd)
        ?? active.clauses[0]
        ?? null)
    : null;
  const activeInClause = currentClause ? activeWordIdx - currentClause.wordStart : -1;

  const hasChar    = !!active?.seg.hookChar;
  const hasGraphic = !!active?.seg.hookGraphic;

  return (
    <>
      {/* ── Whip SFX — one per graphic-hook, fired at segment start ───────── */}
      {whipFrames.map(f => (
        <Sequence key={f} from={f} durationInFrames={Math.ceil(fps * 0.4)}>
          <Audio src={whip} volume={0.75} />
        </Sequence>
      ))}

      {/* ── Visual overlay — only rendered during active hook frames ─────── */}
      {active && (
        <AbsoluteFill style={{ pointerEvents: 'none' }}>

          {/* ── "Today's Ep" pill with blinking rec dot ─ top-left ──────── */}
          <div style={{
            position:        'absolute',
            top:             52,
            left:            60,
            transformOrigin: 'left top',
            transform:       `scale(${pillScale})`,
            opacity:         pillOpacity,
            display:         'flex',
            alignItems:      'center',
            gap:             14,
            background:      colors.primary,
            color:           colors.text.onPrimary,
            fontFamily:      typography.fontFamily,
            fontWeight:      typography.weights.extraBold,
            fontSize:        32,
            lineHeight:      1,
            padding:         '14px 32px',
            borderRadius:    999,
            letterSpacing:   '0.06em',
            textTransform:   'uppercase',
            boxShadow:       '0 4px 24px rgba(0,0,0,0.45)',
          }}>
            <span style={{
              display:      'inline-block',
              width:        14,
              height:       14,
              borderRadius: '50%',
              background:   '#FF3B30',
              opacity:      dotOpacity,
              flexShrink:   0,
            }} />
            Today&apos;s Ep
          </div>

          {/* ── Techybara ─ centered, bottom edge at caption top ────────── */}
          {hasChar && (
            <Img
              src={staticFile(`assets/techybara/${active.seg.hookChar}.png`)}
              style={{
                position:  'absolute',
                top:       CAPTION_TOP - 250,
                left:      '50%',
                transform: `translateX(calc(-50% + ${charFloatX}px)) translateY(${charFloatY}px)`,
                height:    250,
                objectFit: 'contain',
                filter:    'drop-shadow(0 8px 14px rgba(0,0,0,0.7)) drop-shadow(0 3px 5px rgba(0,0,0,0.5))',
              }}
            />
          )}

          {/* ── Hook graphic — centered above captions, floating ─────────── */}
          {hasGraphic && (
            <Img
              src={staticFile(active.seg.hookGraphic!.replace(/^\/+/, ''))}
              style={{
                position:  'absolute',
                top:       GRAPHIC_TOP,
                left:      '50%',
                transform: `translateX(-50%) translateY(${floatY}px)`,
                height:    GRAPHIC_HEIGHT,
                width:     'auto',
                objectFit: 'contain',
                filter:    'drop-shadow(0 8px 14px rgba(0,0,0,0.7)) drop-shadow(0 3px 5px rgba(0,0,0,0.5))',
              }}
            />
          )}

          {/* ── Clause-by-clause captions — centered, lower third ────────── */}
          {currentClause && (
            <div style={{
              position:       'absolute',
              top:            CAPTION_TOP,
              left:           0,
              width:          '100%',
              display:        'flex',
              flexWrap:       'wrap',
              justifyContent: 'center',
              alignItems:     'baseline',
              gap:            '4px 16px',
              padding:        '0 120px',
              boxSizing:      'border-box',
            }}>
              {currentClause.words.map((word, i) => {
                const isCurrent = i === activeInClause;
                const isPast    = i <  activeInClause;
                return (
                  <span
                    key={currentClause.wordStart + i}
                    style={{
                      display:    'inline-block',
                      fontFamily: typography.fontFamily,
                      fontWeight: isCurrent ? typography.weights.black : typography.weights.bold,
                      fontSize:   isCurrent ? 108 : 96,
                      lineHeight: 1.2,
                      color: isCurrent
                        ? colors.secondary
                        : isPast
                        ? colors.text.primary
                        : `${colors.text.primary}50`,
                      textShadow: '0 3px 20px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.8)',
                    }}
                  >
                    {word.text}
                  </span>
                );
              })}
            </div>
          )}

          {/* ── Logo ─ bottom-right ─────────────────────────────────────── */}
          <Img
            src={staticFile(logo.replace(/^\/+/, ''))}
            style={{
              position:  'absolute',
              bottom:    48,
              right:     60,
              height:    110,
              objectFit: 'contain',
              opacity:   0.95,
            }}
          />

        </AbsoluteFill>
      )}
    </>
  );
};
