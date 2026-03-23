import React from 'react';
import { Sequence, OffthreadVideo, useVideoConfig } from 'remotion';
import type { Segment, TimeCut } from '../types/transcript';

type SubClip = { sourceStart: number; sourceEnd: number };

/** Splits a segment's time range into playable sub-clips, skipping cuts[] ranges. */
export function getSubClips(segment: Segment): SubClip[] {
  const clips: SubClip[] = [];
  let cursor = segment.start;

  const sorted = [...segment.cuts].sort((a: TimeCut, b: TimeCut) => a.from - b.from);
  for (const cut of sorted) {
    if (cut.from > cursor) clips.push({ sourceStart: cursor, sourceEnd: cut.from });
    cursor = cut.to;
  }
  if (cursor < segment.end) clips.push({ sourceStart: cursor, sourceEnd: segment.end });

  return clips;
}

/** Playable duration of a segment after all cuts are removed. */
export function getEffectiveDuration(segment: Segment): number {
  return getSubClips(segment).reduce((sum, c) => sum + (c.sourceEnd - c.sourceStart), 0);
}

type Props = {
  /** Resolved staticFile URL for the source video */
  src: string;
  segment: Segment;
};

/**
 * Renders a single segment as consecutive Remotion Sequences, one per sub-clip.
 * Each sub-clip jumps the source video to the correct start point, producing
 * a seamless jump-cut across any word-level or segment-level cuts.
 *
 * Must be rendered inside a <Sequence durationInFrames={getEffectiveDuration(segment) * fps}>.
 */
export const SegmentPlayer: React.FC<Props> = ({ src, segment }) => {
  const { fps } = useVideoConfig();
  const clips = getSubClips(segment);

  let frameOffset = 0;
  return (
    <>
      {clips.map((clip, i) => {
        const durationFrames = Math.round((clip.sourceEnd - clip.sourceStart) * fps);
        const from = frameOffset;
        frameOffset += durationFrames;

        if (durationFrames <= 0) return null;

        const startFrom = Math.round(clip.sourceStart * fps);
        return (
          <Sequence key={i} from={from} durationInFrames={durationFrames}>
            <OffthreadVideo
              src={src}
              startFrom={startFrom}
              endAt={startFrom + durationFrames}
            />
          </Sequence>
        );
      })}
    </>
  );
};
