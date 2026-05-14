/**
 * Unit tests for remotion/lib/hookTiming.ts
 *
 * All functions are pure (no I/O, no Remotion hooks) so tests run in the node
 * Jest environment.
 */

import {
  hookClipEnd,
  getHookSubClips,
  buildHookSections,
  HOOK_TAIL_PAD_UNBOUNDED_SECONDS,
  HOOK_TAIL_PAD_BOUNDED_SECONDS,
  HOOK_BRIDGE_MAX_GAP_SECONDS,
} from './hookTiming';
import type { Segment } from '../types/transcript';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: 1,
    start: 10,
    end: 15,
    speaker: 'Natasha',
    text: 'hello world',
    cut: false,
    tokens: [],
    cuts: [],
    graphics: [],
    hook: true,
    ...overrides,
  };
}

function makeToken(text: string, t_dtw: number, t_end?: number) {
  return { text, t_dtw, t_end, cut: false };
}

// ── hookClipEnd ───────────────────────────────────────────────────────────────

describe('hookClipEnd', () => {
  describe('unbounded hook (no hookTo)', () => {
    it('returns end + HOOK_TAIL_PAD_UNBOUNDED_SECONDS when no spoken tokens', () => {
      const seg = makeSegment({ start: 10, end: 15, tokens: [] });
      expect(hookClipEnd(seg)).toBeCloseTo(15 + HOOK_TAIL_PAD_UNBOUNDED_SECONDS);
    });

    it('uses t_end of last spoken token when t_end is past baseEnd', () => {
      const seg = makeSegment({
        start: 10,
        end: 15,
        tokens: [
          makeToken(' hello', 12, 13.5),
          makeToken(' world', 14, 15.8),  // t_end drifts past end
        ],
      });
      const result = hookClipEnd(seg);
      // sourceEnd extended to 15.8, then + HOOK_TAIL_PAD_UNBOUNDED_SECONDS
      expect(result).toBeCloseTo(15.8 + HOOK_TAIL_PAD_UNBOUNDED_SECONDS);
    });

    it('caps t_end extension at nextHookStart', () => {
      const seg = makeSegment({
        start: 10,
        end: 15,
        tokens: [
          makeToken(' world', 14, 17.0),  // t_end way past end
        ],
      });
      const result = hookClipEnd(seg, 16.0); // next hook starts at 16
      // t_end capped at nextHookStart=16, then pad, then capped again
      expect(result).toBeCloseTo(16.0);
    });

    it('bridges to next hook when gap is small and segment ends at tail', () => {
      const seg = makeSegment({
        start: 10,
        end: 15,
        tokens: [makeToken(' hello', 12)],  // no t_end, no token after 15
      });
      // gap = 15.5 - 15 = 0.5 s, within HOOK_BRIDGE_MAX_GAP_SECONDS
      const result = hookClipEnd(seg, 15.5);
      // bridges to 15.5, then + pad, then capped at 15.5
      expect(result).toBeCloseTo(15.5);
    });

    it('does not bridge when gap exceeds HOOK_BRIDGE_MAX_GAP_SECONDS', () => {
      const seg = makeSegment({
        start: 10,
        end: 15,
        tokens: [makeToken(' hello', 12)],
      });
      const nextHookStart = 15 + HOOK_BRIDGE_MAX_GAP_SECONDS + 0.1;
      const result = hookClipEnd(seg, nextHookStart);
      // no bridge; just pad, no cap needed since pad < gap
      expect(result).toBeCloseTo(15 + HOOK_TAIL_PAD_UNBOUNDED_SECONDS);
    });

    it('does not bridge when spoken tokens exist after sourceEnd', () => {
      const seg = makeSegment({
        start: 10,
        end: 15,
        tokens: [
          makeToken(' hello', 12),
          makeToken(' world', 15.5),  // token after sourceEnd → not at tail
        ],
      });
      const result = hookClipEnd(seg, 15.6);
      // hasSpokenTokenAfterEnd = true → endsAtSegmentTail = false → no bridge
      expect(result).toBeCloseTo(15 + HOOK_TAIL_PAD_UNBOUNDED_SECONDS);
    });
  });

  describe('bounded hook (hookTo set)', () => {
    it('returns hookTo + HOOK_TAIL_PAD_BOUNDED_SECONDS for a simple bounded hook', () => {
      const seg = makeSegment({ start: 10, end: 15, hookFrom: 11, hookTo: 13, tokens: [] });
      expect(hookClipEnd(seg)).toBeCloseTo(13 + HOOK_TAIL_PAD_BOUNDED_SECONDS);
    });

    it('extends bounded hook to cover last spoken token t_end within window', () => {
      const seg = makeSegment({
        start: 10,
        end: 15,
        hookFrom: 11,
        hookTo: 13,
        tokens: [
          makeToken(' hello', 12, 13.4),  // t_end = 13.4 > hookTo = 13
        ],
      });
      const result = hookClipEnd(seg);
      expect(result).toBeCloseTo(13.4 + HOOK_TAIL_PAD_BOUNDED_SECONDS);
    });

    it('ignores tokens outside the hook window', () => {
      const seg = makeSegment({
        start: 10,
        end: 15,
        hookFrom: 11,
        hookTo: 13,
        tokens: [
          makeToken(' early', 9),     // before hookFrom
          makeToken(' late', 14),     // after hookTo (outside hook window)
        ],
      });
      // No tokens in [hookFrom=11, hookTo=13] range, so no t_end extension
      const result = hookClipEnd(seg);
      expect(result).toBeCloseTo(13 + HOOK_TAIL_PAD_BOUNDED_SECONDS);
    });

    it('caps result at nextHookStart', () => {
      const seg = makeSegment({
        start: 10,
        end: 15,
        hookFrom: 11,
        hookTo: 13,
        tokens: [makeToken(' hi', 12, 13.5)],
      });
      const result = hookClipEnd(seg, 13.3);
      // After extension: 13.5, after pad: 13.52, after cap: 13.3
      expect(result).toBeCloseTo(13.3);
    });
  });

  describe('special token filtering', () => {
    it('ignores Whisper marker tokens (_MUSIC_, etc.)', () => {
      const seg = makeSegment({
        start: 10,
        end: 15,
        tokens: [
          { text: ' _MUSIC_', t_dtw: 14, t_end: 20.0, cut: false },
        ],
      });
      // _MUSIC_ is not a spoken token, so no t_end extension
      const result = hookClipEnd(seg);
      expect(result).toBeCloseTo(15 + HOOK_TAIL_PAD_UNBOUNDED_SECONDS);
    });

    it('ignores empty tokens', () => {
      const seg = makeSegment({
        start: 10,
        end: 15,
        tokens: [
          { text: '', t_dtw: 14, t_end: 20.0, cut: false },
          { text: '   ', t_dtw: 14.5, t_end: 20.0, cut: false },
        ],
      });
      const result = hookClipEnd(seg);
      expect(result).toBeCloseTo(15 + HOOK_TAIL_PAD_UNBOUNDED_SECONDS);
    });
  });
});

