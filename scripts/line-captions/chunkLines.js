import { isSpecialToken } from '../edit-transcript.js';

// Whisper contraction suffixes arrive as their own space-prefixed token (" 's", " 'm").
function isContractionSuffix(text) {
  return /^'(m|s|t|re|ve|ll|d)$/i.test(text.trim());
}

function isPunctuationOnly(text) {
  return /^[^\w\s']+$/.test(text.trim());
}

// Merges whisper's BPE-level tokens into whole-word groups so a "word" split
// across multiple tokens (e.g. " j" + "inx") isn't counted as two words, and
// punctuation tokens don't get their own caption slot.
function buildWordGroups(tokens) {
  const groups = [];
  for (const t of tokens) {
    if (t.cut || isSpecialToken(t)) continue;
    const trimmed = t.text.trim();
    if (!trimmed) continue;

    const isContinuation = !t.text.startsWith(' ') || isContractionSuffix(trimmed) || isPunctuationOnly(trimmed);
    if (isContinuation && groups.length > 0) {
      const prev = groups[groups.length - 1];
      prev.text += trimmed;
      prev.t_end = t.t_end ?? prev.t_end;
    } else {
      groups.push({ text: trimmed, t_dtw: t.t_dtw, t_end: t.t_end });
    }
  }
  return groups;
}

/**
 * Chunks a transcript's segments into fixed-size caption lines. A line never
 * spans a segment boundary, so lines never mix two speakers.
 */
export function chunkIntoLines(segments, wordsPerLine = 3) {
  const lines = [];
  let nextId = 1;

  for (const segment of segments) {
    if (segment.cut) continue;
    const groups = buildWordGroups(segment.tokens);

    for (let i = 0; i < groups.length; i += wordsPerLine) {
      const run = groups.slice(i, i + wordsPerLine);
      const nextGroup = groups[i + wordsPerLine];
      const lastGroup = run[run.length - 1];

      const startMs = run[0].t_dtw * 1000;
      const endMs = nextGroup
        ? nextGroup.t_dtw * 1000
        : (lastGroup.t_end ?? segment.end) * 1000;

      lines.push({
        id: nextId++,
        speaker: segment.speaker,
        text: run.map(g => g.text).join(' '),
        startMs,
        endMs,
      });
    }
  }

  return lines;
}
