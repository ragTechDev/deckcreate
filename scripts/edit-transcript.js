#!/usr/bin/env node

import fs from 'fs-extra';
import path from 'path';
import { convertVttToSrt } from './shared/vtt-to-srt.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--raw' && args[i + 1]) result.rawPath = args[++i];
    else if (args[i] === '--output' && args[i + 1]) result.outputPath = args[++i];
    else if (args[i] === '--merge-vtt' && args[i + 1]) result.vttPath = args[++i];
    else if (args[i] === '--merge-doc' && args[i + 1]) result.docPath = args[++i];
    else if (args[i] === '--auto-cut-pauses' && args[i + 1]) result.autoCutPauses = parseFloat(args[++i]);
    else if (args[i] === '--timestamp-offset' && args[i + 1]) result.timestampOffset = parseFloat(args[++i]);
    else if (args[i] === '--video-src' && args[i + 1]) result.videoSrc = args[++i];
    else if (args[i] === '--video-srcs' && args[i + 1]) result.videoSrcs = args[++i].split(',').filter(Boolean);
  }
  return result;
}

// ─── Text helpers ─────────────────────────────────────────────────────────────

// Strip leading/trailing punctuation, keep apostrophes for contractions
function stripPunctuation(text) {
  return text.trim().replace(/^[^\w']+|[^\w']+$/g, '');
}

function normalize(text) {
  return stripPunctuation(text).toLowerCase();
}

// Whisper special tokens (e.g. _BEG_, _EOS_) — never shown in text, never cut.
function isSpecialToken(token) {
  return /_[A-Z]+_/.test(token.text.trim());
}

// Whisper disfluency markers (e.g. "--", "...") — spoken hesitation tokens whose
// audio is present but invisible in the doc (they look like punctuation but carry
// speech). Only matches multi-char repeated markers, NOT single punctuation like
// ".", "?", "!" which Whisper also emits as separate tokens.
function isDisfluencyToken(token) {
  if (isSpecialToken(token)) return false;
  const t = token.text.trim();
  return /^-{2,}$|^\.{2,}$|^—+$/.test(t);
}

// Whisper BPE tokens carry their word boundary as a leading space:
// " j" starts a new word, "inx" continues the previous one → "jinx".
function joinTokenTexts(tokens) {
  let result = '';
  for (const t of tokens) {
    if (isSpecialToken(t)) continue;
    const raw = t.text.trim();
    if (!raw) continue;
    result = (!result || t.text.startsWith(' '))
      ? (result ? `${result} ${raw}` : raw)
      : result + raw;
  }
  return result;
}

// Whisper BPE emits contraction suffixes as space-prefixed tokens (" 'm", " 's").
// Re-attach them to the preceding word after joining.
function fixContractions(text) {
  return text.replace(/ '(m|s|t|re|ve|ll|d)\b/gi, "'$1");
}

function isContractionSuffixTokenText(text) {
  return /^'(m|s|t|re|ve|ll|d)$/i.test(text.trim());
}

function isNumericTokenText(text) {
  return /^\d+$/.test(text.trim());
}

// ─── Cut derivation ───────────────────────────────────────────────────────────

// How far (0–1) to bias cut boundaries towards the adjacent spoken words.
// 0 = cut starts/ends at the cut token's own t_dtw (original behaviour).
// 1 = cut starts/ends exactly at the neighbouring word's t_dtw.
// Raise towards 1 to tighten cuts; lower towards 0 for more breathing room.
// Start bias controls where the cut begins (relative to prevWord → cutToken gap).
// End bias controls where the cut ends (relative to lastCutToken → nextWord gap).
// Keep end bias below 1.0 to leave a small buffer before the next word's onset,
// preventing the beginning of the next word from being clipped.
const CUT_START_BIAS = 1.0;
const CUT_END_BIAS = 0.75;

function deriveCuts(segment) {
  const cuts = [];
  let cutFrom = null;
  let lastCutToken = null;
  // Last non-cut, non-special token with real text — used to start the cut at
  // the midpoint between the previous word and the first cut token, so the cut
  // begins closer to where the previous word ends rather than its t_dtw start.
  let prevWordToken = null;

  for (let i = 0; i <= segment.tokens.length; i++) {
    const token = segment.tokens[i];
    const isCut = token?.cut ?? false;

    if (!cutFrom && isCut) {
      cutFrom = token._cutFrom !== undefined
        ? token._cutFrom
        : (prevWordToken
            // Use exact word-end boundary when available (WhisperX t_end), else heuristic.
            ? (prevWordToken.t_end !== undefined
                ? prevWordToken.t_end
                : prevWordToken.t_dtw + CUT_START_BIAS * (token.t_dtw - prevWordToken.t_dtw))
            : token.t_dtw);
      lastCutToken = token;
    } else if (cutFrom && isCut) {
      lastCutToken = token;
    } else if (cutFrom && !isCut) {
      const endTime = token ? token.t_dtw : segment.end;
      // Use the next word's start (t_dtw) directly as the cut end — this is the exact
      // word onset from WhisperX alignment, so no end-bias buffer is needed.
      // Fallback to the bias heuristic only when _cutTo is explicitly overridden.
      const cutTo = lastCutToken._cutTo !== undefined
        ? lastCutToken._cutTo
        : endTime;
      // Skip zero-duration or inverted cuts (can happen when token t_dtw > segment.end
      // due to Whisper timing imprecision, or when consecutive tokens share a t_dtw).
      if (cutTo > cutFrom) cuts.push({ from: cutFrom, to: cutTo });
      cutFrom = null;
      lastCutToken = null;
      if (token && !isSpecialToken(token) && normalize(token.text) !== '') {
        prevWordToken = token;
      }
    } else if (!isCut && token && !isSpecialToken(token) && normalize(token.text) !== '') {
      prevWordToken = token;
    }
  }

  return cuts;
}

// ─── Sentence merging ─────────────────────────────────────────────────────────

const SENTENCE_END = /[.!?](\s|$)/;
const MAX_WORDS = 12;
const PAUSE_THRESHOLD = 0.8;

function mergeIntoSentences(segments) {
  const sentences = [];
  let bucket = null;
  let wordCount = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const next = segments[i + 1];

    if (!bucket) {
      bucket = { ...seg, tokens: [...seg.tokens] };
      wordCount = seg.text.split(/\s+/).filter(Boolean).length;
    } else {
      bucket.end = seg.end;
      bucket.text = bucket.text.trimEnd() + ' ' + seg.text.trimStart();
      bucket.tokens = [...bucket.tokens, ...seg.tokens];
      wordCount += seg.text.split(/\s+/).filter(Boolean).length;
    }

    const endsWithPunctuation = SENTENCE_END.test(seg.text.trim());
    const longPause = next && (next.start - seg.end) > PAUSE_THRESHOLD;
    const tooLong = wordCount >= MAX_WORDS;
    const speakerChange = next && next.speaker && seg.speaker && next.speaker !== seg.speaker;

    if (endsWithPunctuation || longPause || tooLong || speakerChange || !next) {
      sentences.push({ ...bucket, id: sentences.length + 1 });
      bucket = null;
      wordCount = 0;
    }
  }

  return rebalanceBoundaryTokens(sentences);
}

/**
 * Post-merge pass: move any trailing word tokens whose t_dtw > sentence.end into
 * the front of the next sentence's token array.
 *
 * Root cause: Whisper's DTW alignment sometimes assigns a token to a timestamp
 * slightly past the raw segment boundary it belongs to. When mergeIntoSentences
 * concatenates tokens from consecutive raw segments, those drifted tokens end up
 * in the CURRENT sentence even though their timestamp belongs to the NEXT one.
 * At render time, buildCaptions uses a 0.5 s buffer past sourceEnd, so drifted
 * tokens appear in the current hook clip AND the next one — producing phrases
 * like "coding AI" at the end of clip N and "AI tools" at the start of clip N+1.
 *
 * Moving the token into the next sentence ensures each token is rendered only once,
 * in the clip whose time range actually contains its t_dtw.
 */
function rebalanceBoundaryTokens(sentences) {
  for (let i = 0; i < sentences.length - 1; i++) {
    const curr = sentences[i];
    const next = sentences[i + 1];
    // Walk backwards from the end of curr's tokens, collecting trailing word
    // tokens whose t_dtw exceeds curr.end. Stop as soon as we hit an in-range token.
    const toMove = [];
    for (let ti = curr.tokens.length - 1; ti >= 0; ti--) {
      const t = curr.tokens[ti];
      if (isSpecialToken(t) || normalize(t.text) === '') continue;
      if (t.t_dtw > curr.end) {
        toMove.unshift(...curr.tokens.splice(ti, 1));
      } else {
        break; // first token that IS within range — stop
      }
    }
    if (toMove.length > 0) next.tokens.unshift(...toMove);
  }
  return sentences;
}

// ─── Doc export ───────────────────────────────────────────────────────────────

