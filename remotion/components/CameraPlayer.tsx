import React, { useMemo } from 'react';
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { SegmentPlayer, getEffectiveDuration, Section } from './SegmentPlayer';
import { hookClipEnd } from '../lib/hookTiming';
import type { Segment } from '../types/transcript';
import type { CameraProfiles, CameraShot, CropViewport, AngleConfig, SpeakerProfile, HookTransition } from '../types/camera';

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

// ── Hook transition animation ─────────────────────────────────────────────────

/**
 * Zoom range for hook transitions.
 * 0.08 = 8% — the viewport tightens by 8% over the clip duration, giving a
 * clearly readable push-in that reads as intentional motion without feeling
 * rushed or disorienting on a 3–10 s hook clip.
 */
const HOOK_ZOOM_RANGE = 0.08;

/**
 * Minimum shot duration (seconds) for a slow-zoom-in to be applied.
 * Clips shorter than this are too brief for the motion to be perceptible.
 */
const HOOK_ZOOM_MIN_S = 1.5;

/**
 * Minimum gap (seconds of hook timeline) that must elapse after a zoomed shot
 * before the next zoom is allowed. Prevents consecutive zooms on back-to-back
 * clips, which reads as mechanical repetition rather than intentional motion.
 */
const HOOK_ZOOM_SPACING_S = 3.0;

/**
 * Return an animated version of `vp` for the given progress through a hook shot.
 *
 * @param vp         - The base closeup viewport (static centre + size).
 * @param transition - Which animation style to apply.
 * @param progress   - Normalised time within the shot [0, 1].
 */
function animateHookViewport(
  vp: CropViewport,
  transition: HookTransition,
  progress: number,
): CropViewport {
  switch (transition) {
    case 'slowZoomIn': {
      // Starts at the BASE closeup ("normal position") and slowly zooms in
      // to a slightly tighter view over the clip duration.
      //   progress=0 → w/h = vp.w / vp.h  (exactly the base closeup, no offset, no gap)
      //   progress=1 → w/h * (1 − ZOOM_RANGE)  (8% tighter)
      //
      // Because w and h only ever decrease, scale only ever increases — the viewport
      // can never extend beyond the source boundaries, so no edge gaps are possible
      // regardless of where cx/cy sits in the frame.
      const factor = 1 - HOOK_ZOOM_RANGE * progress;
      return { ...vp, w: vp.w * factor, h: vp.h * factor };
    }

    case 'slowZoomOut': {
      // Starts at the base closeup and gently pulls back (reserved for future use).
      // NOTE: expanding the viewport can create edge gaps if cx/cy is near a boundary.
      // Clamp w/h at 1.0 as a minimum safety guard.
      const factor = 1 + HOOK_ZOOM_RANGE * progress;
      return {
        ...vp,
        w: Math.min(vp.w * factor, 1),
        h: Math.min(vp.h * factor, 1),
      };
    }

    default:
      return vp;
  }
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
  // Search for any key that starts with "speaker:" — case-insensitive so
  // > CAM victoria matches a profile keyed as "Victoria"
  const speakerLower = speaker.toLowerCase();
  for (const key of Object.keys(profiles.speakers)) {
    const keyLower = key.toLowerCase();
    if (keyLower === speakerLower || keyLower.startsWith(`${speakerLower}:`)) {
      return profiles.speakers[key];
    }
  }
  return undefined;
}


/**
 * The duration a segment contributes to the output timeline.
 * For hook segments this is the hook clip window (via shared hookClipEnd),
 * not the full segment duration. Must match the clip length that buildSections
 * emits for the same segment.
 */
function getOutputDuration(seg: Segment, nextHookStart?: number): number {
  if (seg.hook) {
    const sourceStart = seg.hookFrom ?? seg.start;
    const sourceEnd = hookClipEnd(seg, nextHookStart);
    return sourceEnd - sourceStart;
  }
  return getEffectiveDuration(seg);
}

// ── Cutaway constants ──────────────────────────────────────────────────────────

/**
 * After this many seconds of continuous same-speaker content, insert a brief
 * cutaway to a non-speaking speaker's closeup or the full wide group shot.
 */
