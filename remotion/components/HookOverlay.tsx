import React, { useMemo } from 'react';
import {
  AbsoluteFill, Audio, Img, Sequence,
  staticFile, useCurrentFrame, useVideoConfig,
  spring, interpolate,
} from 'remotion';
import { createTikTokStyleCaptions } from '@remotion/captions';
import type { Caption } from '@remotion/captions';
import { whip } from '@remotion/sfx';
import type { Segment, Token } from '../types/transcript';
import type { Brand } from '../types/brand';

// ── Token helpers ──────────────────────────────────────────────────────────────

function isSpecialToken(t: Token) { return /_[A-Z]+_/.test(t.text.trim()); }

/**
 * Converts segment tokens to Caption objects for createTikTokStyleCaptions.
 *
 * Groups BPE sub-tokens (continuation pieces with no leading space, e.g. "'t"
 * after " wouldn") into whole words before building captions. Without grouping,
 * contractions like "wouldn't" appear as only the stem " wouldn" because the
 * suffix "'t" has no leading space and was previously discarded.
 */
function buildCaptions(
  tokens: Token[],
  sourceStart: number,
  sourceEnd: number,
): Caption[] {
  // Group BPE sub-tokens into word-level groups
  const wordGroups: { text: string; t_dtw: number }[] = [];
  for (const t of tokens) {
    if (isSpecialToken(t) || t.text.trim() === '') continue;
    if (t.text.startsWith(' ') || wordGroups.length === 0) {
      wordGroups.push({ text: t.text, t_dtw: t.t_dtw });
    } else {
      // Continuation sub-token: append to previous group
      wordGroups[wordGroups.length - 1].text += t.text;
    }
  }

  // Filter to the hook window. Use a 0.5 s buffer past sourceEnd so words
  // whose t_dtw lands exactly at the boundary (or slightly past due to Whisper
  // timestamp drift) are not silently dropped from captions.
  const inRange = wordGroups.filter(w => w.t_dtw >= sourceStart && w.t_dtw < sourceEnd + 0.5);
  return inRange.map((w, i) => ({
    text: w.text,
    startMs: Math.round(w.t_dtw * 1000),
    endMs: Math.round((i + 1 < inRange.length ? inRange[i + 1].t_dtw : sourceEnd) * 1000),
    timestampMs: Math.round(w.t_dtw * 1000),
    confidence: null,
  }));
}

// ── Per-hook segment timing ────────────────────────────────────────────────────

type Page = ReturnType<typeof createTikTokStyleCaptions>['pages'][number];

type HookTiming = {
  seg: Segment;
  outputStartFrame: number;
  outputEndFrame: number;
  sourceStart: number;
  pages: Page[];
};

function buildHookTimings(segments: Segment[], fps: number): HookTiming[] {
  const timings: HookTiming[] = [];
  let cum = 0;
  for (const seg of segments) {
    if (!seg.hook || seg.cut) continue;
    const sourceStart = seg.hookFrom ?? seg.start;
    const sourceEnd   = seg.hookTo   ?? seg.end;
    const dur         = Math.round((sourceEnd - sourceStart) * fps);
    const captions    = buildCaptions(seg.tokens, sourceStart, sourceEnd);
    const { pages }   = createTikTokStyleCaptions({
      captions,
      combineTokensWithinMilliseconds: 1200,
    });
    timings.push({ seg, outputStartFrame: cum, outputEndFrame: cum + dur, sourceStart, pages });
    cum += dur;
  }
  return timings;
}

// ── Layout constants (1920 × 1080) ────────────────────────────────────────────

const GRAPHIC_HEIGHT = 30;
const GRAPHIC_TOP    = 630;
const CAPTION_TOP    = 720;

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  hookSegments: Segment[];
  brand: Brand;
};

export const HookOverlay: React.FC<Props> = ({ hookSegments, brand }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const timings = useMemo(() => buildHookTimings(hookSegments, fps), [hookSegments, fps]);

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

  // Per-frame derived values (computed unconditionally to keep hook count stable)
  const localFrame = active ? frame - active.outputStartFrame : 0;
  const sourceTime = active ? active.sourceStart + localFrame / fps : 0;
  const currentMs  = sourceTime * 1000;

  const floatY     = Math.sin((frame / fps) * Math.PI * 0.72) * 10;
  const charFloatY = Math.sin((frame / fps) * Math.PI * 0.55) * 8;
  const charFloatX = Math.cos((frame / fps) * Math.PI * 0.55) * 4;

  // Find active page: the last page whose startMs has passed
  const activePage = active
    ? (active.pages.findLast(p => currentMs >= p.startMs) ?? null)
    : null;

  // Fade in each new page over 6 frames to soften page switches
  const pageStartMs     = activePage?.startMs ?? 0;
  const pageStartFrame  = active
    ? active.outputStartFrame + Math.round((pageStartMs / 1000 - active.sourceStart) * fps)
    : 0;
  const framesIntoPage  = frame - pageStartFrame;
  const pageOpacity     = interpolate(framesIntoPage, [0, 6], [0, 1], { extrapolateRight: 'clamp' });

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

          {/* ── Page-at-a-time captions — centered, lower third ──────────── */}
          {activePage && (
            <div style={{
              position:   'absolute',
              top:        CAPTION_TOP,
              left:       0,
              width:      '100%',
              textAlign:  'center',
              padding:    '0 120px',
              boxSizing:  'border-box',
              fontFamily: typography.fontFamily,
              fontWeight: typography.weights.black,
              fontSize:   96,
              lineHeight: 1.25,
              color:      colors.text.primary,
              textShadow: '0 3px 20px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.8)',
              opacity:    pageOpacity,
              whiteSpace: 'pre-wrap',
            }}>
              {activePage.text.trim()}
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