function buildTextWithCuts(seg) {
  const hasCuts = seg.tokens.some(t => t.cut);

  // No cut tokens — rebuild from token boundaries to fix subword splits (e.g. "j inx" → "jinx").
  // Fall back to seg.text when the user has made structural word-count edits.
  if (!hasCuts) {
    const tokenText = fixContractions(joinTokenTexts(seg.tokens.filter(t => !isSpecialToken(t))));
    if (!seg.text || !tokenText) return tokenText || seg.text;
    const segWords = seg.text.split(/\s+/).filter(Boolean);
    const tokWords = tokenText.split(/\s+/).filter(Boolean);
    if (tokWords.length === segWords.length) {
      const normalMatch = segWords.every((w, i) => normalize(w) === normalize(tokWords[i]));
      if (!normalMatch) return seg.text;                             // user changed words
      // Words match (normalized). Use tokenText to pick up trailing punctuation that
      // tokens carry (e.g. "everyone." from a "." token) unless the user explicitly
      // changed punctuation on a word — detected when a differing seg word itself has
      // trailing punctuation (e.g. "everyone!" vs "everyone.": user set "!", keep it).
      // A seg word that simply lacks punctuation the token has (e.g. "everyone" vs
      // "everyone.") has no trailing punctuation itself, so tokenText wins.
      const userChangedPunctuation = segWords.some(
        (w, i) => w !== tokWords[i] && stripPunctuation(w) !== w,
      );
      if (userChangedPunctuation) return seg.text;
      return tokenText;
    }
    // Word counts differ: BPE subword merge if concat matches (e.g. "j inx" → "jinx"), otherwise user edit
    if (normalize(segWords.join('')) === normalize(tokWords.join(''))) return tokenText;
    // Word count mismatch from a user correction (e.g. "a lot's" → "award's") — trust seg.text.
    return seg.text;
  }

  // Build parts list from tokens (cut markers + non-cut token words)
  const parts = [];
  let i = 0;
  while (i < seg.tokens.length) {
    const token = seg.tokens[i];
    if (isSpecialToken(token)) { i++; continue; }

    if (!token.cut && isDisfluencyToken(token)) {
      // Non-cut disfluency (e.g. "--"): show as a standalone token so the user
      // can surround it with {…} in the doc to cut it.
      parts.push(token.text.trim());
      i++;
      continue;
    }

    if (token.cut) {
      // Collect all consecutive cut tokens (including disfluencies like "--" whose
      // stripped word is empty — they still need to appear as {--} in the doc).
      const cutTokens = [];
      while (i < seg.tokens.length && seg.tokens[i].cut) {
        if (!isSpecialToken(seg.tokens[i])) cutTokens.push(seg.tokens[i]);
        i++;
      }
      // Build span from tokens, attaching punctuation to the preceding word.
      // Dedupe same-text/same-t_dtw BPE pairs so the span round-trips through
      // applyTextPartsToTokens. Fall back to joinTokenTexts (which handles "--" etc.)
      // when no word tokens exist.
      const wordSpan = (() => {
        const words = [];
        let prevNorm = null, prevTdtw = null;
        for (const t of cutTokens) {
          const norm = normalize(t.text);
          const trimmed = t.text.trim();
          if (!trimmed) continue;
          if (!norm) {
            // Pure punctuation — attach to last word, or skip if no word yet
            if (words.length > 0) words[words.length - 1] += trimmed;
            continue;
          }
          if (norm === prevNorm && t.t_dtw === prevTdtw) continue; // dedupe BPE dups
          words.push(stripPunctuation(t.text).trim());
          prevNorm = norm; prevTdtw = t.t_dtw;
        }
        return words.join(' ');
      })();
      const span = wordSpan || joinTokenTexts(cutTokens) || cutTokens.map(t => t.text.trim()).filter(Boolean).join(' ');
      if (span) {
        // Show explicit time override if one was stored (from a previous {text | from, to} edit).
        const first = cutTokens[0];
        const last = cutTokens[cutTokens.length - 1];
        const timeOverride = (first?._cutFrom !== undefined && last?._cutTo !== undefined)
          ? ` | ${first._cutFrom.toFixed(2)}, ${last._cutTo.toFixed(2)}`
          : '';
        parts.push(`{${span}${timeOverride}}`);
      }
    } else {
      // Group BPE subword tokens and trailing punctuation into a single word part
      // (e.g. " today" + "'s" → "today's", " everyone" + "." → "everyone.").
      let word = '';
      while (i < seg.tokens.length && !seg.tokens[i].cut && !isSpecialToken(seg.tokens[i])) {
        const tok = seg.tokens[i];
        const trimmed = tok.text.trim();
        if (!trimmed) { i++; continue; } // skip truly empty tokens
        if (isDisfluencyToken(tok)) break; // disfluency handled as standalone by outer loop
        if (word && tok.text.startsWith(' ') && normalize(tok.text)) break; // new word boundary
        word += normalize(tok.text) ? stripPunctuation(tok.text) : trimmed;
        i++;
      }
      if (word) parts.push(word);
    }
  }

  // Check whether the user has made word-level corrections to seg.text
  const segTextWords = (seg.text || '').split(/\s+/).filter(Boolean);
  // Disfluency parts (e.g. "--") may not appear in seg.text (old format) but are
  // correctly placed inline by the token loop above. Exclude them from the count
  // comparison so an old seg.text without disfluencies still matches.
  const nonCutParts = parts.filter(p => !p.startsWith('{') && !isDisfluencyToken({ text: p }));

  if (segTextWords.length === nonCutParts.length) {
    // Word counts match — only substitute seg.text words if the user changed them
    const userEdited = nonCutParts.some((p, i) => normalize(p) !== normalize(segTextWords[i]));
    if (userEdited) {
      let wi = 0;
      return fixContractions(parts.map(p => (p.startsWith('{') || isDisfluencyToken({ text: p })) ? p : segTextWords[wi++]).join(' '));
    }
    // No user edits — keep token-derived parts (includes punctuation)
    return fixContractions(parts.join(' '));
  }

  // Word counts differ (user replaced multiple tokens with fewer/more words) —
  // output corrected seg.text as a block, append any cut markers
  const cutMarkers = parts.filter(p => p.startsWith('{'));
  return fixContractions([seg.text, ...cutMarkers].filter(Boolean).join(' ') || parts.join(' '));
}

/**
 * Returns the raw token index of the first token of a phrase match, or -1.
 * Uses the same BPE word-group logic as resolvePhraseToTimeRange.
 */
function resolvePhraseToFirstTokenIndex(phrase, tokens) {
  const words = phrase.trim().split(/\s+/).map(normalize).filter(Boolean);
  if (!words.length) return -1;

  const wordGroups = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (isSpecialToken(t) || normalize(t.text) === '') continue;
    if (wordGroups.length === 0 || t.text.startsWith(' ')) {
      wordGroups.push({ text: t.text, firstRawIdx: i });
    } else {
      wordGroups[wordGroups.length - 1].text += t.text;
    }
  }

  for (let i = 0; i <= wordGroups.length - words.length; i++) {
    if (words.every((w, j) => normalize(wordGroups[i + j].text) === w)) {
      return wordGroups[i].firstRawIdx;
    }
  }
  return -1;
}

/**
 * Finds a phrase (space-separated words) in a segment's token list and returns
 * the time range {from, to} covering it. `to` is the next token's t_dtw so the
 * last word isn't clipped; falls back to segEnd when no next token exists.
 * Returns null if the phrase isn't found.
 */