const CUTAWAY_INTERVAL_S = 20.0;

/** How long each cutaway shot lasts in seconds. */
const CUTAWAY_DURATION_S = 3.0;

/**
 * Angle name used for the "full group" wide shot in the cutaway pool.
 * This angle should cover all speakers (e.g. the overhead or wide cam).
 */
const CUTAWAY_WIDE_ANGLE = 'angle3';

// ── Cutaway helpers ───────────────────────────────────────────────────────────

type CutawayTarget = {
  viewport: CropViewport;
  videoSrc?: string;
  /** Human-readable label for debug logging (e.g. "Saloni:angle2", "wide:angle3"). */
  label: string;
};

/**
 * Build the ordered cutaway pool for a given speaking speaker.
 * Pool = one closeup per other enabled speaker (first enabled angle found),
 *        followed by a wide shot of CUTAWAY_WIDE_ANGLE.
 *
 * The pool is cycled globally (poolIdx never resets per-speaker) so successive
 * cutaways within the same long monologue hit different people.
 */
function buildCutawayPool(speakingSpeaker: string, profiles: CameraProfiles): CutawayTarget[] {
  const pool: CutawayTarget[] = [];
  const seenSpeakers = new Set<string>();

  for (const [key, profile] of Object.entries(profiles.speakers)) {
    if (profile.enabled === false) continue;
    const speakerName = key.split(':')[0];
    if (speakerName === speakingSpeaker) continue;
    if (seenSpeakers.has(speakerName)) continue;

    const angleName = profile.angleName;
    if (!angleName) continue;
    const angleConfig = profiles.angles?.[angleName];
    if (!angleConfig || angleConfig.enabled === false) continue;

    seenSpeakers.add(speakerName);
    pool.push({
      viewport: profile.closeupViewport,
      videoSrc: angleConfig.videoSrc,
      label: `${speakerName}:${angleName}`,
    });
  }

  // Wide group shot at the end of each pool cycle.
  const wideAngle = profiles.angles?.[CUTAWAY_WIDE_ANGLE];
  if (wideAngle) {
    pool.push({
      viewport: wideAngle.wideViewport ?? profiles.wideViewport,
      videoSrc: wideAngle.videoSrc,
      label: `wide:${CUTAWAY_WIDE_ANGLE}`,
    });
  }

  return pool;
}

/**
 * Post-processing pass: insert brief cutaway shots into the pacing-algorithm
 * shot list so that long runs of the same speaker are broken up with glimpses
 * of non-speaking participants or a wide group angle.
 *
 * Rules:
 * - Hook shots (endFrame ≤ hookTotalFrames) are never interrupted.
 * - Wide shots on the same speaker count toward the interval timer but are
 *   not themselves replaced (no back-to-back wides).
 * - Skipped entirely in short-form compositions.
 * - A cutaway splits the host closeup shot: cutaway occupies the first
 *   CUTAWAY_DURATION_S frames, the remainder goes back to the main speaker.
 */
