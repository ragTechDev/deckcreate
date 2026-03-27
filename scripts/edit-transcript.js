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
            ? prevWordToken.t_dtw + CUT_START_BIAS * (token.t_dtw - prevWordToken.t_dtw)
            : segment.start);
      lastCutToken = token;
    } else if (cutFrom && isCut) {
      lastCutToken = token;
    } else if (cutFrom && !isCut) {
      const endTime = token ? token.t_dtw : segment.end;
      const cutTo = lastCutToken._cutTo !== undefined
        ? lastCutToken._cutTo
        : lastCutToken.t_dtw + CUT_END_BIAS * (endTime - lastCutToken.t_dtw);
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
      // Words match (normalized); use tokenText to include punctuation from tokens
      return tokenText;
    }
    // Word counts differ: BPE subword merge if concat matches (e.g. "j inx" → "jinx"), otherwise user edit
    if (normalize(segWords.join('')) === normalize(tokWords.join(''))) return tokenText;
    // Tokens have more words than seg.text — seg.text is missing content (stale/corrupted).
    // In the no-cuts path tokens are authoritative, so show the full token reconstruction.
    if (tokWords.length > segWords.length) return tokenText;
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

function findNearestToken(atSeconds, tokens) {
  if (!tokens.length) return null;
  let best = tokens[0];
  let bestDelta = Math.abs(tokens[0].t_dtw - atSeconds);
  for (const token of tokens) {
    const delta = Math.abs(token.t_dtw - atSeconds);
    if (delta < bestDelta) { bestDelta = delta; best = token; }
  }
  return best;
}