function resolvePhraseToTimeRange(phrase, tokens, segEnd) {
  const words = phrase.trim().split(/\s+/).map(normalize).filter(Boolean);
  if (!words.length) return null;

  // Group BPE sub-tokens into word-level groups: a new group starts at each
  // leading-space token (or the very first non-special token). Continuation
  // tokens (no leading space, e.g. "'t" after " wouldn") are merged into the
  // preceding group. This ensures contractions like "wouldn't" are matched as
  // a single word rather than the truncated stem " wouldn".
  const wordGroups = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (isSpecialToken(t) || normalize(t.text) === '') continue;
    const trimmed = t.text.trim();
    if (wordGroups.length === 0) {
      wordGroups.push({ text: t.text, t_dtw: t.t_dtw, endIdx: i });
    } else {
      const prev = wordGroups[wordGroups.length - 1];
      const prevTrimmed = prev.text.trim();
      const bothNumeric = isNumericTokenText(prevTrimmed) && isNumericTokenText(trimmed);
      const isNumericDuplicate = bothNumeric
        && (prevTrimmed.endsWith(trimmed) || trimmed.endsWith(prevTrimmed));
      const shouldMergeShortNumericParts = bothNumeric
        && prevTrimmed.length <= 2
        && trimmed.length <= 2;
      const shouldAttach = !t.text.startsWith(' ')
        // Some Whisper variants emit contraction suffixes with a leading space
        // (e.g. " 's"). Keep them attached to the previous word.
        || isContractionSuffixTokenText(trimmed)
        // Numbers are sometimes split as separate short spaced tokens (e.g.
        // "20" "26"). Merge those parts so phrase hooks can match years.
        || shouldMergeShortNumericParts;

      if (isNumericDuplicate) {
        // Whisper can emit a duplicate numeric suffix token right after a full
        // number (e.g. "2026" then "26"). Treat it as a duplicate, not a new
        // word, otherwise phrase matching for "2026 what" fails.
        prev.endIdx = i;
        continue;
      }

      if (shouldAttach) {
        // Continuation sub-token: append to previous group's text
        prev.text += t.text;
        prev.endIdx = i;
      } else {
        wordGroups.push({ text: t.text, t_dtw: t.t_dtw, endIdx: i });
      }
    }
  }

  for (let i = 0; i <= wordGroups.length - words.length; i++) {
    if (words.every((w, j) => normalize(wordGroups[i + j].text) === w)) {
      const from = wordGroups[i].t_dtw;
      const lastWord = wordGroups[i + words.length - 1];
      const lastEndIdx = lastWord.endIdx;
      const nextToken = tokens.slice(lastEndIdx + 1).find(t => !isSpecialToken(t));
      const rawTo = nextToken ? nextToken.t_dtw : (segEnd ?? lastWord.t_dtw + WORD_DURATION_ESTIMATE);
      // Use WhisperX word-end boundary (t_end) when available — it reflects the
      // actual spoken duration of the word rather than a fixed WORD_DURATION_ESTIMATE.
      // This is especially important for multi-syllable words where the next token
      // shares the same t_dtw (e.g. a punctuation token), which would otherwise
      // produce a clip too short to hear the full word.
      const lastTokenInPhrase = tokens[lastEndIdx];
      const wordEnd = lastTokenInPhrase.t_end ?? (lastWord.t_dtw + WORD_DURATION_ESTIMATE);
      const to = Math.max(rawTo, wordEnd);
      return { from, to };
    }
  }
  return null;
}

function buildWordGroups(tokens) {
  const groups = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (isSpecialToken(t) || normalize(t.text) === '') continue;
    if (groups.length === 0 || t.text.startsWith(' ')) {
      groups.push({ text: t.text, t_dtw: t.t_dtw });
    } else {
      groups[groups.length - 1].text += t.text;
    }
  }
  return groups;
}

function buildGraphicLine(graphic, tokens) {
  const wordGroups = buildWordGroups(tokens);
  let atValue;

  if (wordGroups.length) {
    let best = wordGroups[0];
    let bestDelta = Math.abs(best.t_dtw - graphic.at);
    for (const g of wordGroups) {
      const d = Math.abs(g.t_dtw - graphic.at);
      if (d < bestDelta) { bestDelta = d; best = g; }
    }
    const word = stripPunctuation(best.text).trim();
    const normalizedWord = word.toLowerCase();
    const groupIdx = wordGroups.indexOf(best);
    const occurrencesBefore = wordGroups
      .slice(0, groupIdx)
      .filter(g => normalize(g.text) === normalizedWord).length;
    atValue = occurrencesBefore > 0 ? `"${word}:${occurrencesBefore + 1}"` : `"${word}"`;
  } else {
    atValue = String(graphic.at);
  }

  const pairs = [`at=${atValue}`, `duration=${graphic.duration}`];
  for (const [k, v] of Object.entries(graphic.props)) {
    pairs.push(typeof v === 'string' ? `${k}="${v}"` : `${k}=${v}`);
  }
  return `> ${graphic.type}  ${pairs.join('  ')}`;
}

function buildInstructionsBlock() {
  return [
    '════════════════════════════════════════════════════════════════',
    '  TRANSCRIPT EDITOR  ─  Editing Guide',
    '════════════════════════════════════════════════════════════════',
    '',
    '  EDIT TEXT       Just retype any word. Changes are saved.',
    '',
    '  CUT WORD(S)     Wrap in curly braces:  {um}  {you know}',
    '                  Fine-tune cut timing:  {you know | 12.50, 14.20}',
    '                  (seconds from start of audio — overrides auto-detection)',
    '',
    '  CUT SEGMENT     Prefix the segment id with a minus sign:',
    '                    -[3]  original text...',
    '                  (legacy {[3] ...} and [3] CUT ... still work)',
    '',
    '  HOOK SEGMENT    Add > HOOK after a segment to prepend that clip before the',
    '                  video as a teaser (the clip still plays in its original',
    '                  position too):',
    '                    [7]  that exciting moment...',
    '                    > HOOK',
    '                  Quote a phrase to hook only those words, not the whole segment:',
    '                    [7]  that exciting moment...',
    '                    > HOOK "exciting moment"',
    '                  Add explicit from-to seconds to override token-derived timing:',
    '                    > HOOK "exciting moment" 12.450-15.300',
    '                  Timing is written back by merge-doc so you can always fine-tune it.',
    '                  Add char= to show a Techybara mascot alongside the caption:',
    '                    > HOOK "exciting moment" 12.450-15.300 char=techybara-holding-mic',
    '                  Add [path] to show a graphic image hovering above the caption:',
    '                    > HOOK "exciting moment" 12.450-15.300 [public/assets/logo/transparent-bg-logo.png]',
    '                  Multiple HOOK annotations play in document order.',
    '',
    '  RENAME SPEAKER  Edit the name after the colon in SPEAKERS below.',
    '',
    '  OVERRIDE SPEAKER Override the speaker for one segment:',
    '                    [10] SPEAKER: Alice  text...',
    '                  Or use an annotation (no inline text change needed):',
    '                    [10] text...',
    '                    > SPEAKER Alice',
    '',
    '  SPLIT SPEAKER   Change speaker mid-segment with > SPEAKER Name at="word".',
    '                  Splits the segment at that word — everything from the word',
    '                  onward becomes a new segment owned by the new speaker:',
    '                    [11] software engineer. I\'m Victoria, solutions engineer.',
    '                    > SPEAKER Victoria  at="I\'m"',
    '                  The split is permanent: on the next doc rebuild the two',
    '                  halves appear as separate numbered blocks.',
    '                  Speaker names must match the SPEAKERS section exactly.',
    '',
    '  CAMERA          Add a > CAM line after a segment to force a specific shot.',
    '                  Applies at the start of the segment, or at a specific word:',
    '                    [22] I\'m Natasha...',
    '                    > CAM Natasha',
    '                    [24] And today\'s topic...',
    '                    > CAM Saloni  at="topic"',
    '                    > CAM wide',
    '                  Speaker names must match the SPEAKERS section exactly.',
    '                  Multiple > CAM lines per segment are allowed.',
    '',
    '  GRAPHICS        Add a line starting with > after the segment:',
    '                    > LowerThird  at="word"  duration=5  name="Name"  title="Role"',
    '                    > Callout  at="word"  duration=5  text="Quote"',
    '                    > ChapterMarker  at="word"  duration=5',
    '',
    '  TRIM VIDEO       Place > START before the first segment to keep,',
    '                  and > END after the last segment to keep:',
    '                    > START',
    '                    [5] first segment you want...',
    '                    [12] last segment you want...',
    '                    > END',
    '                  Anything outside these markers is excluded.',
    '',
    '  SAVE EDITS       npm run merge-doc',
    '',
    '════════════════════════════════════════════════════════════════',
    '',
  ].join('\n');
}

function buildSpeakersSection(transcript) {
  const speakers = [...new Set(transcript.segments.map(s => s.speaker).filter(Boolean))].sort();
  if (!speakers.length) return '';
  return '# SPEAKERS\n' + speakers.map(s => `${s}: ${s}`).join('\n') + '\n\n---\n\n';
}

function buildDoc(transcript) {
  const instructions = buildInstructionsBlock();
  const speakersSection = buildSpeakersSection(transcript);

  const lines = [];
  let lastSpeaker = null;

  const { videoStart, videoEnd } = transcript.meta;

  for (const seg of transcript.segments) {
    const speaker = seg.speaker || 'SPEAKER';

    if (speaker !== lastSpeaker) {
      if (lastSpeaker !== null) lines.push('');
      lines.push(`=== ${speaker} ===`);
      lines.push('');
      lastSpeaker = speaker;
    }

    if (videoStart !== undefined && seg.start === videoStart) lines.push('> START');

    const text = cleanCaptionText(buildTextWithCuts(seg));
    let segLine = `${seg.cut ? '-' : ''}[${seg.id}]`;
    if (text) segLine += `  ${text}`;
    lines.push(segLine);

    if (seg.hook) {
      let hookLine = '    > HOOK';
      if (seg.hookPhrase) hookLine += ` "${seg.hookPhrase}"`;
      if (seg.hookFrom !== undefined && seg.hookTo !== undefined) {
        hookLine += ` ${seg.hookFrom.toFixed(3)}-${seg.hookTo.toFixed(3)}`;
      }
      if (seg.hookChar)    hookLine += ` char=${seg.hookChar}`;
      if (seg.hookGraphic) hookLine += ` [${seg.hookGraphic}]`;
      lines.push(hookLine);
    }
    for (const cam of (seg.cameraCues || [])) {
      lines.push('    ' + buildCameraLine(cam, seg.tokens, seg.start));
    }
    for (const g of (seg.graphics || [])) {
      lines.push('    ' + buildGraphicLine(g, seg.tokens));
    }
    for (const vc of (seg.visualCuts || [])) {
      lines.push(`    > CUT ${vc.from.toFixed(3)}-${vc.to.toFixed(3)}`);
    }

    if (videoEnd !== undefined && seg.end === videoEnd) lines.push('> END');
  }

  return instructions + speakersSection + lines.join('\n') + '\n';
}

