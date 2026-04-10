import React, { useEffect, useRef } from 'react';
import { OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig, getRemotionEnvironment } from 'remotion';
import type { Segment, TimeCut } from '../types/transcript';
import { isSpokenToken } from '../lib/tokens';

export type SubClip = { sourceStart: number; sourceEnd: number };

export type Section = { trimBefore: number; trimAfter: number };

export type SplitSections = { hookSections: Section[]; mainSections: Section[] };

/** Splits a segment's time range into playable sub-clips, skipping cuts[] ranges. */
export function getSubClips(segment: Segment): SubClip[] {
  if (!segment.cuts || segment.cuts.length === 0) {
    return [{ sourceStart: segment.start, sourceEnd: segment.end }];
  }

  const clips: SubClip[] = [];
  let cursor = segment.start;

  // Clamp cuts to [segment.start, segment.end] and discard invalid ones.
  // Whisper t_dtw values can drift outside the segment window, producing
  // inverted (from > to) or zero-duration cuts that would corrupt playback.
  const sorted = [...segment.cuts]
    .map(c => ({ from: Math.max(c.from, segment.start), to: Math.min(c.to, segment.end) }))
    .filter(c => c.to > c.from)
    .sort((a: TimeCut, b: TimeCut) => a.from - b.from);

  for (const cut of sorted) {
    if (cut.from > cursor) clips.push({ sourceStart: cursor, sourceEnd: cut.from });
    cursor = Math.max(cursor, cut.to); // prevent cursor going backwards on overlapping cuts
  }
  if (cursor < segment.end) clips.push({ sourceStart: cursor, sourceEnd: segment.end });

  return clips;
}

/** Playable duration of a segment after all cuts are removed. */
export function getEffectiveDuration(segment: Segment): number {
  return getSubClips(segment).reduce((sum, c) => sum + (c.sourceEnd - c.sourceStart), 0);
}

/**
 * Builds the playable sub-clips for main content using "full range minus explicit cuts".
 *
 * Starts from [videoStart, rangeEnd] and subtracts:
 *   - cut=true segment spans (whole segments removed)
 *   - segment.cuts[] entries (intra-segment time ranges removed)
 *
 * Inter-segment silence/gaps are included by default. To opt-in to silence removal,
 * run --auto-cut-pauses which writes explicit cuts[] entries into the transcript.
 */
export function buildMainSubClips(
  allMainSegments: Segment[],
  videoStart: number | undefined,
  videoEnd: number | undefined,
): SubClip[] {
  const activeMain = allMainSegments.filter(s => !s.cut);
  if (activeMain.length === 0) return [];

  const rangeStart = videoStart ?? activeMain[0].start;
  const rangeEnd   = videoEnd   ?? activeMain[activeMain.length - 1].end;

  // Collect all exclusion ranges
  const cutRanges: { from: number; to: number }[] = [];

  for (const seg of allMainSegments) {
    if (seg.cut) cutRanges.push({ from: seg.start, to: seg.end });
  }
  for (const seg of activeMain) {
    for (const c of seg.cuts ?? []) {
      const from = Math.max(c.from, seg.start);
      const to   = Math.min(c.to,   seg.end);
      if (to > from) cutRanges.push({ from, to });
    }
  }

  // Sort and merge overlapping/adjacent exclusion ranges
  cutRanges.sort((a, b) => a.from - b.from);
  const merged: { from: number; to: number }[] = [];
  for (const c of cutRanges) {
    if (merged.length > 0 && c.from <= merged[merged.length - 1].to) {
      merged[merged.length - 1].to = Math.max(merged[merged.length - 1].to, c.to);
    } else {
      merged.push({ ...c });
    }
  }

  // Invert: the gaps between exclusions are the playable clips
  const clips: SubClip[] = [];
  let cursor = rangeStart;
  for (const cut of merged) {
    if (cut.from > cursor) clips.push({ sourceStart: cursor, sourceEnd: cut.from });
    cursor = Math.max(cursor, cut.to);
  }
  if (cursor < rangeEnd) clips.push({ sourceStart: cursor, sourceEnd: rangeEnd });

  // Drop clips shorter than 2 frames at 60fps (Whisper segmentation artifacts
  // between adjacent cut=true segments).
  return clips.filter(c => (c.sourceEnd - c.sourceStart) >= 0.034);
}

/**
 * Returns the clip range for a hook segment: phrase window if set, else the raw segment
 *  (no cuts applied — hook clips play uninterrupted so the music stays in sync).
 *
 *  The clip end is extended when spoken tokens drift past the segment boundary,
 *  matching HookOverlay/Composition/CameraPlayer so hook audio does not clip the
 *  trailing word of a phrase. */
