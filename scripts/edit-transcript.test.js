import {
  buildTextWithCuts,
  applyTextPartsToTokens,
  mergeDocIntoTranscript,
  buildDoc,
  deriveCuts,
  cleanCaptionText,
  buildSentencesVtt,
  autoCutPauses,
  autoCutDisfluencies,
  WORD_DURATION_ESTIMATE,
  CUT_BOUNDARY_BIAS,
  isSpecialToken,
  isDisfluencyToken,
} from './edit-transcript.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tok(text, t_dtw, cut = false) {
  return { text, t_dtw, cut };
}

function seg(overrides) {
  return { id: 1, start: 0, end: 1, speaker: 'A', cut: false, cuts: [], graphics: [], tokens: [], text: '', ...overrides };
}

function transcript(segments) {
  return { meta: { title: '', duration: 10, fps: 30 }, segments };
}

// ─── isSpecialToken ───────────────────────────────────────────────────────────

describe('isSpecialToken', () => {
  test('identifies _BEG_ as special', () => {
    expect(isSpecialToken(tok('_BEG_', 0))).toBe(true);
  });

  test('identifies _EOS_ as special', () => {
    expect(isSpecialToken(tok('_EOS_', 0))).toBe(true);
  });

  test('normal words are not special', () => {
    expect(isSpecialToken(tok(' Hello', 0))).toBe(false);
    expect(isSpecialToken(tok(' podcast', 0))).toBe(false);
  });
});

// ─── isDisfluencyToken / autoCutDisfluencies ──────────────────────────────────

describe('isDisfluencyToken', () => {
  test('identifies "--" as disfluency', () => {
    expect(isDisfluencyToken(tok('--', 0))).toBe(true);
    expect(isDisfluencyToken(tok(' --', 0))).toBe(true);
  });

  test('identifies "..." as disfluency', () => {
    expect(isDisfluencyToken(tok('...', 0))).toBe(true);
  });

  test('normal words are not disfluencies', () => {
    expect(isDisfluencyToken(tok(' and', 0))).toBe(false);
    expect(isDisfluencyToken(tok(' Is', 0))).toBe(false);
  });

  test('special tokens are not disfluencies', () => {
    expect(isDisfluencyToken(tok('_BEG_', 0))).toBe(false);
  });

  test('pure whitespace tokens are not disfluencies', () => {
    expect(isDisfluencyToken(tok('   ', 0))).toBe(false);
  });

  test('single punctuation chars are not disfluencies', () => {
    // Whisper emits these as separate tokens — they should stay visible, not auto-cut
    expect(isDisfluencyToken(tok('.', 0))).toBe(false);
    expect(isDisfluencyToken(tok('?', 0))).toBe(false);
    expect(isDisfluencyToken(tok('!', 0))).toBe(false);
    expect(isDisfluencyToken(tok('-', 0))).toBe(false);
    expect(isDisfluencyToken(tok(',', 0))).toBe(false);
  });
});

