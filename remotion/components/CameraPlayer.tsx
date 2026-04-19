import React, { useMemo } from 'react';
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { SegmentPlayer, getEffectiveDuration, Section } from './SegmentPlayer';
import type { Segment } from '../types/transcript';
import type { CameraProfiles, CameraShot, CropViewport } from '../types/camera';

function resolveVideoSrc(videoSrc: string): string {
  // Already resolved paths (from staticFile or URLs) don't need processing
  if (videoSrc.startsWith('/static-') || videoSrc.startsWith('http')) {
    return videoSrc;
  }
  // Relative paths need staticFile() to resolve to the hashed static URL
  return staticFile(videoSrc);
}

/**
 * Maps a source-video time (seconds) to an output frame index within the main
 * content sequence (frame 0 = first frame of main content, not including hooks).
 *
 * Uses the same mainSections that SegmentPlayer renders, so camera shot boundaries
 * are always in sync with actual playback position even when silence fills
 * inter-segment gaps.
 */
function sourceToOutputFrame(sourceSec: number, mainSections: Section[], fps: number): number {
  let outputFrame = 0;
  for (const sec of mainSections) {
    const secDur = sec.trimAfter - sec.trimBefore;
    const sourceFrame = Math.round(sourceSec * fps);
    if (sourceFrame <= sec.trimAfter) {
      return outputFrame + Math.max(0, sourceFrame - sec.trimBefore);
    }
    outputFrame += secDur;
  }
  return outputFrame;
}

// ── Pacing constants ──────────────────────────────────────────────────────────

const MIN_WIDE_S      = 1.5;   // minimum wide-shot duration before cutting to closeup
const MAX_CLOSEUP_S   = 20.0;  // force return to wide after this long in closeup
const PERIODIC_WIDE_S = 45.0;  // insert a wide every ~45 s of total closeup time
const HOOK_TAIL_PAD_UNBOUNDED_SECONDS = 0.16;
const HOOK_TAIL_PAD_BOUNDED_SECONDS = 0.02;
const HOOK_BRIDGE_MAX_GAP_SECONDS = 1.0;

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
function getOutputDuration(seg: Segment, nextHookStart?: number): number {
  if (seg.hook) {
    // Phrase-bounded hooks play exactly their defined window (no extension).
    if (seg.hookFrom !== undefined && seg.hookTo !== undefined) {
      const sourceStart = seg.hookFrom;
      let sourceEnd = seg.hookTo;
      const hasSpokenTokenAfterEnd = seg.tokens.some(
        (t) => !/_[A-Z]+_/.test(t.text.trim())
          && t.text.trim() !== ''
          && t.t_dtw > sourceEnd + 0.02,
      );
      const endsAtSegmentTail = !hasSpokenTokenAfterEnd;
      const canBridgeToNextHook = nextHookStart !== undefined
        && nextHookStart > sourceEnd
        && nextHookStart - sourceEnd <= HOOK_BRIDGE_MAX_GAP_SECONDS;
      if (endsAtSegmentTail && canBridgeToNextHook) {
        sourceEnd = nextHookStart;
      }
      return (sourceEnd + HOOK_TAIL_PAD_BOUNDED_SECONDS) - sourceStart;
    }
    // Unbounded hooks play the full raw segment, extended when spoken tokens
    // drift past seg.end — must match getHookSubClips in SegmentPlayer.
    const baseEnd = seg.end;
    const latestSpokenToken = seg.tokens
      .filter(t => !/_[A-Z]+_/.test(t.text.trim()) && t.text.trim() !== '')
      .reduce((max, t) => Math.max(max, t.t_dtw), -Infinity);
    let sourceEnd = baseEnd;
    if (latestSpokenToken > baseEnd) {
      const drift = latestSpokenToken - baseEnd;
      const extension = Math.min(1.5, drift + 0.4);
      sourceEnd = baseEnd + extension;
    }
    const hasSpokenTokenAfterEnd = seg.tokens.some(
      (t) => !/_[A-Z]+_/.test(t.text.trim())
        && t.text.trim() !== ''
        && t.t_dtw > sourceEnd + 0.02,
    );
    const endsAtSegmentTail = !hasSpokenTokenAfterEnd;
    const canBridgeToNextHook = nextHookStart !== undefined
      && nextHookStart > sourceEnd
      && nextHookStart - sourceEnd <= HOOK_BRIDGE_MAX_GAP_SECONDS;
    if (endsAtSegmentTail && canBridgeToNextHook) {
      sourceEnd = nextHookStart;
    }
    return (sourceEnd + HOOK_TAIL_PAD_UNBOUNDED_SECONDS) - seg.start;
  }
  return getEffectiveDuration(seg);
}

