import React, { useMemo } from 'react';
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { SegmentPlayer, getEffectiveDuration, Section } from './SegmentPlayer';
import type { Segment } from '../types/transcript';
import type { CameraProfiles, CameraShot, CropViewport, AngleConfig, SpeakerProfile } from '../types/camera';

function resolveVideoSrc(videoSrc: string): string {
  // Already resolved paths (from staticFile or URLs) don't need processing
  if (videoSrc.startsWith('/static-') || videoSrc.startsWith('http') || videoSrc.startsWith('/public/')) {
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
  const sourceFrame = Math.round(sourceSec * fps);
  console.log(`[CameraDebug] sourceToOutputFrame: sourceSec=${sourceSec}s sourceFrame=${sourceFrame}, sections=${mainSections.length}`);
  for (const sec of mainSections) {
    const secDur = sec.trimAfter - sec.trimBefore;
    console.log(`[CameraDebug]   section trimBefore=${sec.trimBefore} trimAfter=${sec.trimAfter} secDur=${secDur}`);
    if (sourceFrame <= sec.trimAfter) {
      const result = outputFrame + Math.max(0, sourceFrame - sec.trimBefore);
      console.log(`[CameraDebug]   -> returning ${result}`);
      return result;
    }
    outputFrame += secDur;
  }
  console.log(`[CameraDebug]   -> fallback ${outputFrame}`);
  return outputFrame;
}

// ── Pacing constants ──────────────────────────────────────────────────────────

const MIN_WIDE_S      = 1.5;   // minimum wide-shot duration before cutting to closeup
const MAX_CLOSEUP_S   = 10.0;  // force return to wide after this long in closeup (10s cycle)
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

// ── Time-keyed viewport helpers ───────────────────────────────────────────────

import type { TimeKeyedViewport } from '../types/camera';

/**
 * Select the appropriate viewport for a given source time.
 * If time-keyed viewports are available, picks the one whose time range contains sourceSec.
 * Falls back to defaultViewport if no matching time range found.
 */
function selectViewportForTime(
  sourceSec: number,
  timeKeyedViewports: TimeKeyedViewport[] | undefined,
  defaultViewport: CropViewport,
): CropViewport {
  if (!timeKeyedViewports || timeKeyedViewports.length === 0) {
    return defaultViewport;
  }

  // Find the viewport whose time range contains sourceSec
  // Time ranges are [from, to) - inclusive of from, exclusive of to
  const match = timeKeyedViewports.find(
    tk => sourceSec >= tk.from && sourceSec < tk.to
  );

  return match ? match.viewport : defaultViewport;
}

/**
 * Look up speaker profile from CameraProfiles.
 * Tries speaker:angleName format first (new format from GUI with timeframes),
 * then searches for any key matching the speaker (speaker:angle or speaker-only).
 */
function getSpeakerProfile(
  profiles: CameraProfiles,
  speaker: string,
  angleName?: string
): SpeakerProfile | undefined {
  // Try speaker:angle format first if angleName provided
  if (angleName) {
    const key = `${speaker}:${angleName}`;
    if (profiles.speakers[key]) return profiles.speakers[key];
  }
  // Try legacy speaker-only format
  if (profiles.speakers[speaker]) return profiles.speakers[speaker];
  // Search for any key that starts with "speaker:" (speaker:angle format)
  for (const key of Object.keys(profiles.speakers)) {
    if (key === speaker || key.startsWith(`${speaker}:`)) {
      return profiles.speakers[key];
    }
  }
  return undefined;
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
  activeSegmentsInput: Segment[],
  profiles: CameraProfiles,
  fps: number,
  mainSections: Section[],
  hookSections: Section[],
  isShortForm = false,
): CameraShot[] {
  // Sort all segments by start time to ensure chronological processing
  const activeSegments = [...activeSegmentsInput].sort((a, b) => a.start - b.start);
  console.log('[CameraDebug] buildCameraShots called with', activeSegments.length, 'segments');
  console.log('[CameraDebug] First 5 segments by time:', activeSegments.slice(0, 5).map(s => `id=${s.id} start=${s.start} speaker=${s.speaker}`));

  const MIN_WIDE_F    = Math.round(MIN_WIDE_S    * fps);
  const MAX_CLOSEUP_F = Math.round(MAX_CLOSEUP_S * fps);
  const PERIODIC_F    = Math.round(PERIODIC_WIDE_S * fps);

  const shots: CameraShot[] = [];

  // Derive hookTotalFrames from the same hookSections that SegmentPlayer uses for playback.
  // Using getOutputDuration here would produce a different value (different token-extension
  // formula) and create a timing gap at the hook/main boundary where the camera falls back
  // to the last hook shot rather than the first main-content speaker.
  const hookSegs = activeSegments.filter(s => s.hook && !s.cut);
  const hookTotalFrames = hookSections.reduce((sum, s) => sum + s.trimAfter - s.trimBefore, 0);
  console.log('[CameraDebug] hookTotalFrames:', hookTotalFrames, '= seconds:', (hookTotalFrames/fps).toFixed(1));

  const mainTotalFrames = mainSections.reduce((sum, s) => sum + s.trimAfter - s.trimBefore, 0);

  // Non-cut main segments in order — used to compute pacing duration (seg start →
  // next seg start, which includes inter-segment silence in the new model).
  const mainSegsNonCut = activeSegments.filter(s => !s.hook && !s.cut);

  // State
  let shotType: 'wide' | 'closeup' = 'wide';
  let shotStart        = 0;
  let shotSpeaker      = '';    // speaker the current shot is focused on
  let shotAngleIndex   = 0;     // which angle of the current speaker we're using
  let framesInShot     = 0;
  let totalCloseupF    = 0;     // total closeup frames since last wide
  let cumFrame         = 0;     // used only while processing hook segments
  let currentSourceTime = 0;    // track source time for time-keyed viewports
  let reactionIdx      = 0;     // cycles through non-speaking speakers for short-form reaction shots

  const firstAngleVideoSrc = profiles.angles
    ? Object.values(profiles.angles)[0]?.videoSrc
    : undefined;

  // Short-form: pick the next non-speaking configured speaker for a reaction closeup.
  function getReactionInfo(currentSpeaker: string): { speaker: string } | undefined {
    const allSpeakers = [...new Set(
      Object.keys(profiles.speakers).map(key => key.split(':')[0])
    )];
    const others = allSpeakers.filter(s => s !== currentSpeaker);
    if (others.length === 0) return undefined;
    const speaker = others[reactionIdx % others.length];
    reactionIdx++;
    return getSpeakerProfile(profiles, speaker, getSpeakerAngles(speaker)[0]?.angleName)
      ? { speaker }
      : undefined;
  }

  // Helper: get all angles where this speaker has a configured profile
  // Speakers are keyed as "speakerName:angleName" in the profiles
  function getSpeakerAngles(speaker: string): Array<{angleName: string; angleConfig: AngleConfig; speakerProfile: SpeakerProfile}> {
    if (!profiles.angles) return [];

    const result: Array<{angleName: string; angleConfig: AngleConfig; speakerProfile: SpeakerProfile}> = [];

    // Find all speaker:angle keys for this speaker
    for (const [key, profile] of Object.entries(profiles.speakers)) {
      if (!key.includes(':')) continue; // Skip legacy format

      const [speakerName, angleName] = key.split(':');
      if (speakerName !== speaker) continue; // Not this speaker

      const angleConfig = profiles.angles[angleName];
      if (!angleConfig) continue; // Angle doesn't exist

      result.push({
        angleName,
        angleConfig,
        speakerProfile: profile,
      });
    }

    return result;
  }

  function emitShot(endFrame: number, sourceTime: number): CameraShot {
    // Get available angles for this speaker first to determine which angle we're on
    const speakerAngles = shotSpeaker ? getSpeakerAngles(shotSpeaker) : [];
    const hasMultipleAngles = speakerAngles.length > 1;

    // Determine which angle to use based on cycle position
    let selectedAngle = speakerAngles[0];
    if (hasMultipleAngles && speakerAngles.length > 0) {
      // Cycle through angles: closeup angle N, wide angle N, closeup angle N+1, wide angle N+1, etc.
      // shotAngleIndex tracks our position in the cycle
      const angleIdx = Math.floor(shotAngleIndex / 2) % speakerAngles.length;
      selectedAngle = speakerAngles[angleIdx];
    }

    const angleName = selectedAngle?.angleName;
    // Now get the speaker profile with the specific angleName to avoid cross-angle matching
    const speakerProfile = shotSpeaker ? getSpeakerProfile(profiles, shotSpeaker, angleName) : undefined;
    const angleConfig = angleName ? profiles.angles?.[angleName] : undefined;

    // For wide shots in multi-angle setups, use the selected angle's video
    const videoSrc = angleConfig?.videoSrc ?? firstAngleVideoSrc;

    // Select viewport based on shot type and time-keyed viewports if available
    let viewport: CropViewport;
    if (shotType === 'closeup' && speakerProfile) {
      // Use time-keyed closeup viewport if available, otherwise use default
      viewport = selectViewportForTime(
        sourceTime,
        speakerProfile.closeupViewportsByTime,
        speakerProfile.closeupViewport
      );
    } else {
      // Wide shot - use time-keyed wide viewport if available
      viewport = selectViewportForTime(
        sourceTime,
        angleConfig?.wideViewportsByTime,
        angleConfig?.wideViewport ?? profiles.wideViewport
      );
    }

    const shot = { startFrame: shotStart, endFrame, viewport, videoSrc, sourceTime };
    console.log(`[CameraDebug] EMIT shot ${shotStart}-${endFrame} type=${shotType} speaker=${shotSpeaker} angle=${angleName}`);
    return shot;
  }

  // ── Pacing logic (shared between both passes) ────────────────────────────────

  function applyPacing(segStart: number, segDur: number, profile: SpeakerProfile | undefined, speaker: string, segId?: number): void {
    const isEarlySeg = segId === 9 || segId === 10 || segId === 11 || segId === 600 || segId === 608;
    if (shotType === 'wide') {
      // At segment start with a speaker who has a profile, immediately cut to closeup
      const speakerAtStart = segStart === shotStart && profile && speaker;
      if (isEarlySeg) console.log(`[CameraDebug] seg=${segId} start=${segStart} shotStart=${shotStart} speaker=${speaker} profile=${!!profile} speakerAtStart=${speakerAtStart} framesInShot=${framesInShot} MIN_WIDE_F=${MIN_WIDE_F}`);
      if (speakerAtStart || (framesInShot >= MIN_WIDE_F && profile)) {
        if (segStart > shotStart) {
          if (isEarlySeg) console.log(`[CameraDebug] Emitting wide shot at ${shotStart} to ${segStart}`);
          shots.push(emitShot(segStart, currentSourceTime));
        } else if (speakerAtStart && isEarlySeg) {
          console.log(`[CameraDebug] At segment start - transitioning ${speaker} to closeup immediately`);
        }
        shotStart = segStart;
        shotType  = 'closeup';
        if (shotSpeaker === speaker) { shotAngleIndex++; }
        else { shotSpeaker = speaker; shotAngleIndex = 0; }
        framesInShot  = 0;
        totalCloseupF = 0;
        console.log(`[CameraDebug] -> closeup speaker=${shotSpeaker} shotStart=${shotStart}`);
      }
      framesInShot += segDur;
    } else {
      const forceWide     = framesInShot >= MAX_CLOSEUP_F || totalCloseupF >= PERIODIC_F;
      const speakerChange = !!profile && speaker !== shotSpeaker;

      if (forceWide || !profile) {
        if (segStart > shotStart) shots.push(emitShot(segStart, currentSourceTime));
        const prevSpeaker = shotSpeaker;
        shotStart     = segStart;
        framesInShot  = segDur;
        totalCloseupF = 0;
        const reaction = isShortForm ? getReactionInfo(speaker) : undefined;
        if (reaction) {
          shotType      = 'closeup';
          shotSpeaker   = reaction.speaker;
          shotAngleIndex = 0;
        } else {
          shotType      = 'wide';
          if (!profile) shotSpeaker = '';
          if (profile && shotSpeaker === prevSpeaker) { shotAngleIndex++; }
          else if (shotSpeaker !== prevSpeaker) { shotAngleIndex = 0; }
        }
      } else if (speakerChange) {
        if (isEarlySeg) console.log(`[CameraDebug] speakerChange seg=${segId} ${shotSpeaker}->${speaker} framesInShot=${framesInShot} fps=${fps} shotStart=${shotStart} segStart=${segStart}`);
        // Always cut to the new speaker immediately at segment boundaries — delaying the cut
        // causes subsequent segments to be incorrectly covered by the old speaker's closeup
        // since shotSpeaker is never updated while the cut is "pending".
        if (segStart > shotStart) {
          if (isEarlySeg) console.log(`[CameraDebug] Emitting shot on speaker change`);
          shots.push(emitShot(segStart, currentSourceTime));
        }
        shotStart      = segStart;
        shotSpeaker    = speaker;
        shotAngleIndex = 0;
        framesInShot   = segDur;
        totalCloseupF += segDur;
      } else {
        framesInShot  += segDur;
        totalCloseupF += segDur;
      }
    }
  }

  // ── Pass 1: Hook section shots (frames 0..hookTotalFrames) ────────────────────
  // Process only hook segments, using cumulative hook-output frames.
  for (const seg of hookSegs) {

    const next = hookSegs.find((cand) => cand.start > seg.start);
    const nextHookStart = next ? (next.hookFrom ?? next.start) : undefined;
    const segDur   = Math.round(getOutputDuration(seg, nextHookStart) * fps);
    const segStart = cumFrame;
    cumFrame += segDur;

    const segSpeakerAngles = seg.speaker ? getSpeakerAngles(seg.speaker) : [];
    const profile = getSpeakerProfile(profiles, seg.speaker, segSpeakerAngles[0]?.angleName);
    currentSourceTime = seg.hookFrom ?? seg.start;

    applyPacing(segStart, segDur, profile, seg.speaker, seg.id);
  }

  // Close final hook shot, then reset state for the main video pass.
  if (hookTotalFrames > shotStart) {
    const lastHookSeg = hookSegs[hookSegs.length - 1];
    shots.push(emitShot(hookTotalFrames, lastHookSeg ? (lastHookSeg.hookFrom ?? lastHookSeg.start) : 0));
  }

  // ── Pass 2: Main video shots (frames hookTotalFrames..end) ────────────────────
  // Process ALL non-cut segments (hook and non-hook) in source-time order.
  // Including hook segments here is critical: their source time ranges play in the
  // main video too (they are not cut out), so speaker changes within hook segments
  // (e.g. Victoria → Inch at segment 611) must drive the main-video camera.

  shotType      = 'wide';
  shotStart     = hookTotalFrames;
  shotSpeaker   = '';
  shotAngleIndex = 0;
  framesInShot  = 0;
  totalCloseupF = 0;

  // Exclude hook segments whose source time is before the main video starts — they don't
  // appear in the main content timeline and would all map to segStart=hookTotalFrames,
  // pile-driving the initial camera state before the first real main segment is processed.
  const mainVideoStartSec = mainSections.length > 0 ? mainSections[0].trimBefore / fps : 0;
  const allActiveSegs = activeSegments.filter(s => !s.cut && (!s.hook || s.start >= mainVideoStartSec));

  for (const seg of allActiveSegs) {
    const sourceFrame = sourceToOutputFrame(seg.start, mainSections, fps);
    const segStart = hookTotalFrames + sourceFrame;
    console.log(`[CameraDebug] seg ${seg.id} source=${seg.start}s -> frame=${sourceFrame} output=${segStart}`);
    const nextSeg  = allActiveSegs.find(s => s.start > seg.start);
    const segOutputEnd = nextSeg
      ? hookTotalFrames + sourceToOutputFrame(nextSeg.start, mainSections, fps)
      : hookTotalFrames + mainTotalFrames;
    const segDur = Math.max(1, segOutputEnd - segStart);

    const segSpeakerAngles = seg.speaker ? getSpeakerAngles(seg.speaker) : [];
    const profile = getSpeakerProfile(profiles, seg.speaker, segSpeakerAngles[0]?.angleName);
    currentSourceTime = seg.hook ? (seg.hookFrom ?? seg.start) : seg.start;

    applyPacing(segStart, segDur, profile, seg.speaker, seg.id);
  }

  // Close the final main-video shot.
  const totalOutputFrames = hookTotalFrames + mainTotalFrames;
  if (totalOutputFrames > shotStart) {
    const lastActiveSeg = allActiveSegs[allActiveSegs.length - 1];
    const finalSourceTime = lastActiveSeg
      ? (lastActiveSeg.hook ? (lastActiveSeg.hookFrom ?? lastActiveSeg.start) : lastActiveSeg.start)
      : 0;
    shots.push(emitShot(totalOutputFrames, finalSourceTime));
  }

  // Log final shot list for debugging
  console.log('[CameraDebug] Final shots (first 10):');
  shots.slice(0, 10).forEach((shot, i) => {
    const startTime = (shot.startFrame / fps).toFixed(2);
    const endTime = (shot.endFrame / fps).toFixed(2);
    console.log(`  Shot ${i}: ${startTime}s-${endTime}s frame=${shot.startFrame}-${shot.endFrame}`);
  });

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
      // For camera cues, get speaker profile (without angle restriction since cues specify shot explicitly)
      const cueSpeakerProfile = cue.speaker ? getSpeakerProfile(profiles, cue.speaker) : undefined;
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
        // Use hookFrom/hookTo bounds for bounded hooks, not seg.start/seg.end
        const hookStart = seg.hookFrom ?? seg.start;
        const hookEnd = seg.hookTo ?? seg.end;
        const sourceOffset = Math.min(Math.max(0, cue.at - hookStart), hookEnd - hookStart);
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
  isShortForm?: boolean;
};

export const CameraPlayer: React.FC<Props> = ({ src, hookSections, mainSections, mainOffset = 0, segments, profiles, isShortForm = false }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const srcW = profiles.sourceWidth;
  const srcH = profiles.sourceHeight;
  const outW = profiles.outputWidth;
  const outH = profiles.outputHeight;

  // Total hook duration in output frames — must match SegmentPlayer's hookDuration exactly
  // so the mainOffset shift boundary aligns with where main content actually starts playing.
  const hookOutputFrames = useMemo(
    () => hookSections.reduce((sum, s) => sum + s.trimAfter - s.trimBefore, 0),
    [hookSections],
  );

  // Build shot timeline once, then splice in any explicit > CAM overrides.
  // If mainOffset > 0, shift every main-content shot forward by mainOffset so
  // the composition-frame lookup stays in sync with the actual playback position.
  const shots = useMemo(() => {
    const pacing    = buildCameraShots(segments, profiles, fps, mainSections, hookSections, isShortForm);
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
  }, [segments, profiles, fps, hookSections, mainSections, hookOutputFrames, mainOffset, isShortForm]);

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