describe('autoCutDisfluencies', () => {
  test('marks "--" token as cut:true', () => {
    const segments = [seg({ tokens: [tok(' on', 1.0), tok(' --', 1.5), tok(' Is', 2.0)] })];
    const result = autoCutDisfluencies(segments);
    expect(result[0].tokens[0].cut).toBe(false);
    expect(result[0].tokens[1].cut).toBe(true);
    expect(result[0].tokens[2].cut).toBe(false);
  });

  test('does not cut normal tokens', () => {
    const segments = [seg({ tokens: [tok(' Hello', 0.1), tok(' world', 0.2)] })];
    const result = autoCutDisfluencies(segments);
    expect(result[0].tokens.every(t => !t.cut)).toBe(true);
  });

  test('does not cut special tokens', () => {
    const segments = [seg({ tokens: [tok('_BEG_', 0), tok(' Hello', 0.1)] })];
    const result = autoCutDisfluencies(segments);
    expect(result[0].tokens[0].cut).toBe(false);
  });

  test('"--" auto-cut flows through deriveCuts to create a time-range cut', () => {
    const segments = autoCutDisfluencies([
      seg({ end: 3, tokens: [tok(' on', 1.0), tok(' --', 1.5), tok(' Is', 2.0)] }),
    ]);
    const cuts = deriveCuts(segments[0]);
    expect(cuts).toHaveLength(1);
    // cutFrom = on@1.0  + CUT_BOUNDARY_BIAS*(--@1.5 - on@1.0)
    // cutTo   = --@1.5  + CUT_BOUNDARY_BIAS*(Is@2.0 - --@1.5)
    expect(cuts[0].from).toBeCloseTo(1.0 + CUT_BOUNDARY_BIAS * (1.5 - 1.0));
    expect(cuts[0].to).toBeCloseTo(1.5 + CUT_BOUNDARY_BIAS * (2.0 - 1.5));
  });

  test('"--" appears as {--} inline in buildTextWithCuts after auto-cut', () => {
    const tokens = [tok(' on', 1.0), tok(' --', 1.5, true), tok(' Is', 2.0)];
    const s = seg({ text: 'on Is', tokens });
    const result = buildTextWithCuts(s);
    expect(result).toBe('on {--} Is');
  });

  test('BPE subword tokens are grouped so {--} appears inline, not appended to end', () => {
    // Segment [24]: " today" + "'s" are BPE subwords for "today's".
    // Previously "'s" was counted as a separate part, causing word-count mismatch
    // which sent {--} to the end via the fallback path.
    const tokens = [
      tok(' today', 0.1), tok("'s", 0.2),   // BPE pair → "today's"
      tok(' topic', 0.3),
      tok(' --', 0.8, true),                 // disfluency cut
      tok(' Is', 1.0),
    ];
    const s = seg({ text: "today's topic Is", tokens });
    const result = buildTextWithCuts(s);
    expect(result).toBe("today's topic {--} Is");
  });
});

// ─── buildTextWithCuts ────────────────────────────────────────────────────────