// ── getHookSubClips ────────────────────────────────────────────────────────────

describe('getHookSubClips', () => {
  it('returns a single SubClip for an unbounded hook', () => {
    const seg = makeSegment({ start: 10, end: 15, tokens: [] });
    const clips = getHookSubClips(seg);
    expect(clips).toHaveLength(1);
    expect(clips[0].sourceStart).toBe(10);
    expect(clips[0].sourceEnd).toBeCloseTo(15 + HOOK_TAIL_PAD_UNBOUNDED_SECONDS);
  });

  it('uses hookFrom as sourceStart when defined', () => {
    const seg = makeSegment({ start: 10, end: 15, hookFrom: 12, tokens: [] });
    const clips = getHookSubClips(seg);
    expect(clips[0].sourceStart).toBe(12);
  });

  it('uses hookTo as clip base end for a bounded hook', () => {
    const seg = makeSegment({ start: 10, end: 15, hookFrom: 11, hookTo: 13, tokens: [] });
    const clips = getHookSubClips(seg);
    expect(clips[0].sourceStart).toBe(11);
    expect(clips[0].sourceEnd).toBeCloseTo(13 + HOOK_TAIL_PAD_BOUNDED_SECONDS);
  });

  it('returns sourceEnd < nextHookStart when capped', () => {
    const seg = makeSegment({ start: 10, end: 15, tokens: [] });
    const clips = getHookSubClips(seg, 15.1);
    expect(clips[0].sourceEnd).toBeCloseTo(15.1);
  });
});

// ── buildHookSections ──────────────────────────────────────────────────────────

describe('buildHookSections', () => {
  const FPS = 60;

  it('returns empty array for no hook segments', () => {
    expect(buildHookSections([], FPS)).toEqual([]);
  });

  it('converts a single hook to a section', () => {
    const seg = makeSegment({ start: 10, end: 15, tokens: [] });
    const sections = buildHookSections([seg], FPS);
    expect(sections).toHaveLength(1);
    expect(sections[0].trimBefore).toBe(Math.floor(10 * FPS));
    const expectedEnd = 15 + HOOK_TAIL_PAD_UNBOUNDED_SECONDS;
    expect(sections[0].trimAfter).toBe(Math.ceil(expectedEnd * FPS));
  });

  it('passes nextHookStart to successive hooks', () => {
    const seg1 = makeSegment({ id: 1, start: 5, end: 10, tokens: [] });
    const seg2 = makeSegment({ id: 2, start: 20, end: 25, tokens: [] });
    const sections = buildHookSections([seg1, seg2], FPS);
    expect(sections).toHaveLength(2);
    // seg1 should be capped at seg2.start (20)
    expect(sections[0].trimAfter).toBeLessThanOrEqual(Math.ceil(20 * FPS));
  });

  it('de-overlaps adjacent sections when t_end causes overlap', () => {
    // Token t_end causes seg1 sourceEnd to extend past seg2's start
    const seg1 = makeSegment({
      id: 1,
      start: 5,
      end: 10,
      tokens: [makeToken(' hi', 9, 12.0)], // t_end would push into seg2 window
    });
    const seg2 = makeSegment({ id: 2, start: 11, end: 16, tokens: [] });
    const sections = buildHookSections([seg1, seg2], FPS);
    // Even if there's overlap in raw sections, de-overlap pass fixes it
    if (sections.length >= 2) {
      expect(sections[1].trimBefore).toBeGreaterThanOrEqual(sections[0].trimAfter);
    }
  });

  it('section trimAfter is always at least trimBefore + 1', () => {
    const seg = makeSegment({ start: 10, end: 10.0001, tokens: [] });
    const sections = buildHookSections([seg], FPS);
    for (const s of sections) {
      expect(s.trimAfter).toBeGreaterThan(s.trimBefore);
    }
  });
});
