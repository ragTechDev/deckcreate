/**
 * Caption timing regression tests for transcript.json hook segments.
 *
 * These tests run against the live transcript.json data and validate the
 * invariants that buildCaptions (HookOverlay.tsx) relies on. They are
 * intentionally written in plain JS so they run under the existing Jest/Babel
 * pipeline without needing to import TypeScript React components.
 *
 * Bugs caught by this suite:
 *   Bug 1 — "relevant" missing: last token t_dtw > sourceEnd → endMs < startMs
 *   Bug 2 — "the the" duplicate: consecutive tokens with identical text+timestamp
 *   Bug 3 — hook phrase not resolved: hookPhrase set but hookFrom/hookTo absent
 */

import fs from 'fs-extra';
import path from 'path';

// ─── Inline caption logic (mirrors HookOverlay.tsx:buildCaptions) ─────────────
// Kept here so the tests exercise the same algorithm without importing TS/React.

function isSpecialToken(t) {
  return /_[A-Z]+_/.test(t.text.trim());
}

function buildWordGroups(tokens) {
  const groups = [];
  for (const t of tokens) {
    if (isSpecialToken(t) || t.text.trim() === '') continue;
    if (t.text.startsWith(' ') || groups.length === 0) {
      groups.push({ text: t.text, t_dtw: t.t_dtw });
    } else {
      groups[groups.length - 1].text += t.text;
    }
  }
  return groups;
}

function dedup(groups) {
  return groups.filter(
    (w, i) => i === 0 || !(w.text === groups[i - 1].text && w.t_dtw === groups[i - 1].t_dtw),
  );
}