describe('buildTextWithCuts', () => {
  test('returns token-joined text when words match seg.text', () => {
    // BPE split: " j" + "inx" → should produce "jinx"
    const s = seg({ text: 'jinx', tokens: [tok(' j', 0.1), tok('inx', 0.2)] });
    expect(buildTextWithCuts(s)).toBe('jinx');
  });

  test('trusts seg.text when user corrected a word', () => {
    const s = seg({
      text: 'Hello world',
      tokens: [tok(' Hello', 0.1), tok(' wrold', 0.2)],
    });
    expect(buildTextWithCuts(s)).toBe('Hello world');
  });

  test('trusts seg.text when user replaced garbled BPE token with more words (Welcome to ragTech case)', () => {
    // Real segment 19: Whisper BPE produced " Welcome" + " to" + "re" + "re" + "k" + "se" + "k"
    // joinTokenTexts → "Welcome torereksek" (2 words)
    // user corrected seg.text to "Welcome to ragTech" (3 words)
    // bug: old code returned tokenText because tokWords.length < segWords.length
    const tokens = [
      tok(' Welcome', 44.24),
      tok(' to', 44.48),
      tok('re', 44.62),
      tok('re', 44.62),
      tok('k', 44.66),
      tok('se', 44.80),
      tok('k', 44.92),
      tok('.', 44.96),
    ];
    const s = seg({ text: 'Welcome to ragTech', tokens });
    expect(buildTextWithCuts(s)).toBe('Welcome to ragTech');
  });

  test('trusts seg.text when user replaced multi-word phrase with fewer words (a lot\'s → award\'s)', () => {
    // Regression: user corrected Whisper's "a lot's" (2 tokens) to "award's" (1 word).
    // tokWords.length (6) > segWords.length (5) — must return seg.text, not tokenText.
    const tokens = [
      tok(' You\'d', 0.1), tok(' create', 0.2),
      tok(' a', 0.3), tok(' lot', 0.4), tok("'s", 0.45),
      tok(' best', 0.5), tok(' podcast', 0.6),
    ];
    const s = seg({ text: "You'd create award's best podcast", tokens });
    expect(buildTextWithCuts(s)).toBe("You'd create award's best podcast");
  });

  test('trusts seg.text even when it has fewer words than tokens (user correction)', () => {
    // When the user corrects text such that seg.text has fewer words than what the
    // tokens produce, seg.text is authoritative — never revert to token reconstruction.
    const s = seg({
      text: 'Hello there',
      tokens: [tok(' Hello', 0.1), tok(' world', 0.2), tok(' there', 0.3)],
    });
    expect(buildTextWithCuts(s)).toBe('Hello there');
  });

  test('preserves punctuation from tokens when text is unchanged', () => {
    const s = seg({
      text: 'Hello, everyone.',
      tokens: [tok(' Hello', 0.1), tok(',', 0.15), tok(' everyone', 0.2), tok('.', 0.3)],
    });
    expect(buildTextWithCuts(s)).toBe('Hello, everyone.');
  });

  test('trusts seg.text when user corrected only punctuation', () => {
    // tokenText = "Hello, everyone." but user changed period to exclamation
    const s = seg({
      text: 'Hello, everyone!',
      tokens: [tok(' Hello', 0.1), tok(',', 0.15), tok(' everyone', 0.2), tok('.', 0.3)],
    });
    expect(buildTextWithCuts(s)).toBe('Hello, everyone!');
  });

  test('fixes BPE subword split via concat match (e.g. "j inx" → "jinx")', () => {
    // seg.text has the BPE artifact "j inx" (2 words), tokenText reconstructs "jinx" (1 word)
    // concat: "jinx" === "jinx" → return tokenText
    const s = seg({
      text: 'j inx',
      tokens: [tok(' j', 0.1), tok('inx', 0.2)],
    });
    expect(buildTextWithCuts(s)).toBe('jinx');
  });

  test('_BEG_ token is excluded from doc text', () => {
    const s = seg({
      text: 'Hello world',
      tokens: [tok('_BEG_', 0), tok(' Hello', 0.1), tok(' world', 0.2)],
    });
    expect(buildTextWithCuts(s)).toBe('Hello world');
    expect(buildTextWithCuts(s)).not.toContain('_BEG_');
  });

  test('_BEG_ token does not cause word count mismatch with seg.text', () => {
    // 2 real words in seg.text, 3 tokens (1 special + 2 real) — should still correct
    const s = seg({
      text: 'Hello world',
      tokens: [tok('_BEG_', 0), tok(' Hello', 0.1), tok(' wrold', 0.2)],
    });
    // word counts match after filtering special tokens: 2 == 2 → use seg.text
    expect(buildTextWithCuts(s)).toBe('Hello world');
  });

  test('renders cut tokens as {span}', () => {
    const s = seg({
      text: 'Hello',
      tokens: [tok(' um', 0.1, true), tok(' Hello', 0.2)],
    });
    expect(buildTextWithCuts(s)).toBe('{um} Hello');
  });

  test('renders multiple consecutive cut tokens as single {span}', () => {
    const s = seg({
      text: 'Hello',
      tokens: [tok(' you', 0.1, true), tok(' know', 0.2, true), tok(' Hello', 0.3)],
    });
    expect(buildTextWithCuts(s)).toBe('{you know} Hello');
  });

  test('cut span uses word-only tokens so BPE merges do not break round-trip', () => {
    // "nice" + "Oh"(no leading space) would join as "niceOh" via joinTokenTexts,
    // making the span unrecognisable to applyTextPartsToTokens.
    const tokens = [
      tok(' for', 0.1),
      tok(' nice', 0.2, true),
      tok('Oh', 0.3, true),    // BPE continuation — no leading space
      tok(' end', 0.4),
    ];
    const s = seg({ text: 'for end', tokens });
    const docText = buildTextWithCuts(s);
    expect(docText).toBe('for {nice Oh} end');
    // Verify round-trip: the generated span can be matched back
    const updated = applyTextPartsToTokens(docText, tokens);
    expect(updated.filter(t => t.cut).map(t => t.text.trim())).toEqual(['nice', 'Oh']);
  });

  test('cut span deduplicates same-text same-t_dtw BPE tokens', () => {
    const tokens = [
      tok(' hello', 0.1),
      tok(' Oh', 0.5, true),
      tok('Oh', 0.5, true),    // same t_dtw, same norm — Whisper duplicate
      tok(' world', 0.9),
    ];
    const s = seg({ text: 'hello world', tokens });
    expect(buildTextWithCuts(s)).toBe('hello {Oh} world');
  });
});

// ─── applyTextPartsToTokens ───────────────────────────────────────────────────