// ─── Doc merge ────────────────────────────────────────────────────────────────

function parseKv(str) {
  const result = {};
  const re = /(\w+)=(?:"([^"]*)"|(\S+))/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    result[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  return result;
}

/**
 * Parse the text after "> CAM " into a CameraCue.
 * Format: "SpeakerName" | "wide"  [at="word"]
 * `segStart` is used as the default `at` when no at= attribute is present.
 */
function parseCameraLine(line, tokens, segStart) {
  const spaceIdx = line.search(/\s/);
  const target = spaceIdx === -1 ? line : line.slice(0, spaceIdx);
  const kvStr  = spaceIdx === -1 ? '' : line.slice(spaceIdx);
  const kv = parseKv(kvStr);

  let at = segStart;
  if (kv.at !== undefined) {
    const raw = kv.at;
    const colonIdx = raw.lastIndexOf(':');
    let phrase, occurrence;
    if (colonIdx > 0 && !isNaN(raw.slice(colonIdx + 1))) {
      phrase = raw.slice(0, colonIdx);
      occurrence = parseInt(raw.slice(colonIdx + 1)) - 1;
    } else {
      phrase = raw;
      occurrence = 0;
    }
    if (occurrence === 0) {
      const tokenIdx = resolvePhraseToFirstTokenIndex(phrase, tokens);
      at = tokenIdx !== -1 ? tokens[tokenIdx].t_dtw : (parseFloat(raw) || segStart);
    } else {
      const matches = tokens.filter(t => normalize(t.text) === phrase.toLowerCase());
      const token = matches[occurrence] ?? null;
      at = token ? token.t_dtw : (parseFloat(raw) || segStart);
    }
  }

  const shot = target.toLowerCase() === 'wide' ? 'wide' : 'closeup';
  return { shot, ...(shot === 'closeup' ? { speaker: target } : {}), at };
}

/**
 * Serialise a CameraCue back to a > CAM doc line.
 * Omits at= when the cue fires at the very start of the segment.
 */
function buildCameraLine(cue, tokens, segStart) {
  const target = cue.shot === 'wide' ? 'wide' : cue.speaker;
  if (!tokens.length || Math.abs(cue.at - segStart) < 0.05) {
    return `> CAM ${target}`;
  }
  const wordGroups = buildWordGroups(tokens);
  let atValue;
  if (wordGroups.length) {
    let best = wordGroups[0];
    let bestDelta = Math.abs(best.t_dtw - cue.at);
    for (const g of wordGroups) {
      const d = Math.abs(g.t_dtw - cue.at);
      if (d < bestDelta) { bestDelta = d; best = g; }
    }
    const word = stripPunctuation(best.text).trim();
    const normalizedWord = word.toLowerCase();
    const groupIdx = wordGroups.indexOf(best);
    const occurrencesBefore = wordGroups
      .slice(0, groupIdx)
      .filter(g => normalize(g.text) === normalizedWord).length;
    atValue = occurrencesBefore > 0 ? `"${word}:${occurrencesBefore + 1}"` : `"${word}"`;
  } else {
    atValue = String(cue.at);
  }
  return `> CAM ${target}  at=${atValue}`;
}

function parseGraphicLine(line, tokens, segStart = 0) {
  const spaceIdx = line.search(/\s/);
  const type = spaceIdx === -1 ? line : line.slice(0, spaceIdx);
  const kvStr = spaceIdx === -1 ? '' : line.slice(spaceIdx);
  const kv = parseKv(kvStr);

  // Resolve at="word" or at="word:2" to absolute seconds via token t_dtw.
  // Uses word-group matching so contractions (e.g. "I'm" → [" I", "'m"]) resolve correctly.
  let at = segStart;
  if (kv.at !== undefined) {
    const raw = kv.at;
    const colonIdx = raw.lastIndexOf(':');
    let phrase, occurrence;

    if (colonIdx > 0 && !isNaN(raw.slice(colonIdx + 1))) {
      phrase = raw.slice(0, colonIdx);
      occurrence = parseInt(raw.slice(colonIdx + 1)) - 1;
    } else {
      phrase = raw;
      occurrence = 0;
    }

    if (occurrence === 0) {
      const tokenIdx = resolvePhraseToFirstTokenIndex(phrase, tokens);
      at = tokenIdx !== -1 ? tokens[tokenIdx].t_dtw : (parseFloat(raw) || segStart);
    } else {
      const matches = tokens.filter(t => normalize(t.text) === phrase.toLowerCase());
      const token = matches[occurrence] ?? null;
      at = token ? token.t_dtw : (parseFloat(raw) || segStart);
    }
  }

  const duration = parseFloat(kv.duration) || 5;
  const props = {};
  for (const [k, v] of Object.entries(kv)) {
    if (k !== 'at' && k !== 'duration') props[k] = v;
  }

  return { type, at, duration, props };
}