function buildCaptions(tokens, sourceStart, sourceEnd) {
  const inRange = dedup(buildWordGroups(tokens)).filter(
    w => w.t_dtw >= sourceStart && w.t_dtw < sourceEnd + 0.5,
  );
  return inRange.map((w, i) => {
    const startMs = Math.round(w.t_dtw * 1000);
    const rawEndMs = Math.round(
      (i + 1 < inRange.length ? inRange[i + 1].t_dtw : sourceEnd) * 1000,
    );
    return { text: w.text, startMs, endMs: Math.max(rawEndMs, startMs + 50) };
  });
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let transcript;

beforeAll(async () => {
  const jsonPath = path.join(process.cwd(), 'public/transcribe/output/edit/transcript.json');
  transcript = await fs.readJson(jsonPath);
});

function hookSegs() {
  return transcript.segments.filter(s => s.hook && !s.cut);
}

// ─── Data-integrity tests ─────────────────────────────────────────────────────

describe('hook segment token integrity', () => {
  test('no consecutive duplicate word groups (same text AND same t_dtw)', () => {
    const violations = [];
    for (const seg of hookSegs()) {
      const groups = buildWordGroups(seg.tokens);
      for (let i = 1; i < groups.length; i++) {
        if (groups[i].text === groups[i - 1].text && groups[i].t_dtw === groups[i - 1].t_dtw) {
          violations.push(
            `seg ${seg.id}: duplicate word group "${groups[i].text}" at t_dtw=${groups[i].t_dtw}`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('no tokens with t_dtw=0 other than [_BEG_] or similar special tokens', () => {
    const violations = [];
    for (const seg of hookSegs()) {
      for (const t of seg.tokens) {
        if (t.t_dtw === 0 && !isSpecialToken(t) && t.text.trim() !== '') {
          violations.push(`seg ${seg.id}: non-special token "${t.text}" has t_dtw=0`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('all hook segments with hookPhrase have hookFrom and hookTo resolved', () => {
    const violations = [];
    for (const seg of hookSegs()) {
      if (seg.hookPhrase) {
        if (seg.hookFrom === undefined || seg.hookFrom === null) {
          violations.push(`seg ${seg.id}: hookPhrase "${seg.hookPhrase}" but hookFrom is missing`);
        }
        if (seg.hookTo === undefined || seg.hookTo === null) {
          violations.push(`seg ${seg.id}: hookPhrase "${seg.hookPhrase}" but hookTo is missing`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('hookFrom < hookTo for all resolved hook phrase segments', () => {
    const violations = [];
    for (const seg of hookSegs()) {
      if (seg.hookFrom !== undefined && seg.hookTo !== undefined) {
        if (seg.hookFrom >= seg.hookTo) {
          violations.push(
            `seg ${seg.id}: hookFrom (${seg.hookFrom}) >= hookTo (${seg.hookTo})`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

// ─── Caption timing tests ─────────────────────────────────────────────────────

describe('buildCaptions timing invariants', () => {
  test('every caption has endMs >= startMs + 50', () => {
    const violations = [];
    for (const seg of hookSegs()) {
      const sourceStart = seg.hookFrom ?? seg.start;
      const sourceEnd   = seg.hookTo   ?? seg.end;
      const caps = buildCaptions(seg.tokens, sourceStart, sourceEnd);
      for (const c of caps) {
        if (c.endMs < c.startMs + 50) {
          violations.push(
            `seg ${seg.id} word "${c.text}": endMs=${c.endMs} < startMs=${c.startMs}+50`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('captions are monotonically increasing in startMs', () => {
    const violations = [];
    for (const seg of hookSegs()) {
      const sourceStart = seg.hookFrom ?? seg.start;
      const sourceEnd   = seg.hookTo   ?? seg.end;
      const caps = buildCaptions(seg.tokens, sourceStart, sourceEnd);
      for (let i = 1; i < caps.length; i++) {
        if (caps[i].startMs < caps[i - 1].startMs) {
          violations.push(
            `seg ${seg.id}: caption "${caps[i].text}" startMs=${caps[i].startMs} comes before "${caps[i - 1].text}" startMs=${caps[i - 1].startMs}`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('no consecutive captions with identical text (duplicate word)', () => {
    const violations = [];
    for (const seg of hookSegs()) {
      const sourceStart = seg.hookFrom ?? seg.start;
      const sourceEnd   = seg.hookTo   ?? seg.end;
      const caps = buildCaptions(seg.tokens, sourceStart, sourceEnd);
      for (let i = 1; i < caps.length; i++) {
        if (caps[i].text.trim().toLowerCase() === caps[i - 1].text.trim().toLowerCase()) {
          violations.push(
            `seg ${seg.id}: consecutive duplicate word "${caps[i].text}"`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('hook clips produce at least one caption word', () => {
    const violations = [];
    for (const seg of hookSegs()) {
      const sourceStart = seg.hookFrom ?? seg.start;
      const sourceEnd   = seg.hookTo   ?? seg.end;
      const caps = buildCaptions(seg.tokens, sourceStart, sourceEnd);
      if (caps.length === 0) {
        violations.push(`seg ${seg.id} (${sourceStart}–${sourceEnd}s): no captions produced`);
      }
    }
    expect(violations).toEqual([]);
  });

  test('all caption words appear somewhere in the full segment text', () => {
    // Uses the full segment text (not just hookPhrase) because the 0.5 s
    // buffer intentionally admits tokens that drift slightly past hookTo, and
    // BPE sub-token concatenation can combine words that both exist in the text.
    // Words like "courseyou" (boundary artefact) are caught by the duplicate-
    // group test above rather than here.
    const violations = [];
    for (const seg of hookSegs()) {
      const sourceStart = seg.hookFrom ?? seg.start;
      const sourceEnd   = seg.hookTo   ?? seg.end;
      const caps = buildCaptions(seg.tokens, sourceStart, sourceEnd);
      const reference = seg.text.toLowerCase().replace(/[^a-z0-9\s]/g, '');
      for (const c of caps) {
        const word = c.text.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
        if (word.length > 1 && !reference.includes(word)) {
          violations.push(
            `seg ${seg.id}: caption word "${c.text.trim()}" not found in segment text`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

// ─── Specific regression tests for known past bugs ───────────────────────────

// Mirrors the hookClipEnd() logic in Composition.tsx / getHookSubClips in SegmentPlayer.tsx.
// Extension only applies to unbounded hooks (no explicit hookTo); phrase-bounded hooks
// play exactly their defined window.
function hookClipEnd(seg) {
  const baseEnd = seg.hookTo ?? seg.end;
  const hasLateToken = (seg.hookTo === undefined || seg.hookTo === null)
    && seg.tokens.some(
      t => t.t_dtw > baseEnd && t.t_dtw < baseEnd + 0.5
        && !/_[A-Z]+_/.test(t.text.trim()) && t.text.trim() !== '',
    );
  return hasLateToken ? baseEnd + 0.5 : baseEnd;
}

describe('regression: specific segments', () => {
  test('seg 60: "relevant" appears as a caption within the extended clip window', () => {
    const seg = transcript.segments.find(s => s.id === 60);
    const sourceStart = seg.hookFrom ?? seg.start;
    const sourceEnd   = hookClipEnd(seg); // extended end, matching SegmentPlayer
    const caps = buildCaptions(seg.tokens, sourceStart, seg.end); // filter uses seg.end
    const words = caps.map(c => c.text.trim().toLowerCase());
    expect(words).toContain('relevant');
    // Verify the last caption's startMs falls within the extended clip window
    const relevantCap = caps.find(c => c.text.trim().toLowerCase() === 'relevant');
    expect(relevantCap.startMs).toBeLessThanOrEqual(Math.round(sourceEnd * 1000));
  });

  test('seg 61: no duplicate "the" at start', () => {
    const seg = transcript.segments.find(s => s.id === 61);
    const caps = buildCaptions(seg.tokens, seg.start, seg.end);
    expect(caps.length).toBeGreaterThan(0);
    // First two captions must not both be "the"
    if (caps.length >= 2) {
      expect(
        caps[0].text.trim().toLowerCase() === 'the' && caps[1].text.trim().toLowerCase() === 'the',
      ).toBe(false);
    }
  });

  test('seg 62: hookFrom and hookTo are set', () => {
    const seg = transcript.segments.find(s => s.id === 62);
    expect(seg.hookFrom).toBeDefined();
    expect(seg.hookTo).toBeDefined();
    expect(seg.hookFrom).toBeLessThan(seg.hookTo);
  });

  test('seg 62: captions end at or before hookTo', () => {
    const seg = transcript.segments.find(s => s.id === 62);
    const caps = buildCaptions(seg.tokens, seg.hookFrom, seg.hookTo);
    const lastCap = caps[caps.length - 1];
    // The last caption's startMs must be within the hook window
    expect(lastCap.startMs).toBeLessThanOrEqual(Math.round(seg.hookTo * 1000) + 500);
    // "programmers" must appear; "Saloni" must not
    const words = caps.map(c => c.text.trim().toLowerCase());
    expect(words).toContain('programmers');
    expect(words).not.toContain('saloni');
  });
});