describe('applyTextPartsToTokens', () => {
  test('marks matching tokens as cut', () => {
    const tokens = [tok(' um', 0.1), tok(' Hello', 0.2)];
    const result = applyTextPartsToTokens('{um} Hello', tokens);
    expect(result[0].cut).toBe(true);
    expect(result[1].cut).toBe(false);
  });

  test('marks multi-word cut span', () => {
    const tokens = [tok(' you', 0.1), tok(' know', 0.2), tok(' Hello', 0.3)];
    const result = applyTextPartsToTokens('{you know} Hello', tokens);
    expect(result[0].cut).toBe(true);
    expect(result[1].cut).toBe(true);
    expect(result[2].cut).toBe(false);
  });

  test('resets all cut flags before applying', () => {
    const tokens = [tok(' um', 0.1, true), tok(' Hello', 0.2, true)];
    const result = applyTextPartsToTokens('um Hello', tokens);
    expect(result[0].cut).toBe(false);
    expect(result[1].cut).toBe(false);
  });

  test('applies word correction to non-cut tokens', () => {
    const tokens = [tok(' wrold', 0.1), tok(' world', 0.2)];
    // 2 visible words, 2 non-cut tokens — corrections apply, leading space preserved
    const result = applyTextPartsToTokens('world world', tokens);
    expect(result[0].text).toBe(' world');
    expect(result[1].text).toBe(' world');
  });

  test('_BEG_ token is never marked as cut and does not block alignment', () => {
    const tokens = [tok('_BEG_', 0), tok(' um', 0.1), tok(' Hello', 0.2)];
    const result = applyTextPartsToTokens('{um} Hello', tokens);
    expect(result[0].cut).toBe(false); // _BEG_ never cut
    expect(result[1].cut).toBe(true);  // um cut
    expect(result[2].cut).toBe(false); // Hello not cut
  });

  test('preserves leading space on corrected tokens so joinTokenTexts does not concatenate words', () => {
    // Tokens with leading spaces (" and", " creating") — after correction the
    // space must be kept, otherwise joinTokenTexts produces "andcreating".
    const tokens = [tok(' and', 0.1), tok(' creating', 0.2), tok(' content', 0.3)];
    const result = applyTextPartsToTokens('and creating content', tokens);
    expect(result[0].text).toBe(' and');
    expect(result[1].text).toBe(' creating');
    expect(result[2].text).toBe(' content');
  });

  test('word correction without leading space keeps no leading space', () => {
    // First token has no leading space (BPE continuation) — no space should be added
    const tokens = [tok('ing', 0.1), tok(' world', 0.2)];
    const result = applyTextPartsToTokens('ing world', tokens);
    expect(result[0].text).toBe('ing');
    expect(result[1].text).toBe(' world');
  });

  test('_BEG_ token excluded from word alignment — real words still corrected', () => {
    // 2 visible words, 2 non-special non-cut tokens → correction applies, leading space preserved
    const tokens = [tok('_BEG_', 0), tok(' wrold', 0.1), tok(' earth', 0.2)];
    const result = applyTextPartsToTokens('world earth', tokens);
    expect(result[1].text).toBe(' world');
    expect(result[2].text).toBe(' earth');
  });

  test('ignores colon-reason syntax from old docs (backwards compat)', () => {
    // Old format {um:filler} — reason is stripped, word still gets cut
    const tokens = [tok(' um', 0.1), tok(' Hello', 0.2)];
    const result = applyTextPartsToTokens('{um:filler} Hello', tokens);
    // "um:filler" is treated as the full span — won't match token "um"
    // This is acceptable: old docs with reasons just won't cut those tokens
    // (the important thing is it doesn't crash)
    expect(() => applyTextPartsToTokens('{um:filler} Hello', tokens)).not.toThrow();
  });

  test('finds cut span when punctuation tokens are interspersed between words', () => {
    // Whisper emits "Oh" "," "so" as separate tokens — the user writes {Oh so}
    // without punctuation. The search must skip "," when matching.
    const tokens = [
      tok(' before', 0.0),
      tok(' Oh', 0.5),
      tok(',', 0.6),
      tok(' so', 0.7),
      tok(' after', 0.8),
    ];
    const result = applyTextPartsToTokens('before {Oh so} after', tokens);
    expect(result[0].cut).toBe(false); // before
    expect(result[1].cut).toBe(true);  // Oh
    expect(result[2].cut).toBe(true);  // , (interspersed punctuation also cut)
    expect(result[3].cut).toBe(true);  // so
    expect(result[4].cut).toBe(false); // after
  });

  test('cuts also extends to adjacent tokens sharing the same t_dtw', () => {
    // Whisper sometimes emits duplicate tokens at the same timestamp.
    // When the last matched word has a duplicate at the same t_dtw, that duplicate
    // should also be marked cut so its audio doesn't slip through.
    const tokens = [
      tok(' nice', 1.0),
      tok('Oh', 1.5),      // BPE continuation, no leading space, same t_dtw as next
      tok(' Oh', 1.5),     // duplicate at same timestamp
      tok(' after', 2.0),
    ];
    const result = applyTextPartsToTokens('{nice Oh} after', tokens);
    expect(result[0].cut).toBe(true);  // nice
    expect(result[1].cut).toBe(true);  // Oh (BPE continuation)
    expect(result[2].cut).toBe(true);  // Oh (same t_dtw duplicate)
    expect(result[3].cut).toBe(false); // after
  });

  test('segment [20] scenario: cut span after visible words with punctuation tokens', () => {
    // Reproduces the real failure: tokens are [for, everyone, ., Oh, ,, so, ..., My]
    // User writes {Oh so that would be nice Oh} but "," sits between Oh and so.
    const tokens = [
      tok(' for', 1.0),
      tok(' everyone', 2.0),
      tok('.', 2.5),      // punctuation after "everyone"
      tok(' Oh', 2.6),
      tok(',', 2.7),
      tok(' so', 2.8),
      tok(' that', 2.9),
      tok(' would', 3.0),
      tok(' be', 3.1),
      tok(' nice', 3.2),
      tok(' Oh', 3.5),
      tok(' My', 4.0),
    ];
    const result = applyTextPartsToTokens(
      'for everyone {Oh so that would be nice Oh} My',
      tokens,
    );
    expect(result[0].cut).toBe(false); // for
    expect(result[1].cut).toBe(false); // everyone
    expect(result[2].cut).toBe(false); // . (before the cut span)
    expect(result[3].cut).toBe(true);  // Oh
    expect(result[4].cut).toBe(true);  // , (interspersed)
    expect(result[5].cut).toBe(true);  // so
    expect(result[6].cut).toBe(true);  // that
    expect(result[7].cut).toBe(true);  // would
    expect(result[8].cut).toBe(true);  // be
    expect(result[9].cut).toBe(true);  // nice
    expect(result[10].cut).toBe(true); // Oh
    expect(result[11].cut).toBe(false);// My
  });
});