function buildGraphicLine(graphic, tokens) {
  const nearest = findNearestToken(graphic.at, tokens);
  let atValue;

  if (nearest) {
    const word = stripPunctuation(nearest.text);
    const tokenIdx = tokens.indexOf(nearest);
    const normalizedWord = word.toLowerCase();
    const occurrencesBefore = tokens
      .slice(0, tokenIdx)
      .filter(t => normalize(t.text) === normalizedWord).length;
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
    '  CUT SEGMENT     Add CUT after the segment number:',
    '                    [3] CUT  original text...',
    '',
    '  RENAME SPEAKER  Edit the name after the colon in SPEAKERS below.',
    '',
    '  OVERRIDE SPEAKER Override the speaker for one segment:',
    '                    [10] SPEAKER: Alice  text...',
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
    '                    > LowerThird  at="word"  duration=3  name="Name"  title="Role"',
    '                    > Callout  at="word"  duration=2  text="Quote"',
    '                    > ChapterMarker  at="word"  duration=1',
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

    let segLine = `[${seg.id}]`;
    if (seg.cut) segLine += ` CUT`;
    const text = cleanCaptionText(buildTextWithCuts(seg));
    if (text) segLine += `  ${text}`;
    lines.push(segLine);

    for (const cam of (seg.cameraCues || [])) {
      lines.push('    ' + buildCameraLine(cam, seg.tokens, seg.start));
    }
    for (const g of (seg.graphics || [])) {
      lines.push('    ' + buildGraphicLine(g, seg.tokens));
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
    let word, occurrence;
    if (colonIdx > 0 && !isNaN(raw.slice(colonIdx + 1))) {
      word = raw.slice(0, colonIdx).toLowerCase();
      occurrence = parseInt(raw.slice(colonIdx + 1)) - 1;
    } else {
      word = raw.toLowerCase();
      occurrence = 0;
    }
    const matches = tokens.filter(t => normalize(t.text) === word);
    const token = matches[occurrence] ?? null;
    at = token ? token.t_dtw : parseFloat(raw) || segStart;
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
  const nearest = findNearestToken(cue.at, tokens);
  let atValue;
  if (nearest) {
    const word = stripPunctuation(nearest.text);
    const tokenIdx = tokens.indexOf(nearest);
    const normalizedWord = word.toLowerCase();
    const occurrencesBefore = tokens
      .slice(0, tokenIdx)
      .filter(t => normalize(t.text) === normalizedWord).length;
    atValue = occurrencesBefore > 0 ? `"${word}:${occurrencesBefore + 1}"` : `"${word}"`;
  } else {
    atValue = String(cue.at);
  }
  return `> CAM ${target}  at=${atValue}`;
}

function parseGraphicLine(line, tokens) {
  const spaceIdx = line.search(/\s/);
  const type = spaceIdx === -1 ? line : line.slice(0, spaceIdx);
  const kvStr = spaceIdx === -1 ? '' : line.slice(spaceIdx);
  const kv = parseKv(kvStr);

  // Resolve at="word" or at="word:2" to absolute seconds via token t_dtw
  let at = 0;
  if (kv.at !== undefined) {
    const raw = kv.at;
    const colonIdx = raw.lastIndexOf(':');
    let word, occurrence;

    if (colonIdx > 0 && !isNaN(raw.slice(colonIdx + 1))) {
      word = raw.slice(0, colonIdx).toLowerCase();
      occurrence = parseInt(raw.slice(colonIdx + 1)) - 1;
    } else {
      word = raw.toLowerCase();
      occurrence = 0;
    }

    const matches = tokens.filter(t => normalize(t.text) === word);
    const token = matches[occurrence] ?? null;
    at = token ? token.t_dtw : parseFloat(raw) || 0;
  }

  const duration = parseFloat(kv.duration) || 3;
  const props = {};
  for (const [k, v] of Object.entries(kv)) {
    if (k !== 'at' && k !== 'duration') props[k] = v;
  }

  return { type, at, duration, props };
}

function applyTextPartsToTokens(rawText, tokens) {
  // Reset cut flags and any stored time overrides — doc is the source of truth.
  const updated = tokens.map(({ _cutFrom, _cutTo, ...t }) => ({ ...t, cut: false }));

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

    const wordTokens = updated
      .map((t, idx) => ({ t, idx }))
      .filter(({ t }) => !isSpecialToken(t) && normalize(t.text) !== '');

    for (let i = 0; i <= wordTokens.length - cutWords.length; i++) {
      const matches = cutWords.every((w, j) => normalize(wordTokens[i + j].t.text) === w);
      if (matches) {
        const firstIdx = wordTokens[i].idx;
        const lastWordIdx = wordTokens[i + cutWords.length - 1].idx;
        const lastTdtw = updated[lastWordIdx].t_dtw;

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
        break;
      }
    }
  }

  // Apply word-level text corrections: align visible (non-cut) words from doc
  // with non-cut, non-special tokens and update token.text so corrections persist.
  const visibleWords = rawText.replace(/\{[^}]+\}/g, ' ').replace(/\s+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const nonCutNonSpecialIndices = updated.reduce((acc, t, i) => {
    if (!t.cut && !isSpecialToken(t)) acc.push(i);
    return acc;
  }, []);
  if (visibleWords.length === nonCutNonSpecialIndices.length) {
    visibleWords.forEach((word, wi) => {
      const idx = nonCutNonSpecialIndices[wi];
      // Preserve the original leading space so joinTokenTexts can still detect
      // word boundaries (Whisper BPE marks word starts with a leading space).
      const origText = updated[idx].text;
      const prefix = origText.startsWith(' ') ? ' ' : '';
      updated[idx] = { ...updated[idx], text: prefix + word };
    });
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
  let applied = 0;
  let currentSpeaker = null;
  let pendingSeg = null;
  let pendingGraphicLines = [];
  let pendingCamLines = [];
  let videoStart = transcript.meta.videoStart;
  let videoEnd = transcript.meta.videoEnd;
  let nextSegIsVideoStart = false;

  function flushPending() {
    if (!pendingSeg) return;
    const graphics    = pendingGraphicLines.map(l => parseGraphicLine(l, pendingSeg.tokens));
    const cameraCues  = pendingCamLines.map(l => parseCameraLine(l, pendingSeg.tokens, pendingSeg.start));
    byId[pendingSeg.id] = { ...pendingSeg, graphics, cameraCues };
    pendingSeg = null;
    pendingGraphicLines = [];
    pendingCamLines = [];
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

    // Annotation line: > CAM ... | > GraphicType ...
    if (trimmed.startsWith('>')) {
      const annotation = trimmed.slice(1).trim();
      if (annotation.startsWith('CAM')) {
        if (pendingSeg) pendingCamLines.push(annotation.slice(3).trim());
      } else {
        if (pendingSeg) pendingGraphicLines.push(annotation);
      }
      continue;
    }

    // Segment line: [N]  text  or  [N] CUT  text  or  [N] CUT:reason  text
    const segMatch = trimmed.match(/^\[(\d+)\](.*)/);
    if (segMatch) {
      flushPending();
      const id = parseInt(segMatch[1]);
      const seg = byId[id];
      if (!seg) continue;

      let rest = segMatch[2].trim();
      let cut = false;
      let inlineSpeaker = null;

      const cutMatch = rest.match(/^CUT(?::\w+)?\s*(.*)/i);
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
  return {
    ...transcript,
    meta: { ...transcript.meta, videoStart, videoEnd },
    segments: transcript.segments.map(s => byId[s.id] ?? s),
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
        const gap = activeTokens[i + 1].t_dtw - activeTokens[i].t_dtw;
        // gap = word_duration + silence. Subtract estimated word duration to get
        // the actual silence. Only cut if silence exceeds threshold.
        const silence = gap - WORD_DURATION_ESTIMATE;
        if (silence >= threshold) {
          pauseCuts.push({
            from: activeTokens[i].t_dtw + WORD_DURATION_ESTIMATE,
            to: activeTokens[i + 1].t_dtw,
          });
        }
      }

      if (!pauseCuts.length) return seg;

      // Merge consecutive pause cuts whose gap is at most WORD_DURATION_ESTIMATE.
      // When a word's entire play window (≤ WORD_DURATION_ESTIMATE) is sandwiched
      // between two pause cuts it produces a jarring micro-clip; absorb it instead.
      const merged = [{ ...pauseCuts[0] }];
      for (let i = 1; i < pauseCuts.length; i++) {
        const last = merged[merged.length - 1];
        if (pauseCuts[i].from - last.to <= WORD_DURATION_ESTIMATE) {
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

function secondsToVttTs(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(3);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(6, '0')}`;
}

function cleanCaptionText(text) {
  return text.replace(/_[A-Z]+_/g, '').replace(/\s{2,}/g, ' ').trim();
}

function buildSentencesVtt(segments) {
  const lines = ['WEBVTT', ''];
  for (const seg of segments) {
    if (seg.cut) continue;
    const text = cleanCaptionText(seg.text);
    if (!text) continue;
    lines.push(`${secondsToVttTs(seg.start)} --> ${secondsToVttTs(seg.end)}`);
    lines.push(text);
    lines.push('');
  }
  return lines.join('\n');
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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const cwd = process.cwd();
  const cli = parseArgs();

  const rawPath = cli.rawPath || path.join(cwd, 'public', 'transcribe', 'output', 'raw', 'transcript.raw.json');
  const outputPath = cli.outputPath || path.join(cwd, 'public', 'transcribe', 'output', 'edit', 'transcript.json');
  const sentencesVttPath = outputPath.replace(/\.json$/, '.sentences.vtt');
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

    transcript = {
      ...transcript,
      meta: { ...transcript.meta, ...existing.meta },
      segments: transcript.segments.map(seg => {
        const prev = findPrev(seg);
        if (!prev) return seg;

        const prevTokensByTdtw = Object.fromEntries(
          (prev.tokens || []).map(t => [t.t_dtw.toFixed(3), t])
        );
        const tokens = seg.tokens.map(t => {
          const p = prevTokensByTdtw[t.t_dtw.toFixed(3)];
          if (!p) return t;
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

  const sentencesVtt = buildSentencesVtt(transcript.segments);
  const sentencesSrtPath = sentencesVttPath.replace(/\.vtt$/, '.srt');

  await fs.writeJson(outputPath, transcript, { spaces: 2 });
  await fs.writeFile(sentencesVttPath, sentencesVtt, 'utf8');
  await fs.writeFile(sentencesSrtPath, convertVttToSrt(sentencesVtt), 'utf8');
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
export { buildTextWithCuts, applyTextPartsToTokens, mergeDocIntoTranscript, buildDoc, deriveCuts, cleanCaptionText, buildSentencesVtt, autoCutPauses, autoCutDisfluencies, WORD_DURATION_ESTIMATE, CUT_START_BIAS, CUT_END_BIAS, isSpecialToken, isDisfluencyToken };