// ── Pacing algorithm ──────────────────────────────────────────────────────────

/**
 * Builds the camera shot timeline from the active (non-cut) segments.
 * All frame numbers are in the OUTPUT timeline (cuts already removed).
 *
 * mainSections is required so main-content shot positions are derived from the
 * same section map that SegmentPlayer renders, ensuring frame accuracy when
 * silence fills inter-segment gaps.
 */
export function buildCameraShots(
  activeSegments: Segment[],
  profiles: CameraProfiles,
  fps: number,
  mainSections: Section[],
): CameraShot[] {
  const MIN_WIDE_F    = Math.round(MIN_WIDE_S    * fps);
  const MAX_CLOSEUP_F = Math.round(MAX_CLOSEUP_S * fps);
  const PERIODIC_F    = Math.round(PERIODIC_WIDE_S * fps);

  const shots: CameraShot[] = [];

  // Pre-compute total hook output frames so we can anchor main-segment positions.
  const hookSegs = activeSegments.filter(s => s.hook && !s.cut);
  let hookTotalFrames = 0;
  for (let i = 0; i < hookSegs.length; i++) {
    const next = hookSegs[i + 1];
    const nextHookStart = next ? (next.hookFrom ?? next.start) : undefined;
    hookTotalFrames += Math.round(getOutputDuration(hookSegs[i], nextHookStart) * fps);
  }

  const mainTotalFrames = mainSections.reduce((sum, s) => sum + s.trimAfter - s.trimBefore, 0);

  // Non-cut main segments in order — used to compute pacing duration (seg start →
  // next seg start, which includes inter-segment silence in the new model).
  const mainSegsNonCut = activeSegments.filter(s => !s.hook && !s.cut);

  // State
  let shotType: 'wide' | 'closeup' = 'wide';
  let shotStart        = 0;
  let shotSpeaker      = '';    // speaker the current shot is focused on
  let framesInShot     = 0;
  let totalCloseupF    = 0;     // total closeup frames since last wide
  let cumFrame         = 0;     // used only while processing hook segments

  function emitShot(endFrame: number): CameraShot {
    const speakerProfile = shotSpeaker ? profiles.speakers[shotSpeaker] : undefined;
    const angleName = speakerProfile?.angleName;
    const angleConfig = angleName ? profiles.angles?.[angleName] : undefined;
    const videoSrc = angleConfig?.videoSrc;

    const viewport =
      shotType === 'closeup' && shotSpeaker && speakerProfile
        ? speakerProfile.closeupViewport
        : (angleConfig?.wideViewport ?? profiles.wideViewport);

    return { startFrame: shotStart, endFrame, viewport, videoSrc };
  }

  for (const seg of activeSegments) {
    if (seg.cut) continue;

    let segStart: number;
    let segDur: number;

    if (seg.hook) {
      // Hook segments: unchanged — accumulate via cumFrame
      const next = activeSegments.find((cand) => cand.hook && !cand.cut && cand.id > seg.id);
      const nextHookStart = next ? (next.hookFrom ?? next.start) : undefined;
      segDur   = Math.round(getOutputDuration(seg, nextHookStart) * fps);
      segStart = cumFrame;
      cumFrame += segDur;
    } else {
      // Main segments: derive output position from mainSections so silence between
      // segments is accounted for. Duration = distance to next segment's output
      // start (includes trailing silence) for accurate pacing counters.
      segStart = hookTotalFrames + sourceToOutputFrame(seg.start, mainSections, fps);
      const nextMainSeg = mainSegsNonCut.find(s => s.id > seg.id);
      const segOutputEnd = nextMainSeg
        ? hookTotalFrames + sourceToOutputFrame(nextMainSeg.start, mainSections, fps)
        : hookTotalFrames + mainTotalFrames;
      segDur = Math.max(1, segOutputEnd - segStart);
    }

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

  // Close the final shot at the end of the full output timeline
  const totalOutputFrames = hookTotalFrames + mainTotalFrames;
  if (totalOutputFrames > shotStart) shots.push(emitShot(totalOutputFrames));

  return shots;
}

// ── Explicit camera overrides ─────────────────────────────────────────────────

type OverrideEvent = { outputFrame: number; viewport: CropViewport; videoSrc?: string };

/**
 * Walks active segments and maps each CameraCue's `at` (absolute source seconds)
 * to an output-timeline frame. Uses sourceToOutputFrame so cuts and inter-segment
 * silence are automatically accounted for via mainSections.
 */
function collectCameraOverrides(
  activeSegments: Segment[],
  profiles: CameraProfiles,
  fps: number,
  mainSections: Section[],
): OverrideEvent[] {
  const events: OverrideEvent[] = [];

  // Pre-compute hook total frames to anchor main-segment cue positions.
  const hookSegs = activeSegments.filter(s => s.hook && !s.cut);
  let hookTotalFrames = 0;
  for (let i = 0; i < hookSegs.length; i++) {
    hookTotalFrames += Math.round(getOutputDuration(hookSegs[i]) * fps);
  }

  let hookCumFrame = 0; // used only for hook segments

  for (const seg of activeSegments) {
    if (seg.cut) continue;
    const segDur = Math.round(getOutputDuration(seg) * fps);

    for (const cue of (seg.cameraCues ?? [])) {
      const cueSpeakerProfile = cue.speaker ? profiles.speakers[cue.speaker] : undefined;
      const cueAngleName = cueSpeakerProfile?.angleName;
      const cueAngleConfig = cueAngleName ? profiles.angles?.[cueAngleName] : undefined;
      const cueVideoSrc = cueAngleConfig?.videoSrc;

      const viewport =
        cue.shot === 'wide' || !cue.speaker
          ? (cueAngleConfig?.wideViewport ?? profiles.wideViewport)
          : (cueSpeakerProfile?.closeupViewport ?? profiles.wideViewport);

      let outputFrame: number;
      if (seg.hook) {
        // Hook segments: map cue offset within hook's output frames
        const sourceOffset = Math.min(Math.max(0, cue.at - seg.start), seg.end - seg.start);
        outputFrame = hookCumFrame + Math.round(sourceOffset * fps);
      } else {
        // Main segments: sourceToOutputFrame handles cuts and silence directly
        outputFrame = hookTotalFrames + sourceToOutputFrame(cue.at, mainSections, fps);
      }

      events.push({ outputFrame, viewport, videoSrc: cueVideoSrc });
    }

    if (seg.hook) hookCumFrame += segDur;
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

  for (const { outputFrame: F, viewport, videoSrc } of overrides) {
    const idx = result.findIndex(s => s.startFrame <= F && F < s.endFrame);
    if (idx === -1) continue;
    const shot = result[idx];

    if (F === shot.startFrame) {
      result[idx] = { ...shot, viewport, ...(videoSrc !== undefined ? { videoSrc } : {}) };
    } else {
      result.splice(idx, 1,
        { startFrame: shot.startFrame, endFrame: F,            viewport: shot.viewport, videoSrc: shot.videoSrc },
        { startFrame: F,              endFrame: shot.endFrame, viewport,                videoSrc: videoSrc ?? shot.videoSrc },
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
    const pacing    = buildCameraShots(segments, profiles, fps, mainSections);
    const overrides = collectCameraOverrides(segments, profiles, fps, mainSections);
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
        result.push({ startFrame: shot.startFrame, endFrame: hookOutputFrames, viewport: shot.viewport, videoSrc: shot.videoSrc });
        result.push({ startFrame: hookOutputFrames + mainOffset, endFrame: shot.endFrame + mainOffset, viewport: shot.viewport, videoSrc: shot.videoSrc });
      }
    }
    return result;
  }, [segments, profiles, fps, mainSections, hookOutputFrames, mainOffset]);

  // Find current shot
  const currentShot = useMemo(() => {
    let idx = shots.length - 1;
    for (let i = 0; i < shots.length; i++) {
      if (frame < shots[i].endFrame) { idx = i; break; }
    }
    return shots[idx] ?? null;
  }, [frame, shots]);

  // Active video source for this frame (undefined → primary src)
  // Resolve it so comparison with resolved paths in allVideoSrcs works correctly
  const activeVideoSrc = resolveVideoSrc(currentShot?.videoSrc ?? src);
  const viewport = currentShot?.viewport ?? profiles.wideViewport;

  // Collect every unique video source referenced across all shots (always includes primary)
  // Resolve all paths to ensure deduplication works (primary src is resolved, angle paths are relative)
  const allVideoSrcs = useMemo(() => {
    const srcs = new Map<string, string>(); // resolved -> resolved
    srcs.set(src, src); // primary is already resolved
    for (const shot of shots) {
      if (shot.videoSrc) {
        const resolved = resolveVideoSrc(shot.videoSrc);
        srcs.set(resolved, resolved);
      }
    }
    return [...srcs.values()];
  }, [shots, src]);

  // Map each video src to its source dimensions (use resolved paths as keys)
  const angleByVideoSrc = useMemo(() => {
    const map = new Map<string, { srcW: number; srcH: number }>();
    map.set(src, { srcW, srcH }); // primary is already resolved
    for (const angle of Object.values(profiles.angles ?? {})) {
      const resolved = resolveVideoSrc(angle.videoSrc);
      map.set(resolved, { srcW: angle.sourceWidth, srcH: angle.sourceHeight });
    }
    return map;
  }, [src, srcW, srcH, profiles.angles]);

  // Map each video src to its color correction matrix (if color-match has been run)
  const colorCorrectionByVideoSrc = useMemo(() => {
    const map = new Map<string, number[] | null>();
    for (const angle of Object.values(profiles.angles ?? {})) {
      const resolved = resolveVideoSrc(angle.videoSrc);
      map.set(resolved, angle.colorCorrection?.matrix ?? null);
    }
    return map;
  }, [profiles.angles]);

  // Per-angle sections with videoOffset applied (in frames).
  // videoOffset > 0  → angle file is behind transcript → seek later into the file.
  // videoOffset < 0  → angle file is ahead of transcript → seek earlier.
  // The primary src always uses the unmodified sections.
  const sectionsByVideoSrc = useMemo(() => {
    const map = new Map<string, { hook: typeof hookSections; main: typeof mainSections }>();
    map.set(src, { hook: hookSections, main: mainSections });
    for (const angle of Object.values(profiles.angles ?? {})) {
      const resolved = resolveVideoSrc(angle.videoSrc);
      const offsetFrames = Math.round((angle.videoOffset ?? 0) * fps);
      if (offsetFrames === 0) {
        map.set(resolved, { hook: hookSections, main: mainSections });
      } else {
        map.set(resolved, {
          hook: hookSections.map(s => ({ trimBefore: s.trimBefore + offsetFrames, trimAfter: s.trimAfter + offsetFrames })),
          main: mainSections.map(s => ({ trimBefore: s.trimBefore + offsetFrames, trimAfter: s.trimAfter + offsetFrames })),
        });
      }
    }
    return map;
  }, [src, hookSections, mainSections, profiles.angles, fps]);

  return (
    // Outer: fills composition output dimensions, clips the zoomed video
    <AbsoluteFill style={{ overflow: 'hidden', isolation: 'isolate' }}>
      {/* SVG color correction filters — one per angle with a colorCorrection matrix.
          filter: url(#cm-N) on the angle's div routes its pixels through feColorMatrix
          before compositing, matching colour grading across cameras. */}
      <svg style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
        <defs>
          {allVideoSrcs.map((videoSrc, i) => {
            const matrix = colorCorrectionByVideoSrc.get(videoSrc);
            if (!matrix) return null;
            return (
              <filter key={i} id={`cm-${i}`} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
                <feColorMatrix type="matrix" values={matrix.join(' ')} />
              </filter>
            );
          })}
        </defs>
      </svg>

      {allVideoSrcs.map((videoSrc, i) => {
        const dims = angleByVideoSrc.get(videoSrc) ?? { srcW, srcH };
        const isActive = videoSrc === activeVideoSrc;
        const { scale, tx, ty } = computeTransform(viewport, dims.srcW, dims.srcH, outW, outH);
        const angleSections = sectionsByVideoSrc.get(videoSrc) ?? { hook: hookSections, main: mainSections };
        const matrix = colorCorrectionByVideoSrc.get(videoSrc);

        return (
          // Each angle layer fills the output frame; the active one sits on top via
          // zIndex rather than opacity:0. This keeps all layers at opacity:1 so the
          // browser never throttles/pauses their video decode pipeline — opacity:0
          // causes browsers to suspend decode, leaving the layer's currentTime stale
          // and producing a content repeat when it becomes active.
          <AbsoluteFill
            key={videoSrc}
            style={{ zIndex: isActive ? 1 : 0, pointerEvents: 'none' }}
          >
            {/*
              Inner: source video dimensions, centred within the output frame.
              left/top may be negative when output is smaller than source (e.g. portrait).
              transform-origin defaults to 50% 50% (element centre).
            */}
            <div
              style={{
                position: 'absolute',
                width: dims.srcW,
                height: dims.srcH,
                left: (outW - dims.srcW) / 2,
                top:  (outH - dims.srcH) / 2,
                transformOrigin: 'center center',
                // scale THEN translate — the translate operates in scaled coordinate space,
                // which is what the formula requires (see computeTransform).
                transform: `scale(${scale}) translate(${tx}%, ${ty}%)`,
                filter: matrix ? `url(#cm-${i})` : undefined,
              }}
            >
              <SegmentPlayer
                src={resolveVideoSrc(videoSrc)}
                hookSections={angleSections.hook}
                mainSections={angleSections.main}
                mainOffset={mainOffset}
                muted={!isActive}
              />
            </div>
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
};