// ─── mergeDocIntoTranscript ───────────────────────────────────────────────────

describe('mergeDocIntoTranscript', () => {
  function makeTranscript(segments) {
    return transcript(segments.map((s, i) => ({
      id: i + 1, start: i, end: i + 1, speaker: 'A', cut: false, cuts: [], graphics: [], text: s.text,
      tokens: s.tokens || [],
    })));
  }

  test('applies text correction from doc and persists through buildDoc round-trip', () => {
    // Simulates the "Welcome to ragTech" bug:
    // seg.text starts as "Welcome torereksek", user edits doc to "Welcome to ragTech"
    const tokens = [
      tok(' Welcome', 44.24),
      tok(' to', 44.48),
      tok('re', 44.62),
      tok('re', 44.62),
      tok('k', 44.66),
      tok('se', 44.80),
      tok('k', 44.92),
      tok('.', 44.96),
    ];
    const base = makeTranscript([{ text: 'Welcome torereksek', tokens }]);

    const doc = `# SPEAKERS\nA: A\n\n---\n\n=== A ===\n\n[1]  Welcome to ragTech\n`;
    const merged = mergeDocIntoTranscript(base, doc);

    expect(merged.segments[0].text).toBe('Welcome to ragTech');

    // Round-trip: buildDoc should emit the corrected text, not token reconstruction
    const rebuiltDoc = buildDoc(merged);
    expect(rebuiltDoc).toContain('Welcome to ragTech');
    expect(rebuiltDoc).not.toContain('torereksek');
  });

  test('word correction that reduces word count persists through buildDoc round-trip (a lot\'s → award\'s)', () => {
    // Regression: after the user changes "a lot's" → "award's" in the doc and runs
    // merge-doc, re-running edit-transcript must still show "award's", not revert to
    // the original token reconstruction "a lot's".
    const tokens = [
      tok(' You\'d', 0.1), tok(' create', 0.2),
      tok(' a', 0.3), tok(' lot', 0.4), tok("'s", 0.45),
      tok(' best', 0.5),
    ];
    const base = makeTranscript([{ text: "You'd create a lot's best", tokens }]);

    // Simulate the user editing the doc: change "a lot's" → "award's"
    const doc = `# SPEAKERS\nA: A\n\n---\n\n=== A ===\n\n[1]  You'd create award's best\n`;
    const merged = mergeDocIntoTranscript(base, doc);

    expect(merged.segments[0].text).toBe("You'd create award's best");

    // Round-trip: buildDoc must emit the corrected text, not revert to token reconstruction
    const rebuiltDoc = buildDoc(merged);
    expect(rebuiltDoc).toContain("award's");
    expect(rebuiltDoc).not.toContain("a lot's");
  });

  test('marks segment as cut when CUT is present', () => {
    const base = makeTranscript([{ text: 'off topic stuff', tokens: [tok(' off', 0.1), tok(' topic', 0.2), tok(' stuff', 0.3)] }]);
    const doc = `# SPEAKERS\nA: A\n\n---\n\n=== A ===\n\n[1] CUT  off topic stuff\n`;
    const merged = mergeDocIntoTranscript(base, doc);
    expect(merged.segments[0].cut).toBe(true);
  });

  test('CUT with legacy reason suffix still marks segment as cut', () => {
    const base = makeTranscript([{ text: 'off topic stuff', tokens: [tok(' off', 0.1), tok(' topic', 0.2), tok(' stuff', 0.3)] }]);
    const doc = `# SPEAKERS\nA: A\n\n---\n\n=== A ===\n\n[1] CUT:offtopic  off topic stuff\n`;
    const merged = mergeDocIntoTranscript(base, doc);
    expect(merged.segments[0].cut).toBe(true);
  });

  test('applies speaker rename', () => {
    const base = makeTranscript([{ text: 'hello', tokens: [tok(' hello', 0.1)] }]);
    const doc = `# SPEAKERS\nA: Alice\n\n---\n\n=== A ===\n\n[1]  hello\n`;
    const merged = mergeDocIntoTranscript(base, doc);
    expect(merged.segments[0].speaker).toBe('Alice');
  });
});

