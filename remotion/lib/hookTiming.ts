/**
 * Shared hook timing utilities — single source of truth for all hook clip
 * boundary calculations. Previously duplicated across SegmentPlayer, Composition,
 * ShortFormClip, and CameraPlayer with minor divergences.
 *
 * All consumers must import from here; local copies must not exist.
 */

import type { Segment } from '../types/transcript';
import { isSpokenToken } from './tokens';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Extra seconds appended to unbounded hooks (no explicit hookTo). */
export const HOOK_TAIL_PAD_UNBOUNDED_SECONDS = 0.16;

/** Extra seconds appended to bounded hooks (explicit hookTo). */
export const HOOK_TAIL_PAD_BOUNDED_SECONDS = 0.02;

/** Max gap (seconds) between hook end and next hook start for bridging. */
export const HOOK_BRIDGE_MAX_GAP_SECONDS = 1.0;

/** Tolerance (seconds) used to detect whether a spoken token falls past sourceEnd,
 *  determining if the hook ends at the segment tail (bridging eligibility). */
export const SEGMENT_TAIL_EPSILON_SECONDS = 0.02;

// ── Core timing function ──────────────────────────────────────────────────────

/**
 * Returns the effective end time (seconds) for a hook clip.
 *
 * Algorithm (applied in order):
 *  1. Start from `segment.hookTo ?? segment.end`.
 *  2. Extend to cover `t_end` of the last spoken token within the hook window,
 *     capped by `nextHookStart` when provided. This prevents the audio tail of
 *     the final word from being clipped when Whisper places t_end past the
 *     nominal segment boundary.
 *  3. If no spoken token follows `sourceEnd + 0.02` (segment tail), bridge to
 *     `nextHookStart` when the gap is ≤ `HOOK_BRIDGE_MAX_GAP_SECONDS`.
 *  4. Add a tail pad (bounded or unbounded constant).
 *  5. Hard-cap at `nextHookStart` to prevent source windows from overlapping,
 *     which would cause backward jumps in SectionGroupPlayer.
 *
 * @param segment       The hook segment.
 * @param nextHookStart Source start time (seconds) of the following hook
 *                      segment, or undefined if this is the last hook.
 */
export function hookClipEnd(segment: Segment, nextHookStart?: number): number {
  const sourceStart = segment.hookFrom ?? segment.start;
  const baseEnd = segment.hookTo ?? segment.end;
  const isBoundedHook = segment.hookTo !== undefined && segment.hookTo !== null;

  let sourceEnd = baseEnd;

  // Extend to cover the last spoken token's audio tail
  const lastSpokenToken = segment.tokens
    .filter(t => isSpokenToken(t) && t.t_dtw >= sourceStart && t.t_dtw <= baseEnd)
    .sort((a, b) => (b.t_end ?? 0) - (a.t_end ?? 0))[0];

  if (lastSpokenToken?.t_end) {
    const tEnd = nextHookStart !== undefined
      ? Math.min(lastSpokenToken.t_end, nextHookStart)
      : lastSpokenToken.t_end;
    sourceEnd = Math.max(sourceEnd, tEnd);
  }

  // Bridge to the next hook when the gap is small and this hook ends at the segment tail
  const hasSpokenTokenAfterEnd = segment.tokens.some(
    t => isSpokenToken(t) && t.t_dtw > sourceEnd + SEGMENT_TAIL_EPSILON_SECONDS,
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

  // Hard cap: never extend into the next hook's source window
  if (nextHookStart !== undefined) {
    sourceEnd = Math.min(sourceEnd, nextHookStart);
  }

  return sourceEnd;
}

// ── SubClip / Section types ───────────────────────────────────────────────────

export type SubClip = { sourceStart: number; sourceEnd: number };
export type Section = { trimBefore: number; trimAfter: number };

// ── Sub-clip builder ──────────────────────────────────────────────────────────

/**
 * Returns the playable sub-clip(s) for a single hook segment.
 *
 * Hook clips play uninterrupted (no cuts[] applied) so that hook music stays
 * in sync. The clip window is [hookFrom ?? start, hookClipEnd(segment)].
 *
 * Returns a single-element array; the array form keeps the signature
 * compatible with the main-content `getSubClips` pattern.
 */
export function getHookSubClips(segment: Segment, nextHookStart?: number): SubClip[] {
  const sourceStart = segment.hookFrom ?? segment.start;
  const sourceEnd = hookClipEnd(segment, nextHookStart);
  return [{ sourceStart, sourceEnd }];
}

// ── Section builder ───────────────────────────────────────────────────────────

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
 * Converts all hook segments into de-overlapped `Section[]` ready for
 * `SectionGroupPlayer`.
 *
 * De-overlap pass: if a section's `trimBefore` precedes the previous section's
 * `trimAfter` (caused by t_end extension or bridging across overlapping source
 * ranges), advance it to avoid backward jumps.
 */
export function buildHookSections(hookSegments: Segment[], fps: number): Section[] {
  const rawSections = hookSegments
    .flatMap((seg, idx) => {
      const next = hookSegments[idx + 1];
      const nextHookStart = next ? (next.hookFrom ?? next.start) : undefined;
      return toSections(getHookSubClips(seg, nextHookStart), fps);
    });

  // De-overlap
  const sections: Section[] = [];
  for (const s of rawSections) {
    const prev = sections[sections.length - 1];
    const trimBefore = prev ? Math.max(s.trimBefore, prev.trimAfter) : s.trimBefore;
    if (trimBefore < s.trimAfter) {
      sections.push({ trimBefore, trimAfter: s.trimAfter });
    }
  }
  return sections;
}