function applyTextPartsToTokens(rawText, tokens) {
  // Reset cut flags and any stored time overrides — doc is the source of truth.
  const updated = tokens.map((token) => {
    const clean = { ...token };
    delete clean._cutFrom;
    delete clean._cutTo;
    return { ...clean, cut: false };
  });

  // Find every {span} marker and search for it in word tokens only.
  // Supports optional explicit time override: {text | from, to}
  // Word tokens are non-special tokens with non-empty normalized text (i.e. not
  // bare punctuation like "." or ","). Searching only word tokens lets the user
  // write {Oh so that would be nice Oh} even when Whisper emitted "," or "."
  // tokens between those words. The cut range is then extended to include:
  //   • all non-word tokens between the first and last matched word token, and
  //   • any immediately following tokens that share the same t_dtw or have no
  //     leading space (Whisper sometimes emits duplicate tokens at the same time).
  const re = /\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(rawText)) !== null) {
    const content = m[1];
    const markerWordPos = rawText
      .slice(0, m.index)
      .replace(/\{[^}]*\}/g, ' ')
      .split(/\s+/)
      .filter(Boolean).length;

    // Parse optional explicit time override: {text | from, to}
    let textSpan = content;
    let explicitFrom = null;
    let explicitTo = null;
    const pipeIdx = content.indexOf('|');
    if (pipeIdx >= 0) {
      textSpan = content.slice(0, pipeIdx).trim();
      const timeMatch = content.slice(pipeIdx + 1).trim().match(/^([\d.]+)\s*,\s*([\d.]+)$/);
      if (timeMatch) {
        explicitFrom = parseFloat(timeMatch[1]);
        explicitTo = parseFloat(timeMatch[2]);
      }
    }

    const cutWords = textSpan.split(/\s+/).filter(Boolean).map(w => normalize(w)).filter(Boolean);
    if (!cutWords.length) {
      // Span is purely punctuation/disfluency (e.g. {--}). Match by raw text against
      // disfluency tokens so the user can cut them from the doc.
      const rawSpan = textSpan.trim();
      const idx = updated.findIndex(t => !t.cut && !isSpecialToken(t) && isDisfluencyToken(t) && t.text.trim() === rawSpan);
      if (idx >= 0) {
        updated[idx] = { ...updated[idx], cut: true };
        if (explicitFrom !== null) updated[idx] = { ...updated[idx], _cutFrom: explicitFrom };
        if (explicitTo !== null) updated[idx] = { ...updated[idx], _cutTo: explicitTo };
      }
      continue;
    }

    // Group BPE sub-tokens into whole words before matching so that contractions
    // like "I'm" (tokenised as [" I", "'m"]) match {I'm} written in the doc.
    const wordGroups = [];
    for (let gi = 0; gi < updated.length; gi++) {
      const t = updated[gi];
      if (isSpecialToken(t) || normalize(t.text) === '') continue;
      if (t.text.startsWith(' ') || wordGroups.length === 0) {
        wordGroups.push({ text: t.text, firstIdx: gi, lastIdx: gi, lastTdtw: t.t_dtw });
      } else {
        const g = wordGroups[wordGroups.length - 1];
        g.text += t.text;
        g.lastIdx = gi;
        g.lastTdtw = t.t_dtw;
      }
    }

    const candidateStarts = [];
    for (let i = 0; i <= wordGroups.length - cutWords.length; i++) {
      const matches = cutWords.every((w, j) => normalize(wordGroups[i + j].text) === w);
      if (matches) candidateStarts.push(i);
    }

    if (candidateStarts.length > 0) {
      const chosenStart = candidateStarts.reduce((best, cand) => {
        const bestDelta = Math.abs(best - markerWordPos);
        const candDelta = Math.abs(cand - markerWordPos);
        return candDelta < bestDelta ? cand : best;
      }, candidateStarts[0]);
      const firstIdx = wordGroups[chosenStart].firstIdx;
      const lastWordIdx = wordGroups[chosenStart + cutWords.length - 1].lastIdx;
      const lastTdtw = wordGroups[chosenStart + cutWords.length - 1].lastTdtw;

      // Extend past adjacent tokens that are BPE continuations (no leading space)
      // or share the same t_dtw (Whisper duplicate tokens at identical timestamps).
      let cutEndIdx = lastWordIdx;
      let k = lastWordIdx + 1;
      while (k < updated.length && !isSpecialToken(updated[k])) {
        if (!updated[k].text.startsWith(' ') || updated[k].t_dtw === lastTdtw) {
          cutEndIdx = k; k++;
        } else { break; }
      }

      for (let k = firstIdx; k <= cutEndIdx; k++) {
        if (!isSpecialToken(updated[k])) updated[k] = { ...updated[k], cut: true };
      }
      // Store explicit time overrides on the boundary tokens so deriveCuts can use them.
      if (explicitFrom !== null) updated[firstIdx] = { ...updated[firstIdx], _cutFrom: explicitFrom };
      if (explicitTo !== null) updated[cutEndIdx] = { ...updated[cutEndIdx], _cutTo: explicitTo };
    }
  }

  // Apply word-level text corrections: align visible (non-cut) words from doc
  // with non-cut, non-special tokens and update token.text so corrections persist.
  const visibleWords = rawText.replace(/\{[^}]+\}/g, ' ').replace(/\s+/g, ' ').trim().split(/\s+/).filter(Boolean);

  // Build word groups from non-cut, non-special tokens (BPE-aware, same approach as
  // wordGroups built for cut matching above). Each group represents one visible word.
  const twg = []; // token word groups: { normText, firstIdx, lastIdx }
  for (let i = 0; i < updated.length; i++) {
    const t = updated[i];
    if (isSpecialToken(t) || t.cut || normalize(t.text) === '') continue;
    if (t.text.startsWith(' ') || twg.length === 0) {
      twg.push({ normText: normalize(t.text), firstIdx: i, lastIdx: i });
    } else {
      twg[twg.length - 1].normText += normalize(t.text);
      twg[twg.length - 1].lastIdx = i;
    }
  }

  if (visibleWords.length > 0 && twg.length > 0) {
    if (visibleWords.length === twg.length) {
      // Counts match: use the original positional alignment.
      // This is the common case — it handles Whisper spelling quirks (e.g. "wrold"
      // in a token when the doc has the correct spelling "world") without requiring
      // the doc word and the token to normalize to the same string.
      visibleWords.forEach((word, wi) => {
        const g = twg[wi];
        // Skip when the doc word and the token group already normalize to the same
        // string — no user correction was made. Writing the combined word (e.g.
        // "That's") to only the firstIdx token (e.g. " That") while its BPE
        // continuation "'s" remains as a separate token produces "That's's" in
        // captions on subsequent runs.
        if (normalize(word) === g.normText) return;
        const idx = g.firstIdx;
        const prefix = updated[idx].text.startsWith(' ') ? ' ' : '';
        updated[idx] = { ...updated[idx], text: prefix + word };
      });
    } else {
      // Counts differ: use LCS alignment.
      // When doc has MORE words than tokens (D > G), Whisper's DTW dropped a word.
      // Find the longest common subsequence so the matching words still get text
      // corrections, and synthesize new tokens for the unmatched doc words so they
      // receive a t_dtw and appear in captions.
      // When doc has FEWER words (D < G), some tokens have no corresponding doc word
      // (e.g. user removed text without adding a cut marker). LCS pairs the surviving
      // doc words to the correct tokens rather than positionally misaligning them.
      const D = visibleWords.length, G = twg.length;
      const dp = Array.from({ length: D + 1 }, () => new Array(G + 1).fill(0));
      for (let i = 1; i <= D; i++) {
        for (let j = 1; j <= G; j++) {
          dp[i][j] = normalize(visibleWords[i - 1]) === twg[j - 1].normText
            ? dp[i - 1][j - 1] + 1
            : Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
      // Backtrack to get (docIdx, groupIdx) matched pairs
      const pairs = [];
      for (let i = D, j = G; i > 0 && j > 0;) {
        if (normalize(visibleWords[i - 1]) === twg[j - 1].normText) {
          pairs.unshift({ docIdx: i - 1, groupIdx: j - 1 });
          i--; j--;
        } else if (dp[i - 1][j] >= dp[i][j - 1]) { i--; } else { j--; }
      }

      const docToGrp = new Map(pairs.map(p => [p.docIdx, p.groupIdx]));

      // Apply text corrections for matched words (preserving leading space for BPE).
      // Skip when already matching to avoid writing combined BPE words (e.g. "That's")
      // to only the first sub-token while the continuation dangles separately.
      for (const { docIdx, groupIdx } of pairs) {
        const g = twg[groupIdx];
        if (normalize(visibleWords[docIdx]) === g.normText) continue;
        const idx = g.firstIdx;
        const prefix = updated[idx].text.startsWith(' ') ? ' ' : '';
        updated[idx] = { ...updated[idx], text: prefix + visibleWords[docIdx] };
      }

      // Synthesize tokens for doc words that have no matching token (Whisper DTW drop).
      // Work backwards so splices don't shift indices of earlier insertions.
      for (let di = visibleWords.length - 1; di >= 0; di--) {
        if (docToGrp.has(di)) continue;

        // Find neighbouring matched groups for t_dtw interpolation
        let prevTdtw = null, nextTdtw = null;
        for (let pi = di - 1; pi >= 0; pi--) {
          if (docToGrp.has(pi)) { prevTdtw = updated[twg[docToGrp.get(pi)].lastIdx].t_dtw; break; }
        }
        for (let ni = di + 1; ni < visibleWords.length; ni++) {
          if (docToGrp.has(ni)) { nextTdtw = updated[twg[docToGrp.get(ni)].firstIdx].t_dtw; break; }
        }
        const t_dtw = prevTdtw !== null && nextTdtw !== null
          ? (prevTdtw + nextTdtw) / 2
          : prevTdtw !== null ? prevTdtw + 0.05
          : nextTdtw !== null ? Math.max(0, nextTdtw - 0.05)
          : 0;

        // Insertion point: right after the prev matched group's last token
        let prevGrpIdx = null, nextGrpIdx = null;
        for (let pi = di - 1; pi >= 0; pi--) {
          if (docToGrp.has(pi)) { prevGrpIdx = docToGrp.get(pi); break; }
        }
        for (let ni = di + 1; ni < visibleWords.length; ni++) {
          if (docToGrp.has(ni)) { nextGrpIdx = docToGrp.get(ni); break; }
        }
        const insertAt = prevGrpIdx !== null ? twg[prevGrpIdx].lastIdx + 1
          : nextGrpIdx !== null             ? twg[nextGrpIdx].firstIdx
          : updated.length;

        updated.splice(insertAt, 0, { t_dtw, text: ' ' + visibleWords[di], cut: false, cutReason: null });

        // Shift twg firstIdx/lastIdx for all groups after the insertion point
        for (const g of twg) {
          if (g.firstIdx >= insertAt) g.firstIdx++;
          if (g.lastIdx >= insertAt) g.lastIdx++;
        }
      }
    }
  }

  return updated;
}

function parseSpeakerRenames(docContent) {
  const match = docContent.match(/^#\s*SPEAKERS\s*\n([\s\S]*?)\n---/m);
  if (!match) return {};
  const map = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const from = line.slice(0, colonIdx).trim();
    const to = line.slice(colonIdx + 1).trim();
    if (from && to && from !== to) map[from] = to;
  }
  return map;
}

function stripSpeakersSection(docContent) {
  // Strip everything from the start through the --- separator
  // (covers both the instructions block and the SPEAKERS section)
  return docContent.replace(/^[\s\S]*?\n---[ \t]*\n+/m, '');
}

function mergeDocIntoTranscript(transcript, docContent) {
  const renames = parseSpeakerRenames(docContent);
  const stripped = stripSpeakersSection(docContent);

  const byId = Object.fromEntries(transcript.segments.map(s => [s.id, s]));
  const syntheticSegsAfter = {};
  let nextSyntheticId = Math.max(0, ...transcript.segments.map(s => s.id)) + 1;
  let applied = 0;
  let currentSpeaker = null;
  let pendingSeg = null;
  let pendingGraphicLines = [];
  let pendingCamLines = [];
  let pendingHookLine = null;
  let pendingVisualCuts = [];
  let pendingSpeakerSplits = [];
  let videoStart = transcript.meta.videoStart;
  let videoEnd = transcript.meta.videoEnd;
  let nextSegIsVideoStart = false;

  function flushPending() {
    if (!pendingSeg) return;
    const graphics   = pendingGraphicLines.map(l => parseGraphicLine(l, pendingSeg.tokens, pendingSeg.start));
    const cameraCues = pendingCamLines.map(l => parseCameraLine(l, pendingSeg.tokens, pendingSeg.start));
    let hook = false, hookPhrase = null, hookFrom, hookTo, hookChar = null, hookGraphic = null;
    if (pendingHookLine !== null) {
      hook = true;
      const phraseMatch  = pendingHookLine.match(/^"([^"]*)"/);
      const charMatch    = pendingHookLine.match(/char=([^\s\[]+)/);
      const graphicMatch = pendingHookLine.match(/\[([^\]]+)\]/);
      // Strip bracketed graphic path before matching timing to avoid false digit matches
      const lineForTiming = pendingHookLine.replace(/\[[^\]]*\]/, '');
      const timingMatch  = lineForTiming.match(/(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/);
      if (phraseMatch)  hookPhrase  = phraseMatch[1];
      if (charMatch)    hookChar    = charMatch[1];
      if (graphicMatch) hookGraphic = graphicMatch[1];
      if (timingMatch) {
        // Explicit timing overrides token resolution
        hookFrom = parseFloat(timingMatch[1]);
        hookTo   = parseFloat(timingMatch[2]);
      } else if (hookPhrase) {
        const range = resolvePhraseToTimeRange(hookPhrase, pendingSeg.tokens, pendingSeg.end);
        if (range) { hookFrom = range.from; hookTo = range.to; }
        else console.warn(`  ⚠ HOOK phrase not found in segment [${pendingSeg.id}]: "${hookPhrase}" — hooking full segment`);
      }
    }
    byId[pendingSeg.id] = { ...pendingSeg, hook, hookPhrase, hookFrom, hookTo, hookChar, hookGraphic, graphics, cameraCues, visualCuts: pendingVisualCuts.length ? [...pendingVisualCuts] : (pendingSeg.visualCuts ?? []) };

    for (const splitStr of pendingSpeakerSplits) {
      const nameMatch = splitStr.match(/^(\S+)/);
      if (!nameMatch) continue;
      const newSpeaker = renames[nameMatch[1]] ?? nameMatch[1];
      const kv = parseKv(splitStr.slice(nameMatch[1].length));

      if (!kv.at) {
        byId[pendingSeg.id] = { ...byId[pendingSeg.id], speaker: newSpeaker };
        continue;
      }

      const parentSeg = byId[pendingSeg.id];
      const splitIdx = resolvePhraseToFirstTokenIndex(kv.at, parentSeg.tokens);
      if (splitIdx === -1) {
        console.warn(`  ⚠ SPEAKER split word "${kv.at}" not found in segment [${parentSeg.id}]`);
        continue;
      }

      const tokensA = parentSeg.tokens.slice(0, splitIdx);
      const tokensB = parentSeg.tokens.slice(splitIdx);
      const splitTime = tokensB[0]?.t_dtw ?? parentSeg.end;
      const textA = fixContractions(joinTokenTexts(tokensA.filter(t => !isSpecialToken(t)))).trim();
      const textB = fixContractions(joinTokenTexts(tokensB.filter(t => !isSpecialToken(t)))).trim();

      byId[parentSeg.id] = { ...parentSeg, tokens: tokensA, end: splitTime, text: textA };

      const synthId = nextSyntheticId++;
      const synthSeg = {
        ...parentSeg,
        id: synthId,
        speaker: newSpeaker,
        tokens: tokensB,
        start: splitTime,
        text: textB,
        cut: false,
        hook: false, hookPhrase: null, hookFrom: undefined, hookTo: undefined,
        hookChar: null, hookGraphic: null,
        graphics: [], cameraCues: [], visualCuts: [], cuts: [],
      };
      if (!syntheticSegsAfter[parentSeg.id]) syntheticSegsAfter[parentSeg.id] = [];
      syntheticSegsAfter[parentSeg.id].push(synthSeg);
    }

    pendingSeg = null;
    pendingGraphicLines = [];
    pendingCamLines = [];
    pendingHookLine = null;
    pendingVisualCuts = [];
    pendingSpeakerSplits = [];
  }

  for (const line of stripped.split('\n')) {
    const trimmed = line.trim();

    // Speaker group header: === Speaker Name ===
    const speakerMatch = trimmed.match(/^===\s+(.+?)\s+===$/);
    if (speakerMatch) {
      flushPending();
      const rawSpeaker = speakerMatch[1];
      currentSpeaker = renames[rawSpeaker] ?? rawSpeaker;
      continue;
    }

    // Special trim markers: > START / > END
    if (trimmed === '> START') {
      nextSegIsVideoStart = true;
      continue;
    }
    if (trimmed === '> END') {
      if (pendingSeg) videoEnd = pendingSeg.end;
      continue;
    }

    // Annotation line: > CAM ... | > HOOK ... | > GraphicType ...
    if (trimmed.startsWith('>')) {
      const annotation = trimmed.slice(1).trim();
      if (annotation.startsWith('CAM')) {
        if (pendingSeg) pendingCamLines.push(annotation.slice(3).trim());
      } else if (annotation.startsWith('HOOK')) {
        if (pendingSeg) pendingHookLine = annotation.slice(4).trim();
      } else if (annotation.startsWith('SPEAKER')) {
        if (pendingSeg) pendingSpeakerSplits.push(annotation.slice(7).trim());
      } else if (annotation.startsWith('CUT')) {
        if (pendingSeg) {
          const timeMatch = annotation.slice(3).trim().match(/^([\d.]+)-([\d.]+)$/);
          if (timeMatch) pendingVisualCuts.push({ from: parseFloat(timeMatch[1]), to: parseFloat(timeMatch[2]) });
        }
      } else {
        if (pendingSeg) pendingGraphicLines.push(annotation);
      }
      continue;
    }

    // Segment line: [N] text, -[N] text, {[N] text}, or [N] CUT text (legacy)
    const braceSegMatch = trimmed.match(/^\{(\[(\d+)\].*)\}$/);
    const minusSegMatch = trimmed.match(/^-\[(\d+)\](.*)/);
    const segMatch = braceSegMatch
      ? braceSegMatch[1].match(/^\[(\d+)\](.*)/)
      : (minusSegMatch || trimmed.match(/^\[(\d+)\](.*)/));
    const isBraceCut = !!braceSegMatch;
    const isMinusCut = !!minusSegMatch;
    if (segMatch) {
      flushPending();
      const id = parseInt(segMatch[1]);
      const seg = byId[id];
      if (!seg) continue;

      let rest = segMatch[2].trim();
      let cut = isBraceCut || isMinusCut;
      let inlineSpeaker = null;

      // Legacy syntax: [N] CUT  text
      const cutMatch = !isBraceCut ? rest.match(/^CUT(?::\w+)?\s*(.*)/i) : null;
      if (cutMatch) {
        cut = true;
        rest = cutMatch[1];
      }

      const speakerMatch = rest.match(/^SPEAKER:\s*(\S+)\s*(.*)/i);
      if (speakerMatch) {
        inlineSpeaker = renames[speakerMatch[1]] ?? speakerMatch[1];
        rest = speakerMatch[2];
      }

      const rawText = rest;
      const tokens = applyTextPartsToTokens(rawText, seg.tokens);
      const cleanText = rawText.replace(/\{[^}]+\}/g, '').replace(/\s{2,}/g, ' ').trim();
      const speaker = inlineSpeaker ?? currentSpeaker ?? seg.speaker;

      if (nextSegIsVideoStart) {
        videoStart = seg.start;
        nextSegIsVideoStart = false;
      }

      pendingSeg = { ...seg, speaker, cut, text: cleanText, tokens };
      applied++;
      continue;
    }
  }

  flushPending();

  if (Object.keys(renames).length) {
    console.log(`  Speaker renames: ${Object.entries(renames).map(([k, v]) => `${k} → ${v}`).join(', ')}`);
  }
  if (videoStart !== transcript.meta.videoStart) console.log(`  Video start: ${videoStart}s`);
  if (videoEnd !== transcript.meta.videoEnd) console.log(`  Video end: ${videoEnd}s`);
  console.log(`  ${applied} segments merged.`);
  const outSegments = [];
  for (const s of transcript.segments) {
    outSegments.push(byId[s.id] ?? s);
    for (const syn of (syntheticSegsAfter[s.id] ?? [])) outSegments.push(syn);
  }
  return {
    ...transcript,
    meta: { ...transcript.meta, videoStart, videoEnd },
    segments: outSegments,
  };
}