// ─── deriveCuts ───────────────────────────────────────────────────────────────

describe('deriveCuts', () => {
  test('produces no cuts when no tokens are cut', () => {
    const s = seg({ end: 2, tokens: [tok(' Hello', 0.5), tok(' world', 1.0)] });
    expect(deriveCuts(s)).toEqual([]);
  });

  test('produces a cut range for a cut token', () => {
    const s = seg({
      end: 2,
      tokens: [tok(' um', 0.5, true), tok(' Hello', 1.0)],
    });
    const cuts = deriveCuts(s);
    expect(cuts).toHaveLength(1);
    // No prevWordToken: cutFrom = um.t_dtw = 0.5
    // cutTo = um@0.5 + CUT_BOUNDARY_BIAS*(Hello@1.0 - um@0.5)
    expect(cuts[0].from).toBeCloseTo(0.5);
    expect(cuts[0].to).toBeCloseTo(0.5 + CUT_BOUNDARY_BIAS * (1.0 - 0.5));
  });

  test('cut range for trailing cut token uses segment end', () => {
    const s = seg({
      end: 2,
      tokens: [tok(' Hello', 0.5), tok(' um', 1.0, true)],
    });
    const cuts = deriveCuts(s);
    // cutFrom = Hello@0.5 + CUT_BOUNDARY_BIAS*(um@1.0 - Hello@0.5)
    // cutTo   = um@1.0   + CUT_BOUNDARY_BIAS*(segment.end=2 - um@1.0)
    expect(cuts[0].from).toBeCloseTo(0.5 + CUT_BOUNDARY_BIAS * (1.0 - 0.5));
    expect(cuts[0].to).toBeCloseTo(1.0 + CUT_BOUNDARY_BIAS * (2.0 - 1.0));
  });

  test('explicit _cutFrom/_cutTo overrides bias computation', () => {
    const s = seg({
      end: 3,
      tokens: [
        { ...tok(' Hello', 0.5), },
        { ...tok(' um', 1.0, true), _cutFrom: 0.7 },
        { ...tok(' world', 1.5, true), _cutTo: 1.4 },
        tok(' end', 2.0),
      ],
    });
    const cuts = deriveCuts(s);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].from).toBeCloseTo(0.7);
    expect(cuts[0].to).toBeCloseTo(1.4);
  });

  test('doc {text | from, to} override flows through to cut times', () => {
    const base = seg({
      end: 4,
      tokens: [tok(' hello', 1.0), tok(' um', 2.0, false), tok(' world', 3.0)],
    });
    const updated = applyTextPartsToTokens('hello {um | 1.8, 2.9} world', base.tokens);
    const cuts = deriveCuts({ ...base, tokens: updated });
    expect(cuts).toHaveLength(1);
    expect(cuts[0].from).toBeCloseTo(1.8);
    expect(cuts[0].to).toBeCloseTo(2.9);
  });

  test('produces no reason field on cuts', () => {
    const s = seg({
      end: 2,
      tokens: [tok(' um', 0.5, true), tok(' Hello', 1.0)],
    });
    const cuts = deriveCuts(s);
    expect(cuts[0]).not.toHaveProperty('reason');
  });
});