function insertCutaways(
  shots: CameraShot[],
  profiles: CameraProfiles,
  fps: number,
  hookTotalFrames: number,
): CameraShot[] {
  const INTERVAL_F = Math.round(CUTAWAY_INTERVAL_S * fps);
  const CUTAWAY_F  = Math.round(CUTAWAY_DURATION_S * fps);
  if (INTERVAL_F === 0 || CUTAWAY_F === 0) return shots;

  const result: CameraShot[] = [];
  let sameSpeakerF  = 0;
  let activeSpeaker: string | undefined;
  let pool: CutawayTarget[] = [];
  let poolIdx = 0;   // global counter; never resets so variety cycles across speakers

  for (const shot of shots) {
    const shotDur = shot.endFrame - shot.startFrame;

    // Hook shots: always pass through unchanged — hooks have their own pacing.
    if (shot.endFrame <= hookTotalFrames) {
      result.push(shot);
      continue;
    }

    const speaker = shot.speaker;

    // Speaker changed → reset same-speaker timer and rebuild the cutaway pool.
    if (speaker !== activeSpeaker) {
      activeSpeaker = speaker;
      sameSpeakerF  = 0;
      pool = speaker ? buildCutawayPool(speaker, profiles) : [];
    }

    // No speaker or no other speakers to cut to → pass through unchanged.
    if (!speaker || pool.length === 0) {
      sameSpeakerF += shotDur;
      result.push(shot);
      continue;
    }

    // Wide shots on the same speaker count toward the timer but are never split.
    if (shot.isWide) {
      sameSpeakerF += shotDur;
      result.push(shot);
      continue;
    }

    // Cutaway is due — insert one now.
    if (sameSpeakerF >= INTERVAL_F) {
      const target = pool[poolIdx % pool.length];
      poolIdx++;

      const cutDur = Math.min(CUTAWAY_F, shotDur);

      console.log(`[CameraDebug] CUTAWAY ${shot.startFrame}-${shot.startFrame + cutDur} → ${target.label}`);

      // Cutaway shot (non-speaking speaker or wide group).
      result.push({
        startFrame: shot.startFrame,
        endFrame:   shot.startFrame + cutDur,
        viewport:   target.viewport,
        videoSrc:   target.videoSrc,
        sourceTime: shot.sourceTime,
        speaker:    target.label,
        isWide:     target.label.startsWith('wide:'),
      });

      // Remainder of the original main-speaker shot (may be zero if cutDur === shotDur).
      if (cutDur < shotDur) {
        result.push({ ...shot, startFrame: shot.startFrame + cutDur });
      }

      // Timer resets to the remainder duration so the next cutaway fires
      // only after another full INTERVAL of same-speaker content.
      sameSpeakerF = shotDur - cutDur;
    } else {
      sameSpeakerF += shotDur;
      result.push(shot);
    }
  }

  return result;
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
      if (angleConfig.enabled === false) continue; // Angle disabled globally
      if (profile.enabled === false) continue; // Speaker+angle disabled

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

    const shot = {
      startFrame: shotStart,
      endFrame,
      viewport,
      videoSrc,
      sourceTime,
      speaker: shotSpeaker || undefined,
      isWide:  shotType === 'wide',
    };
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

      // speakerChange takes priority over forceWide so explicit speaker transitions
      // (SPEAKER: overrides, natural turns) are always honoured even mid-periodic-cut.
      if (speakerChange) {
        if (isEarlySeg) console.log(`[CameraDebug] speakerChange seg=${segId} ${shotSpeaker}->${speaker} framesInShot=${framesInShot} fps=${fps} shotStart=${shotStart} segStart=${segStart}`);
        if (segStart > shotStart) {
          if (isEarlySeg) console.log(`[CameraDebug] Emitting shot on speaker change`);
          shots.push(emitShot(segStart, currentSourceTime));
        }
        shotStart      = segStart;
        shotSpeaker    = speaker;
        shotAngleIndex = 0;
        framesInShot   = segDur;
        // Reset the periodic timer when a forced cut was also due, so we don't
        // immediately fire forceWide again on the very next segment.
        totalCloseupF  = forceWide ? segDur : totalCloseupF + segDur;
      } else if (forceWide || !profile) {
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
        } else if (isShortForm) {
          // Never go wide in short-form — stay on closeup, updating speaker if they have a profile
          shotType = 'closeup';
          if (profile) {
            if (shotSpeaker === speaker) { shotAngleIndex++; }
            else { shotSpeaker = speaker; shotAngleIndex = 0; }
          }
        } else {
          shotType      = 'wide';
          if (!profile) shotSpeaker = '';
          if (profile && shotSpeaker === prevSpeaker) { shotAngleIndex++; }
          else if (shotSpeaker !== prevSpeaker) { shotAngleIndex = 0; }
        }
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

    // Force a shot boundary at the start of every hook segment (segStart > 0) so that
    // each hook clip gets its own shot with shotProgress starting at 0 — which is what
    // makes the slow-zoom-in restart fresh for every clip regardless of whether the
    // speaker changed.  applyPacing won't double-emit here because after we update
    // shotStart it sees segStart === shotStart and skips its own emit.
    if (segStart > shotStart) {
      shots.push(emitShot(segStart, currentSourceTime));
      shotStart = segStart;
    }

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

  // For short-form, never start the main pass with a wide shot — initialize directly to
  // the first speaker's closeup so the gap between hookTotalFrames and the first segment
  // (inter-segment silence) doesn't produce a wide-angle frame.
  if (isShortForm && allActiveSegs.length > 0) {
    const firstMainSeg = allActiveSegs.find(s => !s.hook) ?? allActiveSegs[0];
    if (firstMainSeg.speaker) {
      shotType    = 'closeup';
      shotSpeaker = firstMainSeg.speaker;
    }
  }

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

  // ── Tag qualifying hook shots with spaced slow zoom-ins ─────────────────────
  //
  // Not every hook shot gets a zoom — applying it to every clip (especially short
  // ones) reads as mechanical repetition and the effect is invisible on < 1.5 s
  // clips anyway. Instead, only assign slowZoomIn when:
  //   1. The shot is at least HOOK_ZOOM_MIN_S long (effect is perceptible), AND
  //   2. At least HOOK_ZOOM_SPACING_S of hook time has elapsed since the last zoom
  //      (prevents back-to-back zooms from feeling like a stuck record).
  {
    let lastZoomEndFrame = -Infinity;
    for (const shot of shots) {
      if (shot.startFrame >= hookTotalFrames) break;
      const durationS = (shot.endFrame - shot.startFrame) / fps;
      const gapS      = (shot.startFrame - lastZoomEndFrame) / fps;
      if (durationS >= HOOK_ZOOM_MIN_S && gapS >= HOOK_ZOOM_SPACING_S) {
        shot.hookTransition = 'slowZoomIn';
        lastZoomEndFrame = shot.endFrame;
      }
    }
  }

  // ── Insert cutaway shots for visual variety (main content only) ──────────────
  // Short-form has its own pacing conventions; skip cutaways there.
  const finalShots = isShortForm
    ? shots
    : insertCutaways(shots, profiles, fps, hookTotalFrames);

  // Log final shot list for debugging
  console.log('[CameraDebug] Final shots (first 10):');
  finalShots.slice(0, 10).forEach((shot, i) => {
    const startTime = (shot.startFrame / fps).toFixed(2);
    const endTime = (shot.endFrame / fps).toFixed(2);
    console.log(`  Shot ${i}: ${startTime}s-${endTime}s frame=${shot.startFrame}-${shot.endFrame}`);
  });

  return finalShots;
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
      // Spread `shot` so all fields (including hookTransition) are preserved on both halves.
      result.splice(idx, 1,
        { ...shot, endFrame: F },
        { ...shot, startFrame: F, viewport, ...(videoSrc !== undefined ? { videoSrc } : {}) },
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
  const { fps, width: canvasW, height: canvasH } = useVideoConfig();

  const srcW = profiles.sourceWidth;
  const srcH = profiles.sourceHeight;
  // Use the actual Remotion canvas dimensions for the transform, not profiles.outputWidth/Height.
  // profiles.outputWidth/Height reflects the source resolution (e.g. 4K), but the render canvas
  // may differ (calculateMetadata always returns 1920×1080). Using the wrong value shifts the
  // transform-origin away from the canvas centre, producing incorrect pan/zoom.
  const outW = canvasW;
  const outH = canvasH;

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
        // Spans the boundary — split into hook portion (unchanged, hookTransition preserved)
        // and main portion (shifted; hookTransition intentionally dropped — it is a main shot).
        result.push({ ...shot, endFrame: hookOutputFrames });
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

  // Animated viewport for hook shots that have a hookTransition assigned.
  // progress is clamped to [0, 1] so the first/last frame never overshoots.
  const shotDuration = (currentShot?.endFrame ?? 0) - (currentShot?.startFrame ?? 0);
  const shotProgress = shotDuration > 0
    ? Math.min(Math.max((frame - (currentShot?.startFrame ?? 0)) / shotDuration, 0), 1)
    : 0;
  const animatedViewport = currentShot?.hookTransition
    ? animateHookViewport(viewport, currentShot.hookTransition, shotProgress)
    : viewport;

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
        const { scale, tx, ty } = computeTransform(animatedViewport, dims.srcW, dims.srcH, outW, outH);
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