// ─── Pause auto-cut ───────────────────────────────────────────────────────────

/**
 * Marks disfluency tokens (e.g. "--") as cut:true so their audio is removed
 * and they appear as {--} in the doc. Applied before merging with existing so
 * a user can manually override by un-cutting one in the doc.
 */
function autoCutDisfluencies(segments) {
  return segments.map(seg => ({
    ...seg,
    tokens: seg.tokens.map(t => isDisfluencyToken(t) ? { ...t, cut: true } : t),
  }));
}

// Estimated spoken duration of a word in seconds. The gap between two adjacent
// token t_dtw values covers the word's audio plus following silence; subtracting
// this estimate isolates the silence portion for pause-cut threshold checks.
const WORD_DURATION_ESTIMATE = 0.4;

/**
 * Adds time-range cuts to cuts[] for silence gaps between tokens that exceed
 * the threshold (seconds). Applied after deriveCuts so it doesn't conflict
 * with token-level cut flags. Existing pause cuts are replaced on each run.
 */
function autoCutPauses(transcript, threshold) {
  return {
    ...transcript,
    segments: transcript.segments.map(seg => {
      // Only consider non-cut, non-special tokens for gap detection.
      // Also exclude tokens whose t_dtw falls inside an existing cut range — such
      // tokens are already removed by a time-range cut (e.g. an explicit _cutFrom/_cutTo
      // override) even though their token-level cut flag is false.
      const activeTokens = seg.tokens.filter(t => {
        if (t.cut || isSpecialToken(t)) return false;
        return !seg.cuts.some(c => t.t_dtw > c.from && t.t_dtw < c.to);
      });
      const pauseCuts = [];

      for (let i = 0; i < activeTokens.length - 1; i++) {
        const curr = activeTokens[i];
        const next = activeTokens[i + 1];
        // Use exact word-end boundary when available (WhisperX t_end), otherwise
        // estimate word end as t_dtw + WORD_DURATION_ESTIMATE.
        const wordEnd = curr.t_end !== undefined ? curr.t_end : curr.t_dtw + WORD_DURATION_ESTIMATE;
        const silence = next.t_dtw - wordEnd;
        if (silence >= threshold) {
          pauseCuts.push({ from: wordEnd, to: next.t_dtw });
        }
      }

      if (!pauseCuts.length) return seg;

      // Merge consecutive pause cuts whose gap is at most WORD_DURATION_ESTIMATE.
      // When a word's entire play window is sandwiched between two pause cuts it
      // produces a jarring micro-clip; absorb it into a single cut instead.
      // Gap = next cut's `from` (word end) minus this cut's `to` (next word start)
      // — a short gap means the word between them is too short to keep.
      const merged = [{ ...pauseCuts[0] }];
      for (let i = 1; i < pauseCuts.length; i++) {
        const last = merged[merged.length - 1];
        const wordDur = pauseCuts[i].from - last.to;
        if (wordDur <= WORD_DURATION_ESTIMATE) {
          last.to = pauseCuts[i].to;
        } else {
          merged.push({ ...pauseCuts[i] });
        }
      }

      // Merge token-derived cuts with pause cuts, sorted by time
      const allCuts = [...seg.cuts, ...merged]
        .sort((a, b) => a.from - b.from);

      return { ...seg, cuts: allCuts };
    }),
  };
}

