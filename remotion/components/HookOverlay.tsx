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
import { isSpokenToken } from '../lib/tokens';
import type { Brand } from '../types/brand';

// ── Token helpers ──────────────────────────────────────────────────────────────


function isContractionSuffixTokenText(text: string) {
  return /^'(m|s|t|re|ve|ll|d)$/i.test(text.trim());
}

function isNumericTokenText(text: string) {
  return /^\d+$/.test(text.trim());
}

function isPunctuationOnlyTokenText(text: string) {
  return /^[^\w\s']+$/.test(text.trim());
}

function appendPunctuationDedup(prevText: string, punctuationToken: string) {
  let next = prevText;
  for (const ch of punctuationToken) {
    if (!next.trim().endsWith(ch)) {
      next += ch;
    }
  }
  return next;
}

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
  isBoundedHook: boolean,
): Caption[] {
  const dedupedTokens: Token[] = [];
  const seenTokenAtMoment = new Set<string>();
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (!isSpokenToken(t)) continue;
    const key = `${t.t_dtw}|${t.text.trim().toLowerCase()}`;
    if (seenTokenAtMoment.has(key)) continue;
    seenTokenAtMoment.add(key);
    dedupedTokens.push(t);
  }
  dedupedTokens.reverse();

  // Group BPE sub-tokens into word-level groups
  const wordGroups: { text: string; t_dtw: number }[] = [];
  for (const t of dedupedTokens) {
    const trimmed = t.text.trim();
    const punctuationOnly = isPunctuationOnlyTokenText(trimmed);
    if (wordGroups.length === 0) {
      if (punctuationOnly) continue;
      wordGroups.push({ text: t.text, t_dtw: t.t_dtw });
    } else {
      const prev = wordGroups[wordGroups.length - 1];
      const prevTrimmed = prev.text.trim();

      if (punctuationOnly) {
        prev.text = appendPunctuationDedup(prev.text, trimmed);
        continue;
      }

      const bothNumeric = isNumericTokenText(prevTrimmed) && isNumericTokenText(trimmed);
      const isNumericDuplicate = bothNumeric
        && (prevTrimmed.endsWith(trimmed) || trimmed.endsWith(prevTrimmed));
      const shouldMergeShortNumericParts = bothNumeric
        && prevTrimmed.length <= 2
        && trimmed.length <= 2;
      const sameMomentContinuation = !t.text.startsWith(' ')
        && Math.abs(t.t_dtw - prev.t_dtw) <= 0.01;
      const shouldAttach = sameMomentContinuation
        || isContractionSuffixTokenText(trimmed)
        || shouldMergeShortNumericParts;

      if (isNumericDuplicate) {
        continue;
      }

      if (shouldAttach && prevTrimmed.endsWith(trimmed)) {
        continue;
      }

      if (shouldAttach) {
        // Continuation sub-token: append to previous group
        prev.text += t.text;
      } else {
        wordGroups.push({ text: t.text, t_dtw: t.t_dtw });
      }
    }
  }

  // Remove consecutive duplicate word groups (same text AND same timestamp).
  // These are boundary artefacts produced when mergeIntoSentences carries the
  // last token of a Whisper raw segment into the next merged sentence.
  const deduped = wordGroups.filter((w, i) => {
    if (i === 0) return true;
    const prev = wordGroups[i - 1];
    const sameTime = w.t_dtw === prev.t_dtw;
    const sameToken = w.text.trim() === prev.text.trim();
    return !(sameTime && sameToken);
  });

  // Filter to the hook window
  const inRange = deduped.filter(w => w.t_dtw >= sourceStart && w.t_dtw < sourceEnd);
  return inRange.map((w, i) => {
    const startMs = (i === 0 && isBoundedHook && w.t_dtw > sourceStart)
      ? Math.round(sourceStart * 1000)
      : Math.round(w.t_dtw * 1000);
    const rawEndMs = Math.round(
      (i + 1 < inRange.length ? inRange[i + 1].t_dtw : sourceEnd) * 1000,
    );
    // Guard: endMs must be at least 50 ms past startMs. When a token's t_dtw
    // drifts past sourceEnd (common for the last word in a Whisper segment),
    // rawEndMs = round(sourceEnd * 1000) can be less than startMs, producing a
    // zero- or negative-duration caption that createTikTokStyleCaptions drops.
    return {
      text: w.text,
      startMs,
      endMs: Math.max(rawEndMs, startMs + 50),
      timestampMs: startMs,
      confidence: null,
    };
  });
}

// ── Per-hook segment timing ────────────────────────────────────────────────────

type Page = ReturnType<typeof createTikTokStyleCaptions>['pages'][number];
const HOOK_TAIL_PAD_UNBOUNDED_SECONDS = 0.16;
const HOOK_TAIL_PAD_BOUNDED_SECONDS = 0.02;
const HOOK_BRIDGE_MAX_GAP_SECONDS = 1.0;

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
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg.hook || seg.cut) continue;

    const sourceStart = seg.hookFrom ?? seg.start;
    const baseEnd = seg.hookTo ?? seg.end;
    const isBoundedHook = seg.hookTo !== undefined && seg.hookTo !== null;

    let sourceEnd = baseEnd;
    // Extend to cover the last spoken token's audio tail (both bounded and unbounded hooks)
    const lastSpokenToken = seg.tokens
      .filter(t => isSpokenToken(t) && t.t_dtw >= sourceStart && t.t_dtw <= baseEnd)
      .sort((a, b) => (b.t_end ?? 0) - (a.t_end ?? 0))[0];

    if (lastSpokenToken?.t_end) {
      sourceEnd = Math.max(sourceEnd, lastSpokenToken.t_end);
    }

    // Bridge to the next hook when the gap is small and this hook ends at the
    // segment tail — must match SegmentPlayer.getHookSubClips / CameraPlayer.
    const nextHookSeg = segments.slice(i + 1).find(s => s.hook && !s.cut);
    const nextHookStart = nextHookSeg ? (nextHookSeg.hookFrom ?? nextHookSeg.start) : undefined;
    const hasSpokenTokenAfterEnd = seg.tokens.some(
      t => isSpokenToken(t) && t.t_dtw > sourceEnd + 0.02,
    );
    const endsAtSegmentTail = !hasSpokenTokenAfterEnd;
    const canBridge = nextHookStart !== undefined
      && nextHookStart > sourceEnd
      && nextHookStart - sourceEnd <= HOOK_BRIDGE_MAX_GAP_SECONDS;
    if (endsAtSegmentTail && canBridge) {
      sourceEnd = nextHookStart;
    }

    // Add a small tail pad to avoid cutting off the audio abruptly
    sourceEnd += isBoundedHook
      ? HOOK_TAIL_PAD_BOUNDED_SECONDS
      : HOOK_TAIL_PAD_UNBOUNDED_SECONDS;

    const captions = buildCaptions(seg.tokens, sourceStart, sourceEnd, isBoundedHook);

    const startFrame = Math.floor(sourceStart * fps);
    const endFrame = Math.ceil(sourceEnd * fps);
    const dur = Math.max(1, endFrame - startFrame);

    const { pages } = createTikTokStyleCaptions({
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