function getHookSubClips(segment: Segment, nextHookStart?: number): SubClip[] {
  const sourceStart = segment.hookFrom ?? segment.start;
  const baseEnd = segment.hookTo ?? segment.end;
  const isBoundedHook = segment.hookTo !== undefined && segment.hookTo !== null;

  let sourceEnd = baseEnd;
  // Extend to cover the last spoken token's audio tail (both bounded and unbounded hooks)
  const lastSpokenToken = segment.tokens
    .filter(t => isSpokenToken(t) && t.t_dtw >= sourceStart && t.t_dtw <= baseEnd)
    .sort((a, b) => (b.t_end ?? 0) - (a.t_end ?? 0))[0];

  if (lastSpokenToken?.t_end) {
    sourceEnd = Math.max(sourceEnd, lastSpokenToken.t_end);
  }

  // Bridge to the next hook when the gap is small and this hook ends at the
  // segment tail — must match CameraPlayer.getOutputDuration / Composition.hookClipEnd.
  const hasSpokenTokenAfterEnd = segment.tokens.some(
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

  return [{ sourceStart, sourceEnd }];
}

function toSections(clips: SubClip[], fps: number): Section[] {
  return clips.map(c => {
    const trimBefore = Math.floor(c.sourceStart * fps);
    const trimAfter = Math.ceil(c.sourceEnd * fps);
    return {
      trimBefore,
      trimAfter: Math.max(trimAfter, trimBefore + 1),
    };
  });
}

/**
 * Convert segments to hook and main section arrays, kept SEPARATE.
 *
 * They must not be merged into a single flat array because SegmentPlayer renders
 * each group in its own <Sequence>, giving each an independent local frame counter.
 * This prevents negative trimBefore values: hooks (from deep in the source) play
 * at composition frames 0…hookDuration while main (from the start of the source)
 * plays at hookDuration…end. Without the split, after hookDuration frames of hooks
 * the accumulated prevSum would exceed mainSection.trimBefore, making the shift
 * trimBefore = mainSection.trimBefore - prevSum go negative.
 *
 * Main content uses "full range minus explicit cuts": the active range
 * [videoStart, lastSegment.end] plays continuously, with only cut=true segments
 * and cuts[] time ranges removed. Inter-segment silence is included by default.
 */
export function buildSections(
  segments: Segment[],
  fps: number,
  videoStart?: number,
  videoEnd?: number,
): SplitSections {
  const hookSegments = segments.filter(s => s.hook && !s.cut);
  const hookSections = hookSegments
    .flatMap((seg, idx) => {
      const next = hookSegments[idx + 1];
      const nextHookStart = next ? (next.hookFrom ?? next.start) : undefined;
      return toSections(getHookSubClips(seg, nextHookStart), fps);
    });
  const allMainSegments = segments.filter(s => !s.hook);
  const mainSubClips = buildMainSubClips(allMainSegments, videoStart, videoEnd);
  const mainSections = toSections(mainSubClips, fps);
  return { hookSections, mainSections };
}

// ── Jump-cuts player for one group ───────────────────────────────────────────

// Frames to fade in/out at each cut boundary (~50ms at 60fps)
const DECLICK_FRAMES = 3;
const HOOK_TAIL_PAD_UNBOUNDED_SECONDS = 0.16;
const HOOK_TAIL_PAD_BOUNDED_SECONDS = 0.02;
const HOOK_BRIDGE_MAX_GAP_SECONDS = 1.0;
const HOOK_END_FADE_FRAMES = 12;

/**
 * Renders one group of sections (hooks OR main) using the Remotion jump-cuts
 * technique. Must be mounted inside a <Sequence> so useCurrentFrame() returns
 * a local frame that starts at 0 for this group's first frame.
 *
 * trimBefore formula: section.trimAfter - summedUpDurations
 *   = section.trimBefore - prevSum
 *   = S(f) - f    (source frame minus local composition frame)
 * This is the shift OffthreadVideo needs to show source frame S at local frame f.
 * It is always ≥ 0 within a group because source timestamps increase at the same
 * rate as the accumulated playback duration.
 */
const SectionGroupPlayer: React.FC<{
  src: string;
  sections: Section[];
  declickFrames?: number;
  groupFadeOutFrames?: number;
}> = ({
  src,
  sections,
  declickFrames = DECLICK_FRAMES,
  groupFadeOutFrames = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const isStudio = getRemotionEnvironment().isStudio;
  const debugTiming = isTimingDebugEnabled();
  const lastLoggedSectionRef = useRef<number>(-1);
  const totalFrames = sections.reduce((sum, s) => sum + (s.trimAfter - s.trimBefore), 0);

  const cut = (() => {
    let summedUpDurations = 0;
    for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
      const section = sections[sectionIndex];
      summedUpDurations += section.trimAfter - section.trimBefore;
      if (summedUpDurations > frame) {
        const trimBefore = section.trimAfter - summedUpDurations;
        const frameInSection = frame - (summedUpDurations - (section.trimAfter - section.trimBefore));
        return { trimBefore, firstFrameOfSection: frameInSection === 0, frameInSection, sectionIndex };
      }
    }
    return null;
  })();

  useEffect(() => {
    if (!debugTiming || !cut) return;
    if (lastLoggedSectionRef.current === cut.sectionIndex) return;
    lastLoggedSectionRef.current = cut.sectionIndex;
    const section = sections[cut.sectionIndex];
    const sourceStartSec = section.trimBefore / fps;
    const sourceEndSec = section.trimAfter / fps;
    console.info('[timing-debug] section-switch', {
      sectionIndex: cut.sectionIndex,
      sourceStartSec: Number(sourceStartSec.toFixed(3)),
      sourceEndSec: Number(sourceEndSec.toFixed(3)),
      outputFrame: frame,
    });
  }, [debugTiming, cut, sections, fps, frame]);

  const volume = (() => {
    if (declickFrames <= 0) return 1;
    if (!cut) return 1;
    if (cut.frameInSection < declickFrames) return cut.frameInSection / declickFrames;
    return 1;
  })();

  const groupFade = (() => {
    if (groupFadeOutFrames <= 0 || totalFrames <= 0) return 1;
    const framesUntilGroupEnd = totalFrames - frame - 1;
    if (framesUntilGroupEnd >= groupFadeOutFrames) return 1;
    return Math.max(0, framesUntilGroupEnd / groupFadeOutFrames);
  })();

  const effectiveVolume = volume * groupFade;

  if (cut === null) return null;

  const sourceFrame = cut.trimBefore + frame;
  const sourceSeconds = sourceFrame / fps;

  return (
    <>
      <OffthreadVideo
        pauseWhenBuffering={!isStudio}
        // #t=0, prevents Remotion adding its own time fragment based on trimBefore/trimAfter
        src={`${src}#t=0,`}
        trimBefore={cut.trimBefore}
        // Studio preview: allow slight drift for smoother playback under heavy jump-cuts.
        // Final render: keep strict timing.
        acceptableTimeShiftInSeconds={isStudio ? 0.35 : 0}
        // Give the compositor extra time for large seeks deep into a long video file.
        delayRenderTimeoutInMilliseconds={120000}
        volume={effectiveVolume}
        style={{ opacity: groupFade }}
      />
      {debugTiming && (
        <div
          style={{
            position: 'absolute',
            left: 20,
            bottom: 20,
            zIndex: 9999,
            fontSize: 18,
            lineHeight: 1.3,
            fontFamily: 'monospace',
            color: '#fff',
            background: 'rgba(0,0,0,0.7)',
            padding: '8px 10px',
            borderRadius: 6,
          }}
        >
          {`sec#${cut.sectionIndex} outF:${frame} srcF:${sourceFrame} srcT:${sourceSeconds.toFixed(3)} vol:${effectiveVolume.toFixed(3)}`}
        </div>
      )}
    </>
  );
};

// ── SegmentPlayer ─────────────────────────────────────────────────────────────

type Props = {
  /** Resolved staticFile URL for the source video */
  src: string;
  hookSections: Section[];
  mainSections: Section[];
  /**
   * Additional frames to delay the start of main content after hooks end.
   * Use this to insert an intro composition (or any gap) between hooks and the
   * main episode without offsetting trimBefore calculations.
   */
  mainOffset?: number;
};

function isTimingDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const p = new URLSearchParams(window.location.search);
  return p.get('debugTiming') === '1' || p.has('debugCuts');
}

/**
 * Renders the entire edited video as two persistent OffthreadVideo elements:
 * one for hook clips, one for main content. Each lives in its own <Sequence>
 * so trimBefore is computed against a local frame counter, keeping it non-negative.
 */
export const SegmentPlayer: React.FC<Props> = ({ src, hookSections, mainSections, mainOffset = 0 }) => {
  const hookDuration = hookSections.reduce((sum, s) => sum + s.trimAfter - s.trimBefore, 0);

  return (
    <>
      {hookSections.length > 0 && (
        <Sequence from={0} durationInFrames={hookDuration}>
          <SectionGroupPlayer
            src={src}
            sections={hookSections}
            declickFrames={0}
            groupFadeOutFrames={HOOK_END_FADE_FRAMES}
          />
        </Sequence>
      )}
      <Sequence from={hookDuration + mainOffset}>
        <SectionGroupPlayer src={src} sections={mainSections} />
      </Sequence>
    </>
  );
};
