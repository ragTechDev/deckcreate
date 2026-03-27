import React, { useMemo } from 'react';
import { OffthreadVideo, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Segment, TimeCut } from '../types/transcript';

type SubClip = { sourceStart: number; sourceEnd: number };

export type Section = { trimBefore: number; trimAfter: number };

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

/** Convert all non-cut segments to a flat sections array (frames) for JumpCuts. */
export function buildSections(segments: Segment[], fps: number): Section[] {
  return segments
    .filter(s => !s.cut)
    .flatMap(seg =>
      getSubClips(seg).map(c => ({
        trimBefore: Math.round(c.sourceStart * fps),
        trimAfter: Math.round(c.sourceEnd * fps),
      })),
    );
}

type Props = {
  /** Resolved staticFile URL for the source video */
  src: string;
  sections: Section[];
};

/**
 * Renders the entire edited video as a single persistent OffthreadVideo.
 * trimBefore is recomputed each frame to skip cuts — the video element never
 * unmounts, so there are no seek stalls at segment or cut boundaries.
 * Based on https://www.remotion.dev/docs/miscellaneous/snippets/jumpcuts
 */
// Frames to fade in/out at each cut boundary (~50ms at 60fps)
const DECLICK_FRAMES = 3;

export const SegmentPlayer: React.FC<Props> = ({ src, sections }) => {
  const frame = useCurrentFrame();

  const cut = useMemo(() => {
    let summedUpDurations = 0;
    for (const section of sections) {
      summedUpDurations += section.trimAfter - section.trimBefore;
      if (summedUpDurations > frame) {
        const trimBefore = section.trimAfter - summedUpDurations;
        const offset = section.trimBefore - frame - trimBefore;
        const frameInSection = frame - (summedUpDurations - (section.trimAfter - section.trimBefore));
        const framesUntilSectionEnd = summedUpDurations - frame - 1;
        return { trimBefore, firstFrameOfSection: offset === 0, frameInSection, framesUntilSectionEnd };
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
      // Allow up to 0.1 s of drift on section-start frames — tight enough for clean
      // cuts but avoids forcing the compositor to decode across a long keyframe gap,
      // which was the cause of 28 s proxy timeouts on videos with sparse keyframes.
      acceptableTimeShiftInSeconds={cut.firstFrameOfSection ? 0.1 : undefined}
      // Give the compositor extra time for large seeks deep into a long video file.
      delayRenderTimeoutInMilliseconds={60000}
      volume={volume}
    />
  );
};
