import React, { useEffect, useRef } from 'react';
import { OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig, getRemotionEnvironment } from 'remotion';
import type { Segment, TimeCut } from '../types/transcript';
import { isSpokenToken } from '../lib/tokens';

export type SubClip = { sourceStart: number; sourceEnd: number };

export type Section = { trimBefore: number; trimAfter: number };

export type SplitSections = { hookSections: Section[]; mainSections: Section[] };

/** Splits a segment's time range into playable sub-clips, skipping cuts[] ranges. */
export function getSubClips(segment: Segment): SubClip[] {
  const allCuts = [...(segment.cuts ?? []), ...(segment.visualCuts ?? [])];
  if (allCuts.length === 0) {
    return [{ sourceStart: segment.start, sourceEnd: segment.end }];
  }

  const clips: SubClip[] = [];
  let cursor = segment.start;

  // Clamp cuts to [segment.start, segment.end] and discard invalid ones.
  // Whisper t_dtw values can drift outside the segment window, producing
  // inverted (from > to) or zero-duration cuts that would corrupt playback.
  const sorted = [...allCuts]
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
  const cutSegments = allMainSegments.filter(s => s.cut);
  const activeMain = allMainSegments.filter(s => !s.cut);
  if (activeMain.length === 0) return [];

  const rangeStart = videoStart ?? activeMain[0].start;
  // Clamp rangeEnd to the last non-cut segment's end so that when videoEnd
  // lands on a cut segment (e.g. > END after -[261]), we don't render the
  // gap between the last kept segment and the cut segment as dead air.
  const lastActiveEnd = activeMain[activeMain.length - 1].end;
  const rangeEnd = Math.min(videoEnd ?? lastActiveEnd, lastActiveEnd);

  console.log(`[buildMainSubClips] range: ${rangeStart.toFixed(2)}-${rangeEnd.toFixed(2)}, cutSegments: ${cutSegments.length}`);

  // Collect all exclusion ranges
  const cutRanges: { from: number; to: number }[] = [];

  for (const seg of cutSegments) {
    console.log(`  Adding cut segment [${seg.id}]: ${seg.start.toFixed(2)}-${seg.end.toFixed(2)}`);
    cutRanges.push({ from: seg.start, to: seg.end });
  }
  // Add gaps between non-contiguous non-cut segments as cuts
  // (when cut segments exist between two kept segments)
  for (let i = 1; i < activeMain.length; i++) {
    const prev = activeMain[i - 1];
    const curr = activeMain[i];
    const gapStart = prev.end;
    const gapEnd = curr.start;
    // Only add gap if there's actual cut content overlapping it
    const hasCutContentBetween = cutSegments.some(s => s.start < gapEnd && s.end > gapStart);
    if (gapEnd > gapStart && hasCutContentBetween) {
      console.log(`  Adding gap between [${prev.id}] and [${curr.id}]: ${gapStart.toFixed(2)}-${gapEnd.toFixed(2)}`);
      cutRanges.push({ from: gapStart, to: gapEnd });
    }
  }
  for (const seg of activeMain) {
    for (const c of [...(seg.cuts ?? []), ...(seg.visualCuts ?? [])]) {
      const from = Math.max(c.from, seg.start);
      const to   = Math.min(c.to,   seg.end);
      if (to > from) cutRanges.push({ from, to });
    }
  }

  // Sort and merge overlapping/adjacent exclusion ranges
  cutRanges.sort((a, b) => a.from - b.from);
  const merged: { from: number; to: number }[] = [];
  const FRAME_TOLERANCE = 2.0; // Merge gaps up to 2 seconds (handles adjacent cut segments)
  for (const c of cutRanges) {
    const last = merged[merged.length - 1];
    if (last && c.from <= last.to + FRAME_TOLERANCE) {
      last.to = Math.max(last.to, c.to);
    } else {
      merged.push(c);
    }
  }

  console.log(`  Merged cut ranges:`, merged.map(c => `${c.from.toFixed(2)}-${c.to.toFixed(2)}`));

  // Invert: the gaps between exclusions are the playable clips
  const clips: SubClip[] = [];
  let cursor = rangeStart;
  for (const cut of merged) {
    if (cut.from > cursor) clips.push({ sourceStart: cursor, sourceEnd: cut.from });
    cursor = Math.max(cursor, cut.to);
  }
  if (cursor < rangeEnd) clips.push({ sourceStart: cursor, sourceEnd: rangeEnd });

  console.log(`  Generated ${clips.length} subclips:`, clips.map(c => `${c.sourceStart.toFixed(2)}-${c.sourceEnd.toFixed(2)}`));

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
    const tEnd = nextHookStart !== undefined
      ? Math.min(lastSpokenToken.t_end, nextHookStart)
      : lastSpokenToken.t_end;
    sourceEnd = Math.max(sourceEnd, tEnd);
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

  // Hard cap: never extend into the next hook's source window.
  // Prevents overlapping source ranges which cause backward jumps in SectionGroupPlayer.
  if (nextHookStart !== undefined) {
    sourceEnd = Math.min(sourceEnd, nextHookStart);
  }

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
  const rawHookSections = hookSegments
    .flatMap((seg, idx) => {
      const next = hookSegments[idx + 1];
      const nextHookStart = next ? (next.hookFrom ?? next.start) : undefined;
      return toSections(getHookSubClips(seg, nextHookStart), fps);
    });
  // De-overlap: if a section's trimBefore precedes the previous section's trimAfter
  // (caused by t_end extension or bridging across overlapping source ranges), advance it.
  const hookSections: Section[] = [];
  for (const s of rawHookSections) {
    const prev = hookSections[hookSections.length - 1];
    const trimBefore = prev ? Math.max(s.trimBefore, prev.trimAfter) : s.trimBefore;
    if (trimBefore < s.trimAfter) {
      hookSections.push({ trimBefore, trimAfter: s.trimAfter });
    }
  }
  const allMainSegments = segments.filter(s => !s.hook);
  const mainSubClips = buildMainSubClips(allMainSegments, videoStart, videoEnd);
  const rawMainSections = toSections(mainSubClips, fps);

  // De-overlap: ensure no gaps between main sections (fix microsecond cut remnants)
  const mainSections: Section[] = [];
  for (const s of rawMainSections) {
    const prev = mainSections[mainSections.length - 1];
    const trimBefore = prev ? Math.max(s.trimBefore, prev.trimAfter) : s.trimBefore;
    if (trimBefore < s.trimAfter) {
      mainSections.push({ trimBefore, trimAfter: s.trimAfter });
    }
  }

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
  muted?: boolean;
}> = ({
  src,
  sections,
  declickFrames = DECLICK_FRAMES,
  groupFadeOutFrames = 0,
  muted = false,
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
  // opacity:0 causes browsers to suspend video decode (videoWidth→0), which makes
  // Remotion's createImageData call fail. Unmount instead of rendering invisible.
  if (effectiveVolume <= 0 && groupFade <= 0) return null;

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
        volume={muted ? 0 : effectiveVolume}
        style={{ opacity: groupFade }}
        onError={(err) => {
          // eslint-disable-next-line no-console
          console.error('[OffthreadVideo] Playback error:', err);
          // Remotion error objects have errorCode for media errors
          const errorCode = (err as { errorCode?: number }).errorCode;
          if (errorCode === 4) {
            // eslint-disable-next-line no-console
            console.error(
              `[OffthreadVideo] MEDIA_ERR_SRC_NOT_SUPPORTED for "${src}". ` +
              'This may be due:\n' +
              '1. Video file >2GB (Chrome limit) - try re-encoding with lower bitrate\n' +
              '2. Unsupported codec (ensure H.264, not H.265/HEVC)\n' +
              '3. Corrupted file - check source video integrity'
            );
          }
        }}
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
            color: '#111',
            background: 'rgba(255,255,255,0.88)',
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
  /**
   * When true, audio is suppressed (volume set to 0).
   * Used by CameraPlayer to silence non-active angle layers in multi-angle shoots.
   */
  muted?: boolean;
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
export const SegmentPlayer: React.FC<Props> = ({ src, hookSections, mainSections, mainOffset = 0, muted = false }) => {
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
            muted={muted}
          />
        </Sequence>
      )}
      <Sequence from={hookDuration + mainOffset}>
        <SectionGroupPlayer src={src} sections={mainSections} muted={muted} />
      </Sequence>
    </>
  );
};
