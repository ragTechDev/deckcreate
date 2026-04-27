import React, { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { createTikTokStyleCaptions } from '@remotion/captions';
import type { Caption } from '@remotion/captions';
import type { Segment, Token } from '../types/transcript';
import { isSpokenToken } from '../lib/tokens';
import type { Brand } from '../types/brand';
import { getEffectiveDuration } from './SegmentPlayer';

// ── Layout constants for 1080 × 1920 ──────────────────────────────────────────

const CAPTION_TOP       = 1300;
const CAPTION_FONT_SIZE = 120;

// ── Timing constants (must match HookOverlay / SegmentPlayer) ──────────────────

const HOOK_TAIL_PAD_UNBOUNDED = 0.16;
const HOOK_TAIL_PAD_BOUNDED   = 0.02;
const HOOK_BRIDGE_MAX_GAP     = 1.0;

// ── Caption building (shared logic with HookOverlay) ──────────────────────────

function isContractionSuffix(text: string) {
  return /^'(m|s|t|re|ve|ll|d)$/i.test(text.trim());
}

function isNumericText(text: string) {
  return /^\d+$/.test(text.trim());
}

function isPunctuationOnly(text: string) {
  return /^[^\w\s']+$/.test(text.trim());
}

function appendPunctuationDedup(prev: string, punct: string) {
  let next = prev;
  for (const ch of punct) {
    if (!next.trim().endsWith(ch)) next += ch;
  }
  return next;
}

function buildCaptions(
  tokens: Token[],
  sourceStart: number,
  sourceEnd: number,
  isBoundedHook: boolean,
): Caption[] {
  const dedupedTokens: Token[] = [];
  const seen = new Set<string>();
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (!isSpokenToken(t)) continue;
    const key = `${t.t_dtw}|${t.text.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedTokens.push(t);
  }
  dedupedTokens.reverse();

  const wordGroups: { text: string; t_dtw: number }[] = [];
  for (const t of dedupedTokens) {
    const trimmed = t.text.trim();
    const punctOnly = isPunctuationOnly(trimmed);
    if (wordGroups.length === 0) {
      if (punctOnly) continue;
      wordGroups.push({ text: t.text, t_dtw: t.t_dtw });
    } else {
      const prev = wordGroups[wordGroups.length - 1];
      const prevTrimmed = prev.text.trim();
      if (punctOnly) {
        prev.text = appendPunctuationDedup(prev.text, trimmed);
        continue;
      }
      const bothNumeric = isNumericText(prevTrimmed) && isNumericText(trimmed);
      const numericDup  = bothNumeric && (prevTrimmed.endsWith(trimmed) || trimmed.endsWith(prevTrimmed));
      const mergeShort  = bothNumeric && prevTrimmed.length <= 2 && trimmed.length <= 2;
      const sameMoment  = !t.text.startsWith(' ') && Math.abs(t.t_dtw - prev.t_dtw) <= 0.01;
      const shouldAttach = sameMoment || isContractionSuffix(trimmed) || mergeShort;
      if (numericDup) continue;
      if (shouldAttach && prevTrimmed.endsWith(trimmed)) continue;
      if (shouldAttach) { prev.text += t.text; } else { wordGroups.push({ text: t.text, t_dtw: t.t_dtw }); }
    }
  }

  const deduped = wordGroups.filter((w, i) => {
    if (i === 0) return true;
    const p = wordGroups[i - 1];
    return !(w.t_dtw === p.t_dtw && w.text.trim() === p.text.trim());
  });

  const inRange = deduped.filter(w => w.t_dtw >= sourceStart && w.t_dtw < sourceEnd);
  return inRange.map((w, i) => {
    const startMs = (i === 0 && isBoundedHook && w.t_dtw > sourceStart)
      ? Math.round(sourceStart * 1000)
      : Math.round(w.t_dtw * 1000);
    const rawEndMs = Math.round(
      (i + 1 < inRange.length ? inRange[i + 1].t_dtw : sourceEnd) * 1000,
    );
    return { text: w.text, startMs, endMs: Math.max(rawEndMs, startMs + 50), timestampMs: startMs, confidence: null };
  });
}

// ── Segment timing builder ──────────────────────────────────────────────────────

type Page = ReturnType<typeof createTikTokStyleCaptions>['pages'][number];

type SegmentTiming = {
  outputStartFrame: number;
  outputEndFrame: number;
  sourceStart: number;
  sourceEnd: number;
  pages: Page[];
};

function buildAllTimings(
  hookSegments: Segment[],
  mainSegments: Segment[],
  fps: number,
  videoStart?: number,
  videoEnd?: number,
): SegmentTiming[] {
  const timings: SegmentTiming[] = [];
  let cum = 0;

  // ── Hooks ────────────────────────────────────────────────────────────────────
  for (let i = 0; i < hookSegments.length; i++) {
    const seg = hookSegments[i];
    if (seg.cut) continue;

    const sourceStart    = seg.hookFrom ?? seg.start;
    const baseEnd        = seg.hookTo ?? seg.end;
    const isBoundedHook  = seg.hookTo !== undefined && seg.hookTo !== null;
    let   sourceEnd      = baseEnd;

    const lastSpoken = seg.tokens
      .filter(t => isSpokenToken(t) && t.t_dtw >= sourceStart && t.t_dtw <= baseEnd)
      .sort((a, b) => (b.t_end ?? 0) - (a.t_end ?? 0))[0];

    const nextHook = hookSegments.slice(i + 1).find(s => !s.cut);
    const nextHookStart = nextHook ? (nextHook.hookFrom ?? nextHook.start) : undefined;

    if (lastSpoken?.t_end) {
      const tEnd = nextHookStart !== undefined ? Math.min(lastSpoken.t_end, nextHookStart) : lastSpoken.t_end;
      sourceEnd = Math.max(sourceEnd, tEnd);
    }

    const hasSpokenAfter = seg.tokens.some(t => isSpokenToken(t) && t.t_dtw > sourceEnd + 0.02);
    const canBridge = nextHookStart !== undefined
      && nextHookStart > sourceEnd
      && nextHookStart - sourceEnd <= HOOK_BRIDGE_MAX_GAP;
    if (!hasSpokenAfter && canBridge) sourceEnd = nextHookStart;

    sourceEnd += isBoundedHook ? HOOK_TAIL_PAD_BOUNDED : HOOK_TAIL_PAD_UNBOUNDED;
    if (nextHookStart !== undefined) sourceEnd = Math.min(sourceEnd, nextHookStart);

    const captions = buildCaptions(seg.tokens, sourceStart, sourceEnd, isBoundedHook);
    const dur = Math.max(1, Math.ceil(sourceEnd * fps) - Math.floor(sourceStart * fps));
    const { pages } = createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds: 1200 });
    timings.push({ outputStartFrame: cum, outputEndFrame: cum + dur, sourceStart, sourceEnd, pages });
    cum += dur;
  }

  // ── Main segments ─────────────────────────────────────────────────────────────
  for (const seg of mainSegments) {
    if (seg.cut || seg.hook) continue;
    if (videoStart !== undefined && seg.end <= videoStart) continue;
    if (videoEnd   !== undefined && seg.start >= videoEnd) continue;

    const sourceStart = videoStart !== undefined ? Math.max(seg.start, videoStart) : seg.start;
    const sourceEnd   = videoEnd   !== undefined ? Math.min(seg.end,   videoEnd)   : seg.end;

    const durationFrames = Math.ceil(getEffectiveDuration(seg) * fps);
    if (durationFrames <= 0) continue;

    const captions = buildCaptions(seg.tokens, sourceStart, sourceEnd, false);
    const { pages } = createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds: 1200 });
    timings.push({ outputStartFrame: cum, outputEndFrame: cum + durationFrames, sourceStart, sourceEnd, pages });
    cum += durationFrames;
  }

  return timings;
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  hookSegments?: Segment[];
  mainSegments?: Segment[];
  segments?: Segment[];
  videoStart?: number;
  videoEnd?: number;
  totalHookFrames?: number;
  brand: Brand;
};

export const CaptionOverlay: React.FC<Props> = ({
  hookSegments: hookSegmentsProp,
  mainSegments: mainSegmentsProp,
  segments,
  videoStart: videoStartProp,
  videoEnd: videoEndProp,
  totalHookFrames: totalHookFramesProp,
  brand,
}) => {
  // Support both old interface (hookSegments/mainSegments) and new interface (segments + totalHookFrames)
  const hookSegments = hookSegmentsProp ?? segments?.filter(s => s.hook && !s.cut) ?? [];
  const mainSegments = mainSegmentsProp ?? segments?.filter(s => !s.hook) ?? [];
  const videoStart = videoStartProp;
  const videoEnd = videoEndProp;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const timings = useMemo(
    () => buildAllTimings(hookSegments, mainSegments, fps, videoStart, videoEnd),
    [hookSegments, mainSegments, fps, videoStart, videoEnd],
  );

  const active = useMemo(
    () => timings.find(t => frame >= t.outputStartFrame && frame < t.outputEndFrame) ?? null,
    [timings, frame],
  );

  if (!active) return null;

  const localFrame  = frame - active.outputStartFrame;
  const sourceTime  = active.sourceStart + localFrame / fps;
  const currentMs   = sourceTime * 1000;

  const activePage = active.pages.findLast(p => currentMs >= p.startMs) ?? null;
  if (!activePage) return null;

  const pageStartMs    = activePage.startMs;
  const pageStartFrame = active.outputStartFrame + Math.round((pageStartMs / 1000 - active.sourceStart) * fps);
  const framesIntoPage = frame - pageStartFrame;
  const pageOpacity    = interpolate(framesIntoPage, [0, 6], [0, 1], { extrapolateRight: 'clamp' });

  const { typography, colors } = brand;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 101 }}>
      <div style={{
        position:   'absolute',
        top:        CAPTION_TOP,
        left:       0,
        width:      '100%',
        textAlign:  'center',
        padding:    '0 60px',
        boxSizing:  'border-box',
        fontFamily: typography.fontFamily,
        fontWeight: typography.weights.black,
        fontSize:   CAPTION_FONT_SIZE,
        lineHeight: 1.25,
        color:      colors.text.primary,
        textShadow: '0 3px 20px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.8)',
        opacity:    pageOpacity,
        whiteSpace: 'pre-wrap',
      }}>
        {activePage.text.trim()}
      </div>
    </AbsoluteFill>
  );
};