// ─── VTT helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the list of sub-clips (start/end pairs) for a segment after removing
 * its cuts — identical logic to cut-preview.js so the VTT timeline matches the
 * rendered video exactly.
 */
function getSubClips(segment) {
  const clips = [];
  let cursor = segment.start;
  const sorted = [...(segment.cuts || [])].sort((a, b) => a.from - b.from);
  for (const cut of sorted) {
    if (cut.from > cursor) clips.push({ start: cursor, end: cut.from });
    cursor = cut.to;
  }
  if (cursor < segment.end) clips.push({ start: cursor, end: segment.end });
  return clips;
}

function secondsToVttTs(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(3);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(6, '0')}`;
}

function cleanCaptionText(text) {
  return text.replace(/_[A-Z]+_/g, '').replace(/\s{2,}/g, ' ').trim();
}

function getHookClips(seg) {
  if (seg.hookFrom !== undefined && seg.hookTo !== undefined) {
    return [{ start: seg.hookFrom, end: seg.hookTo }];
  }
  return getSubClips(seg);
}

function buildSentencesVtt(segments, meta = {}) {
  const { videoStart, videoEnd } = meta;
  const lines = ['WEBVTT', ''];
  let runningOffset = 0;

  function emitSeg(seg) {
    const clips = getSubClips(seg);
    const duration = clips.reduce((sum, c) => sum + (c.end - c.start), 0);
    const text = cleanCaptionText(seg.text);
    if (text) {
      lines.push(`${secondsToVttTs(runningOffset)} --> ${secondsToVttTs(runningOffset + duration)}`);
      lines.push(text);
      lines.push('');
    }
    runningOffset += duration;
  }

  // Hook segments first (in document order), before the main content
  for (const seg of segments) {
    if (!seg.hook || seg.cut) continue;
    const clips = getHookClips(seg);
    const duration = clips.reduce((sum, c) => sum + (c.end - c.start), 0);
    const text = cleanCaptionText(seg.hookPhrase ?? seg.text);
    if (text) {
      lines.push(`${secondsToVttTs(runningOffset)} --> ${secondsToVttTs(runningOffset + duration)}`);
      lines.push(text);
      lines.push('');
    }
    runningOffset += duration;
  }

  // Main content (respecting videoStart/videoEnd trim, hooks already emitted above)
  for (const seg of segments) {
    if (seg.hook) continue;
    if (videoStart !== undefined && seg.end <= videoStart) continue;
    if (videoEnd !== undefined && seg.start >= videoEnd) continue;
    if (seg.cut) continue;
    emitSeg(seg);
  }

  return lines.join('\n');
}

function buildSentencesSrt(segments, meta = {}) {
  return convertVttToSrt(buildSentencesVtt(segments, meta));
}

function parseVtt(content) {
  const segments = [];
  const lines = content.split('\n');
  let i = 0;
  while (i < lines.length) {
    const match = lines[i].trim().match(
      /(\d{2}:\d{2}:\d{2}[.,]\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}[.,]\d{3})/
    );
    if (match) {
      const start = vttTsToSeconds(match[1]);
      const end = vttTsToSeconds(match[2]);
      const textLines = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(lines[i].trim());
        i++;
      }
      segments.push({ start, end, text: textLines.join(' ') });
    } else { i++; }
  }
  return segments;
}

function vttTsToSeconds(ts) {
  const [hh, mm, ss] = ts.replace(',', '.').split(':');
  return parseInt(hh) * 3600 + parseInt(mm) * 60 + parseFloat(ss);
}

function applyVttCorrections(transcript, vttSegments) {
  for (const vttSeg of vttSegments) {
    let best = null;
    let bestDelta = Infinity;
    for (const seg of transcript.segments) {
      const delta = Math.abs(seg.start - vttSeg.start);
      if (delta < bestDelta) { bestDelta = delta; best = seg; }
    }
    if (best && bestDelta < 1.0) best.text = vttSeg.text;
  }
  return transcript;
}

// ─── Edit-transcript re-run helpers ───────────────────────────────────────────

/**
 * Builds a t_dtw → token lookup for the "preserve manual edits" merge in
 * edit-transcript re-runs. When multiple tokens share the same t_dtw — which
 * Whisper commonly does for punctuation tokens that inherit the preceding
 * word's timestamp — the token with non-empty normalized text (a real word)
 * is preferred over a pure-punctuation token so that word text corrections
 * are not overwritten with punctuation characters on the next re-run.
 */
function buildPrevTokensByTdtw(tokens) {
  // Key = "<t_dtw>_<position>" where position is the 0-based index of this token
  // among all tokens sharing the same t_dtw. This lets each token (including
  // multiple word tokens at the same timestamp, and BPE sub-tokens) map to its
  // own counterpart rather than all colliding on the first entry.
  const map = {};
  const countByBase = {};
  for (const t of tokens) {
    const base = t.t_dtw.toFixed(3);
    const n = countByBase[base] ?? 0;
    map[`${base}_${n}`] = t;
    countByBase[base] = n + 1;
  }
  return map;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const cwd = process.cwd();
  const cli = parseArgs();

  const rawPath = cli.rawPath || path.join(cwd, 'public', 'transcribe', 'output', 'raw', 'transcript.raw.json');
  const outputPath = cli.outputPath || path.join(cwd, 'public', 'transcribe', 'output', 'edit', 'transcript.json');
  const docPath = outputPath.replace(/\.json$/, '.doc.txt');

  if (!await fs.pathExists(rawPath)) {
    console.error(`❌ Raw transcript not found: ${rawPath}`);
    console.error('   Run "npm run transcribe" first.');
    process.exit(1);
  }

  const raw = await fs.readJson(rawPath);

  // Merge raw whisper segments into sentences; auto-cut disfluency tokens (e.g. "--")
  const sentenceSegments = autoCutDisfluencies(mergeIntoSentences(raw.segments));
  let transcript = { ...raw, segments: sentenceSegments };

  // If transcript.json already exists, preserve manual edits.
  // Match by start time (within 0.5 s) rather than by ID so that
  // re-segmentation (e.g. new speaker-boundary breaks) doesn't misalign edits.
  if (await fs.pathExists(outputPath)) {
    const existing = await fs.readJson(outputPath);

    // Build a fast lookup: round start to 100 ms bucket → segment
    const byRoundedStart = {};
    for (const s of existing.segments) {
      byRoundedStart[s.start.toFixed(1)] = s;
    }
    function findPrev(seg) {
      const exact = byRoundedStart[seg.start.toFixed(1)];
      if (exact) return exact;
      // Fallback: nearest within 0.5 s
      let best = null, bestDelta = 0.5;
      for (const s of existing.segments) {
        const d = Math.abs(s.start - seg.start);
        if (d < bestDelta) { bestDelta = d; best = s; }
      }
      return best;
    }

    const matchedExistingIds = new Set();

    transcript = {
      ...transcript,
      meta: { ...transcript.meta, ...existing.meta },
      segments: transcript.segments.map(seg => {
        const prev = findPrev(seg);
        if (!prev) return seg;
        matchedExistingIds.add(prev.id);

        const prevTokensByTdtw = buildPrevTokensByTdtw(prev.tokens || []);
        const rawCountByBase = {};
        const tokens = seg.tokens.map(t => {
          const base = t.t_dtw.toFixed(3);
          const n = rawCountByBase[base] ?? 0;
          rawCountByBase[base] = n + 1;
          const p = prevTokensByTdtw[`${base}_${n}`];
          if (!p) return t;
          // Only apply text correction when both the raw token and the stored token
          // represent a real word (non-empty normalize). Pure punctuation tokens
          // (e.g. ".") must not inherit corrections intended for the preceding word
          // that shares their t_dtw — doing so renames "." to "principles", which
          // then breaks word-group building in applyTextPartsToTokens on the next run.
          if (normalize(t.text) === '' || normalize(p.text) === '') {
            return { ...t, cut: p.cut };
          }
          // Always keep the raw token's leading space (BPE word-boundary marker).
          // Old stored tokens may have had their spaces stripped by a previous
          // merge-doc run. Apply the user's correction to the non-space part only.
          const prefix = t.text.startsWith(' ') ? ' ' : '';
          const correctedWord = p.text.trimStart();
          return { ...t, text: prefix + correctedWord, cut: p.cut };
        });

        // Speaker: prefer the new diarized label unless the user has renamed it
        // to a real name (anything other than empty or a raw SPEAKER_XX label).
        const isDefaultSpeaker = !prev.speaker || /^SPEAKER_\d+$/i.test(prev.speaker);
        const speaker = isDefaultSpeaker ? seg.speaker : prev.speaker;

        // Only carry over prev.text if the segment boundaries still match closely
        // enough that the saved text applies to this sentence. When a segment has
        // been re-split (new boundary added mid-sentence) the old merged text is
        // longer than the new segment — use fresh token text instead.
        const prevWords = (prev.text || '').split(/\s+/).filter(Boolean).length;
        const segWords = seg.tokens.filter(t => !isSpecialToken(t) && !t.cut)
          .map(t => t.text.trim()).filter(Boolean).length;
        const textFits = prevWords <= segWords * 1.5;
        const text = textFits ? prev.text : seg.text;

        return { ...seg, speaker, cut: prev.cut, text, graphics: prev.graphics, tokens };
      }),
    };

    // Re-inject synthetic segments (created by > SPEAKER splits) that were never
    // matched by findPrev — these have no corresponding raw sentence.
    const syntheticSegs = existing.segments.filter(s => !matchedExistingIds.has(s.id));
    if (syntheticSegs.length > 0) {
      const syntheticStarts = new Set(syntheticSegs.map(s => s.start));
      const merged = [...transcript.segments, ...syntheticSegs].sort((a, b) => a.start - b.start);

      // Re-trim any parent segment that overlaps its following synthetic — the raw
      // re-segmentation restores the original end time, undoing the split trim.
      const trimmed = merged.map((seg, i) => {
        const next = merged[i + 1];
        if (next && syntheticStarts.has(next.start) && seg.end > next.start + 0.01) {
          const trimEnd = next.start;
          const trimTokens = seg.tokens.filter(t => t.t_dtw < trimEnd);
          const trimText = fixContractions(joinTokenTexts(trimTokens.filter(t => !isSpecialToken(t)))).trim() || seg.text;
          return { ...seg, end: trimEnd, tokens: trimTokens, text: trimText };
        }
        return seg;
      });

      transcript = { ...transcript, segments: trimmed };
    }

    console.log(`Merged into existing ${path.basename(outputPath)} — manual edits preserved.`);
  }

  // Apply corrected VTT text if provided
  if (cli.vttPath) {
    if (!await fs.pathExists(cli.vttPath)) {
      console.error(`❌ VTT file not found: ${cli.vttPath}`); process.exit(1);
    }
    const vttContent = (await fs.readFile(cli.vttPath, 'utf8')).replace(/\r\n/g, '\n');
    transcript = applyVttCorrections(transcript, parseVtt(vttContent));
    console.log(`Applied VTT corrections.`);
  }

  // Merge doc edits if provided
  if (cli.docPath) {
    if (!await fs.pathExists(cli.docPath)) {
      console.error(`❌ Doc file not found: ${cli.docPath}`); process.exit(1);
    }
    // Normalise line endings — editors on Windows save CRLF which breaks block splitting
    const docContent = (await fs.readFile(cli.docPath, 'utf8')).replace(/\r\n/g, '\n');
    transcript = mergeDocIntoTranscript(transcript, docContent);
    console.log(`Applied doc edits.`);
  }

  // Store video source path(s) in meta so Remotion and camera setup can resolve video files
  if (cli.videoSrc) {
    transcript = { ...transcript, meta: { ...transcript.meta, videoSrc: cli.videoSrc } };
  }
  if (cli.videoSrcs && cli.videoSrcs.length > 0) {
    transcript = { ...transcript, meta: { ...transcript.meta, videoSrcs: cli.videoSrcs } };
  }

  // Apply timestamp offset to all t_dtw values and segment boundaries
  if (cli.timestampOffset > 0) {
    const off = cli.timestampOffset;
    transcript = {
      ...transcript,
      segments: transcript.segments.map(seg => ({
        ...seg,
        start: Math.max(0, seg.start - off),
        end: Math.max(0, seg.end - off),
        tokens: seg.tokens.map(t => ({ ...t, t_dtw: Math.max(0, t.t_dtw - off) })),
      })),
    };
    console.log(`Applied timestamp offset: -${off}s`);
  }

  // Always re-derive cuts[] from token flags
  transcript = {
    ...transcript,
    segments: transcript.segments.map(seg => ({ ...seg, cuts: deriveCuts(seg) })),
  };

  // Auto-cut inter-token pauses if threshold provided
  if (cli.autoCutPauses > 0) {
    transcript = autoCutPauses(transcript, cli.autoCutPauses);
    console.log(`Auto-cut pauses > ${cli.autoCutPauses}s`);
  }

  const sentencesSrtPath = outputPath.replace(/\.json$/, '.sentences.srt');

  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeJson(outputPath, transcript, { spaces: 2 });
  await fs.writeFile(sentencesSrtPath, buildSentencesSrt(transcript.segments, transcript.meta), 'utf8');
  await fs.writeFile(docPath, buildDoc(transcript), 'utf8');

  console.log(`✓ ${outputPath}`);
  console.log(`✓ ${docPath}  ← edit here`);
  console.log(`✓ ${sentencesSrtPath}`);
}

const _argv1 = (process.argv[1] || '').replace(/\\/g, '/');
if (_argv1.endsWith('/edit-transcript.js') || _argv1.endsWith('/edit-transcript')) {
  main().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
}

export default main;
export { buildTextWithCuts, applyTextPartsToTokens, mergeDocIntoTranscript, buildDoc, deriveCuts, cleanCaptionText, buildSentencesVtt, buildSentencesSrt, getSubClips, getHookClips, resolvePhraseToTimeRange, resolvePhraseToFirstTokenIndex, autoCutPauses, autoCutDisfluencies, rebalanceBoundaryTokens, buildPrevTokensByTdtw, WORD_DURATION_ESTIMATE, CUT_START_BIAS, CUT_END_BIAS, isSpecialToken, isDisfluencyToken };
