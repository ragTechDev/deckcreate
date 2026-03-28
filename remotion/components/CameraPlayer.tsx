import React, { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { SegmentPlayer, getEffectiveDuration, buildSections, Section } from './SegmentPlayer';
import type { Segment } from '../types/transcript';
import type { CameraProfiles, CameraShot, CropViewport } from '../types/camera';
import type { CameraCue } from '../types/transcript';

// ── Pacing constants ──────────────────────────────────────────────────────────

const MIN_WIDE_S      = 1.5;   // minimum wide-shot duration before cutting to closeup
const MIN_CLOSEUP_S   = 3.0;   // minimum closeup duration before cutting away
const MAX_CLOSEUP_S   = 20.0;  // force return to wide after this long in closeup
const PERIODIC_WIDE_S = 45.0;  // insert a wide every ~45 s of total closeup time

// ── Transform helpers ─────────────────────────────────────────────────────────

/**
 * Compute CSS scale + translate values for a given viewport.
 *
 * Formula: scale(S) translate(tx%, ty%)  — scale THEN translate in scaled space.
 * This universally handles landscape closeups, portrait strips, and any output size.
 *
 * Derivation:
 *   S    = max(outW / (srcW * vp.w),  outH / (srcH * vp.h))   ← fills frame without bars
 *   tx   = (0.5 - vp.cx) * 100 %                               ← centres desired point
 *   ty   = (0.5 - vp.cy) * 100 %
 */
function computeTransform(
  vp: CropViewport,
  srcW: number, srcH: number,
  outW: number, outH: number,
): { scale: number; tx: number; ty: number } {
  const scale = Math.max(outW / (srcW * vp.w), outH / (srcH * vp.h));
  const tx = (0.5 - vp.cx) * 100;
  const ty = (0.5 - vp.cy) * 100;
  return { scale, tx, ty };
}


/**
 * The duration a segment contributes to the output timeline.
 * For phrase hooks this is the hook clip window, not the full segment duration.
 * Must match the clip length that buildSections emits for the same segment.
 */
function getOutputDuration(seg: Segment): number {
  if (seg.hook) {
    // Hooks with a phrase window play only that window; hooks without one play
    // the full raw segment UNCUT (getHookSubClips ignores cuts[] for these so
    // the music stays in sync). Use raw end-start to match SegmentPlayer exactly.
    if (seg.hookFrom !== undefined && seg.hookTo !== undefined) {
      return seg.hookTo - seg.hookFrom;
    }
    return seg.end - seg.start;
  }
  return getEffectiveDuration(seg);
}

// ── Pacing algorithm ──────────────────────────────────────────────────────────

/**
 * Builds the camera shot timeline from the active (non-cut) segments.
 * All frame numbers are in the OUTPUT timeline (cuts already removed).
 */
export function buildCameraShots(
  activeSegments: Segment[],
  profiles: CameraProfiles,
  fps: number,
): CameraShot[] {
  const MIN_WIDE_F    = Math.round(MIN_WIDE_S    * fps);
  const MIN_CLOSEUP_F = Math.round(MIN_CLOSEUP_S * fps);
  const MAX_CLOSEUP_F = Math.round(MAX_CLOSEUP_S * fps);
  const PERIODIC_F    = Math.round(PERIODIC_WIDE_S * fps);

  const shots: CameraShot[] = [];

  // State
  let shotType: 'wide' | 'closeup' = 'wide';
  let shotStart        = 0;
  let shotSpeaker      = '';    // speaker the current shot is focused on
  let framesInShot     = 0;
  let totalCloseupF    = 0;     // total closeup frames since last wide
  let cumFrame         = 0;

  function emitShot(endFrame: number): CameraShot {
    const viewport =
      shotType === 'closeup' && shotSpeaker && profiles.speakers[shotSpeaker]
        ? profiles.speakers[shotSpeaker].closeupViewport
        : profiles.wideViewport;
    return { startFrame: shotStart, endFrame, viewport };
  }

  for (const seg of activeSegments) {
    if (seg.cut) continue;
    const segDur   = Math.round(getOutputDuration(seg) * fps);
    const segStart = cumFrame;
    cumFrame      += segDur;

    const profile = profiles.speakers[seg.speaker];

    if (shotType === 'wide') {
      // Switch to closeup at this segment boundary when ready
      if (framesInShot >= MIN_WIDE_F && profile) {
        if (segStart > shotStart) shots.push(emitShot(segStart));
        shotStart    = segStart;
        shotType     = 'closeup';
        shotSpeaker  = seg.speaker;
        framesInShot = 0;
        totalCloseupF = 0;
      }
      framesInShot += segDur;

    } else { // closeup
      // Force wide on max duration; also go wide if the speaker is unknown.
      // MIN_CLOSEUP_F only guards closeup→wide transitions, not speaker changes.
      const forceWide     = framesInShot >= MAX_CLOSEUP_F || totalCloseupF >= PERIODIC_F;
      const speakerChange = !!profile && seg.speaker !== shotSpeaker;

      if (forceWide || !profile) {
        // Return to wide shot
        if (segStart > shotStart) shots.push(emitShot(segStart));
        shotStart     = segStart;
        shotType      = 'wide';
        shotSpeaker   = '';
        framesInShot  = segDur;   // count this segment as wide time
        totalCloseupF = 0;

      } else if (speakerChange) {
        // Cut directly to new speaker's closeup (no minimum — follow the speaker)
        // Only gate: don't cut if the previous closeup was extremely short (<1 s)
        // to avoid flash-cuts on single-word segments.
        if (framesInShot >= fps || shotStart === segStart) {
          if (segStart > shotStart) shots.push(emitShot(segStart));
          shotStart     = segStart;
          shotSpeaker   = seg.speaker;
          framesInShot  = segDur;
          totalCloseupF += segDur;
        } else {
          // Previous closeup too short — extend it rather than flash-cutting
          framesInShot  += segDur;
          totalCloseupF += segDur;
        }

      } else {
        framesInShot  += segDur;
        totalCloseupF += segDur;
      }
    }
  }

  // Close the final shot
  if (cumFrame > shotStart) shots.push(emitShot(cumFrame));

  return shots;
}

// ── Explicit camera overrides ─────────────────────────────────────────────────

type OverrideEvent = { outputFrame: number; viewport: CropViewport };

/**
 * Walks active segments and maps each CameraCue's `at` (absolute source seconds)
 * to an output-timeline frame, respecting cuts within the segment.
 */
function collectCameraOverrides(
  activeSegments: Segment[],
  profiles: CameraProfiles,
  fps: number,
): OverrideEvent[] {
  const events: OverrideEvent[] = [];
  let cumFrame = 0;

  for (const seg of activeSegments) {
    if (seg.cut) continue;
    const segDur = Math.round(getOutputDuration(seg) * fps);

    for (const cue of (seg.cameraCues ?? [])) {
      const viewport =
        cue.shot === 'wide' || !cue.speaker
          ? profiles.wideViewport
          : (profiles.speakers[cue.speaker]?.closeupViewport ?? profiles.wideViewport);

      // Map cue.at to an offset within this segment's output frames, subtracting
      // any cuts that precede cue.at.
      let frameOffset = 0;
      if (cue.at > seg.start) {
        const sourceOffset = Math.min(cue.at - seg.start, seg.end - seg.start);
        let cutsBefore = 0;
        for (const cut of (seg.cuts ?? [])) {
          if (cut.from >= cue.at) break;
          cutsBefore += Math.min(cut.to, cue.at) - cut.from;
        }
        frameOffset = Math.round(Math.max(0, sourceOffset - cutsBefore) * fps);
      }

      events.push({ outputFrame: cumFrame + frameOffset, viewport });
    }

    cumFrame += segDur;
  }

  return events.sort((a, b) => a.outputFrame - b.outputFrame);
}

/**
 * Splices explicit camera override events into the pacing-algorithm shot list.
 * Each override splits the shot that contains it and replaces the viewport
 * from that frame forward (until the next shot boundary).
 */
function applyOverrides(shots: CameraShot[], overrides: OverrideEvent[]): CameraShot[] {
  if (!overrides.length) return shots;
  const result = [...shots];

  for (const { outputFrame: F, viewport } of overrides) {
    const idx = result.findIndex(s => s.startFrame <= F && F < s.endFrame);
    if (idx === -1) continue;
    const shot = result[idx];

    if (F === shot.startFrame) {
      result[idx] = { ...shot, viewport };
    } else {
      result.splice(idx, 1,
        { startFrame: shot.startFrame, endFrame: F,            viewport: shot.viewport },
        { startFrame: F,              endFrame: shot.endFrame, viewport },
      );
    }
  }

  return result;
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  src: string;
  hookSections: Section[];
  mainSections: Section[];
  mainOffset?: number;
  segments: Segment[];
  profiles: CameraProfiles;
};

export const CameraPlayer: React.FC<Props> = ({ src, hookSections, mainSections, mainOffset = 0, segments, profiles }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const srcW = profiles.sourceWidth;
  const srcH = profiles.sourceHeight;
  const outW = profiles.outputWidth;
  const outH = profiles.outputHeight;

  // Total hook duration in output frames — shots for main content start here in
  // buildCameraShots's timeline, but in the composition they start mainOffset
  // frames later (the intro plays in between). We shift them after building.
  const hookOutputFrames = useMemo(
    () => segments
      .filter(s => s.hook && !s.cut)
      .reduce((sum, s) => sum + Math.round(getOutputDuration(s) * fps), 0),
    [segments, fps],
  );

  // Build shot timeline once, then splice in any explicit > CAM overrides.
  // If mainOffset > 0, shift every main-content shot forward by mainOffset so
  // the composition-frame lookup stays in sync with the actual playback position.
  const shots = useMemo(() => {
    const pacing    = buildCameraShots(segments, profiles, fps);
    const overrides = collectCameraOverrides(segments, profiles, fps);
    const applied   = applyOverrides(pacing, overrides);
    if (mainOffset === 0) return applied;
    // Split any shot that straddles the hook/main boundary so the main portion
    // gets shifted by mainOffset. A shot that starts in hook territory but ends
    // in main territory would otherwise remain unshifted, leaving a gap and
    // causing the wrong viewport to appear during early main-content frames.
    const result: CameraShot[] = [];
    for (const shot of applied) {
      if (shot.endFrame <= hookOutputFrames) {
        // Entirely within hook territory — no change
        result.push(shot);
      } else if (shot.startFrame >= hookOutputFrames) {
        // Entirely within main territory — shift by mainOffset
        result.push({ ...shot, startFrame: shot.startFrame + mainOffset, endFrame: shot.endFrame + mainOffset });
      } else {
        // Spans the boundary — split into hook portion (unchanged) and main portion (shifted)
        result.push({ startFrame: shot.startFrame, endFrame: hookOutputFrames, viewport: shot.viewport });
        result.push({ startFrame: hookOutputFrames + mainOffset, endFrame: shot.endFrame + mainOffset, viewport: shot.viewport });
      }
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, profiles, fps, hookOutputFrames, mainOffset]);

  // Find current shot
  const currentShot = useMemo(() => {
    let idx = shots.length - 1;
    for (let i = 0; i < shots.length; i++) {
      if (frame < shots[i].endFrame) { idx = i; break; }
    }
    return shots[idx] ?? null;
  }, [frame, shots]);

  const viewport = currentShot?.viewport ?? profiles.wideViewport;
  const { scale, tx, ty } = computeTransform(viewport, srcW, srcH, outW, outH);

  return (
    // Outer: fills composition output dimensions, clips the zoomed video
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      {/*
        Inner: source video dimensions, centred within the output frame.
        left/top may be negative when output is smaller than source (e.g. portrait).
        transform-origin defaults to 50% 50% (element centre).
      */}
      <div
        style={{
          position: 'absolute',
          width: srcW,
          height: srcH,
          left: (outW - srcW) / 2,
          top:  (outH - srcH) / 2,
          transformOrigin: 'center center',
          // scale THEN translate — the translate operates in scaled coordinate space,
          // which is what the formula requires (see computeTransform).
          transform: `scale(${scale}) translate(${tx}%, ${ty}%)`,
        }}
      >
        <SegmentPlayer src={src} hookSections={hookSections} mainSections={mainSections} mainOffset={mainOffset} />
      </div>
    </AbsoluteFill>
  );
};