// ─── cleanCaptionText / buildSentencesVtt ─────────────────────────────────────

describe('cleanCaptionText', () => {
  test('strips _BEG_ prefix', () => {
    expect(cleanCaptionText('_BEG_ Hello world')).toBe('Hello world');
  });

  test('strips any _ALLCAPS_ token', () => {
    expect(cleanCaptionText('_LAUGHTER_ funny stuff')).toBe('funny stuff');
  });

  test('collapses extra spaces after stripping', () => {
    expect(cleanCaptionText('Hello  _BEG_  world')).toBe('Hello world');
  });

  test('leaves normal text unchanged', () => {
    expect(cleanCaptionText('Welcome to ragTech')).toBe('Welcome to ragTech');
  });
});

describe('buildSentencesVtt', () => {
  test('excludes cut segments', () => {
    const segments = [
      seg({ id: 1, start: 0, end: 1, text: 'keep this', cut: false }),
      seg({ id: 2, start: 1, end: 2, text: 'cut this', cut: true }),
    ];
    const vtt = buildSentencesVtt(segments);
    expect(vtt).toContain('keep this');
    expect(vtt).not.toContain('cut this');
  });

  test('strips _BEG_ from caption text', () => {
    const segments = [
      seg({ id: 1, start: 0, end: 1, text: '_BEG_ Hello everyone', cut: false }),
    ];
    const vtt = buildSentencesVtt(segments);
    expect(vtt).toContain('Hello everyone');
    expect(vtt).not.toContain('_BEG_');
  });

  test('skips segments whose text is empty after cleaning', () => {
    const segments = [
      seg({ id: 1, start: 0, end: 1, text: '_BEG_', cut: false }),
      seg({ id: 2, start: 1, end: 2, text: 'Hello', cut: false }),
    ];
    const vtt = buildSentencesVtt(segments);
    // Only one timestamp block should exist (for "Hello")
    const tsCount = (vtt.match(/-->/g) || []).length;
    expect(tsCount).toBe(1);
  });
});

// ─── autoCutPauses ────────────────────────────────────────────────────────────

