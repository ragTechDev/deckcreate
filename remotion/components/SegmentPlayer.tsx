import React, { useMemo } from 'react';
import { OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Segment, TimeCut } from '../types/transcript';

type SubClip = { sourceStart: number; sourceEnd: number };

export type Section = { trimBefore: number; trimAfter: number };

export type SplitSections = { hookSections: Section[]; mainSections: Section[] };

/** Splits a segment's time range into playable sub-clips, skipping cuts[] ranges. */
export function getSubClips(segment: Segment): SubClip[] {
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

/** Returns the clip range for a hook segment: phrase window if set, else the raw segment
 *  (no cuts applied — hook clips play uninterrupted so the music stays in sync).
 *
 *  The clip end is extended by 0.5 s when any token drifts past the segment
 *  boundary, matching buildCaptions' filter window in HookOverlay so the video
 *  frame is still visible when those late captions first appear. */
function getHookSubClips(segment: Segment): SubClip[] {
  const sourceStart = segment.hookFrom ?? segment.start;
  const baseEnd     = segment.hookTo   ?? segment.end;
  // Only extend unbounded hooks (no explicit hookTo). Phrase-bounded hooks play
  // exactly their defined window so post-phrase tokens don't leak in.
  const hasLateToken = (segment.hookTo === undefined || segment.hookTo === null)
    && segment.tokens.some(
      t => t.t_dtw > baseEnd && t.t_dtw < baseEnd + 0.5
        && !/_[A-Z]+_/.test(t.text.trim()) && t.text.trim() !== '',
    );
  const sourceEnd = hasLateToken ? baseEnd + 0.5 : baseEnd;
  return [{ sourceStart, sourceEnd }];
}

function toSections(clips: SubClip[], fps: number): Section[] {
  return clips.map(c => ({
    trimBefore: Math.round(c.sourceStart * fps),
    trimAfter: Math.round(c.sourceEnd * fps),
  }));
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
 */
export function buildSections(segments: Segment[], fps: number): SplitSections {
  const hookSections = segments
    .filter(s => s.hook && !s.cut)
    .flatMap(seg => toSections(getHookSubClips(seg), fps));
  const mainSections = segments
    .filter(s => !s.hook && !s.cut)
    .flatMap(seg => toSections(getSubClips(seg), fps));
  return { hookSections, mainSections };
}

// ── Jump-cuts player for one group ───────────────────────────────────────────

// Frames to fade in/out at each cut boundary (~50ms at 60fps)
const DECLICK_FRAMES = 3;

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
const SectionGroupPlayer: React.FC<{ src: string; sections: Section[] }> = ({ src, sections }) => {
  const frame = useCurrentFrame();

  const cut = useMemo(() => {
    let summedUpDurations = 0;
    for (const section of sections) {
      summedUpDurations += section.trimAfter - section.trimBefore;
      if (summedUpDurations > frame) {
        const trimBefore = section.trimAfter - summedUpDurations;
        const frameInSection = frame - (summedUpDurations - (section.trimAfter - section.trimBefore));
        const framesUntilSectionEnd = summedUpDurations - frame - 1;
        return { trimBefore, firstFrameOfSection: frameInSection === 0, frameInSection, framesUntilSectionEnd };
      }
    }
    return null;
  }, [frame, sections]);

  const volume = useMemo(() => {
    if (!cut) return 1;
    if (cut.frameInSection < DECLICK_FRAMES) return cut.frameInSection / DECLICK_FRAMES;
    if (cut.framesUntilSectionEnd < DECLICK_FRAMES) return cut.framesUntilSectionEnd / DECLICK_FRAMES;
    return 1;
  }, [cut]);

  if (cut === null) return null;

  return (
    <OffthreadVideo
      pauseWhenBuffering
      // #t=0, prevents Remotion adding its own time fragment based on trimBefore/trimAfter
      src={`${src}#t=0,`}
      trimBefore={cut.trimBefore}
      // Allow up to 5 s of drift on section-start frames so the compositor can
      // snap to the nearest keyframe rather than decoding a long chain — critical
      // for hook segments that live deep (e.g. 240 s) into a long source file.
      acceptableTimeShiftInSeconds={cut.firstFrameOfSection ? 5 : undefined}
      // Give the compositor extra time for large seeks deep into a long video file.
      delayRenderTimeoutInMilliseconds={120000}
      volume={volume}
    />
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
          <SectionGroupPlayer src={src} sections={hookSections} />
        </Sequence>
      )}
      <Sequence from={hookDuration + mainOffset}>
        <SectionGroupPlayer src={src} sections={mainSections} />
      </Sequence>
    </>
  );
};