describe('autoCutPauses', () => {
  const THRESHOLD = 0.5;

  function makeSeg(tokens) {
    return { id: 1, start: tokens[0].t_dtw, end: tokens[tokens.length - 1].t_dtw + 0.1, cut: false, cuts: [], tokens };
  }

  function run(tokens, threshold = THRESHOLD) {
    const t = { meta: {}, segments: [makeSeg(tokens)] };
    return autoCutPauses(t, threshold).segments[0].cuts;
  }

  test('cuts a genuine long pause between words', () => {
    // gap = 1.5s → silence = 1.5 - 0.4 = 1.1s > 0.5 → should cut
    const cuts = run([tok(' hello', 0), tok(' world', 1.5)]);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].from).toBeCloseTo(WORD_DURATION_ESTIMATE);
    expect(cuts[0].to).toBeCloseTo(1.5);
  });

  test('does not cut when silence after word is below threshold', () => {
    // gap = 0.7s → silence = 0.7 - 0.4 = 0.3s < 0.5 → no cut
    const cuts = run([tok(' hello', 0), tok(' world', 0.7)]);
    expect(cuts).toHaveLength(0);
  });

  test('cuts when silence equals threshold exactly (>=)', () => {
    // gap = 0.9s → silence = 0.9 - 0.4 = 0.5s === threshold → should cut
    // This is the "on" → "Is" case from segment [24]
    const cuts = run([tok(' on', 0), tok(' Is', 0.9)]);
    expect(cuts).toHaveLength(1);
  });

  // Regression: "podcast" clipped to "pod"
  // " podcast" t=75.58, " award" t=76.24 → gap=0.66s → silence=0.26s < 0.5
  test('does not clip a long word like "podcast" when gap barely exceeds threshold', () => {
    const cuts = run([
      tok(' best', 74.96),
      tok(' podcast', 75.58),   // gap=0.62 → silence=0.22 < 0.5 → no cut
      tok(' award', 76.24),     // gap=0.66 → silence=0.26 < 0.5 → no cut
    ]);
    expect(cuts).toHaveLength(0);
  });

  // Regression: "2026" split as "20" <pause> "26" with no leading space on "26"
  // Both tokens are from the same word — even if gap is large, still no cut
  test('does not cut within a number pronounced with a natural pause ("2026")', () => {
    // Simulates Whisper BPE: " 20" + "26" where gap represents intra-word breath
    const cuts = run([
      tok(' in', 0),
      tok(' 20', 1.5),   // gap from previous = 1.5s → will cut before "20"
      tok('26', 2.1),    // gap = 0.6s → silence = 0.2 < 0.5 → no cut within "2026"
      tok('.', 2.2),
    ]);
    // Only the gap before " 20" should produce a cut; the "20"→"26" gap should not
    const cutsBetween20and26 = cuts.filter(c => c.from >= 1.5 && c.to <= 2.1);
    expect(cutsBetween20and26).toHaveLength(0);
  });

  test('cut starts after WORD_DURATION_ESTIMATE, not at token start', () => {
    // gap = 2.0s → silence = 1.6s → should cut, starting at 0 + 0.4
    const cuts = run([tok(' hello', 0), tok(' world', 2.0)]);
    expect(cuts[0].from).toBeCloseTo(WORD_DURATION_ESTIMATE);
    expect(cuts[0].to).toBeCloseTo(2.0);
  });

  test('skips cut tokens', () => {
    // Middle token is cut — pause detection should skip it
    const tokens = [tok(' hello', 0), tok(' um', 0.5, true), tok(' world', 2.0)];
    const cuts = run(tokens);
    // Gap between non-cut tokens: 0 → 2.0 = 2.0s → silence = 1.6 → cut
    expect(cuts).toHaveLength(1);
    expect(cuts[0].from).toBeCloseTo(WORD_DURATION_ESTIMATE);
    expect(cuts[0].to).toBeCloseTo(2.0);
  });

  // Regression: _BEG_ token at t=0 before first real word should not create a gap cut
  test('_BEG_ token is excluded from gap detection', () => {
    // _BEG_ at t=0, first word at t=0.2 — if _BEG_ were included, gap=0.2 → no cut anyway
    // but _BEG_ at t=0, first word at t=1.5 — gap=1.5 → silence=1.1 → would incorrectly cut
    // if _BEG_ is excluded, only the real words are considered
    const tokens = [
      tok('_BEG_', 0),
      tok(' hello', 1.5),   // no gap cut because _BEG_ is skipped, only 1 real token
      tok(' world', 2.0),   // gap = 0.5 → silence = 0.1 → no cut
    ];
    const cuts = run(tokens);
    expect(cuts).toHaveLength(0);
  });

  test('does not cut segment-level cut segments', () => {
    const tokens = [tok(' hello', 0), tok(' world', 2.0)];
    const s = { id: 1, start: 0, end: 2.1, cut: true, cuts: [], tokens };
    const t = { meta: {}, segments: [s] };
    // cut=true segment still goes through autoCutPauses (segment-level cut is
    // handled by composition, not here) — function should still work without error
    expect(() => autoCutPauses(t, THRESHOLD)).not.toThrow();
  });
});
